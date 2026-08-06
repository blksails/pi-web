/** 视频工作室 Surface：agent 单写快照，Pane 仅经命令读写。 */
import { Type } from "@earendil-works/pi-ai";
import {
  createSurface,
  type PaneExtensionFactory,
  type SurfaceHandle,
} from "@blksails/pi-web-tool-kit/runtime";
import {
  addVideoToTimeline,
  buildShotPrompt,
  clearAudioTrack,
  createVideoPlan,
  createVideoPlanFromAgent,
  deletePromptHistory,
  deleteVideoHistory,
  emptyVideoStudioState,
  normalizeVideoStudioState,
  markVideoExportRequested,
  patchVideoShot,
  removeTimelineClip,
  selectVideoVersion,
  selectPromptVersion,
  setAgentShotPrompt,
  setAudioTrack,
  setTimelineOutputAsset,
  setVideoShotAsset,
  trimAudioTrack,
  VIDEO_STUDIO_DOMAIN,
  type VideoAudioMode,
  type VideoProject,
  type VideoShotStatus,
  type VideoStudioState,
} from "./model.js";
import { getSessionState } from "@blksails/pi-web-tool-kit";

type ExtensionAPI = Parameters<PaneExtensionFactory>[0];

const VIDEO_GENERATION_TOOLS = new Set([
  "text_to_video",
  "image_to_video",
  "multimodal_reference_video",
  "video_edit",
  "digital_human_video",
]);
const AUDIO_OUTPUT_TOOLS = new Set(["audio_extract", "text_to_speech"]);
const TIMELINE_OUTPUT_TOOLS = new Set(["video_concat", "video_with_audio", "video_clip", "video_transcode"]);
const MEDIA_TOOLS = new Set([...VIDEO_GENERATION_TOOLS, ...AUDIO_OUTPUT_TOOLS, ...TIMELINE_OUTPUT_TOOLS]);

interface ToolAsset {
  readonly attachmentId?: string;
  readonly displayUrl?: string;
  readonly mimeType?: string;
}

interface ToolEvent {
  readonly toolName?: string;
  readonly args?: unknown;
  readonly isError?: boolean;
  readonly result?: {
    readonly details?: {
      readonly assets?: readonly ToolAsset[];
      readonly error?: string;
    };
  };
}

interface PiLike {
  on(event: string, handler: (event: ToolEvent) => void): void;
}

function argsObject(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
}

function textArg(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" ? args[key] as string : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] as number : undefined;
}

function shotStatus(value: unknown): VideoShotStatus | undefined {
  return value === "draft" || value === "queued" || value === "generating" || value === "paused" || value === "review" || value === "done" || value === "failed"
    ? value
    : undefined;
}

function currentState(): VideoStudioState {
  return getSessionState().get<VideoStudioState>("surface:video-studio") ?? emptyVideoStudioState();
}

function shotIdFromEvent(event: ToolEvent): string | undefined {
  const args = argsObject(event.args);
  return textArg(args, "shot_id") ?? textArg(args, "shotId");
}

function activeGeneratingShot(state: VideoStudioState, preferredId?: string) {
  return state.project?.shots.find((shot) => shot.id === preferredId)
    ?? state.project?.shots.find((shot) => shot.status === "generating" || shot.status === "queued");
}

function toolResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function stateForToolEnd(state: VideoStudioState, event: ToolEvent): VideoStudioState {
  const project = state.project;
  const toolName = event.toolName ?? "";
  if (project === null || !MEDIA_TOOLS.has(toolName)) return state;
  const asset = event.result?.details?.assets?.find((item) => item.attachmentId !== undefined || item.displayUrl !== undefined);
  if (event.isError === true) {
    if (VIDEO_GENERATION_TOOLS.has(toolName)) {
      const shot = activeGeneratingShot(state, shotIdFromEvent(event));
      return shot === undefined ? state : patchVideoShot(state, shot.id, {
        status: "failed",
        progress: 0,
        error: event.result?.details?.error ?? "媒体生成失败，可重试",
      });
    }
    return { ...state, project: { ...project, exportStatus: "failed", updatedAt: new Date().toISOString() } };
  }
  if (asset === undefined) return state;
  if (VIDEO_GENERATION_TOOLS.has(toolName)) {
    const shot = activeGeneratingShot(state, shotIdFromEvent(event));
    return shot === undefined ? state : setVideoShotAsset(state, shot.id, {
      ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}),
      ...(asset.displayUrl !== undefined ? { previewUrl: asset.displayUrl } : {}),
    });
  }
  if (AUDIO_OUTPUT_TOOLS.has(toolName) && asset.attachmentId !== undefined) {
    return setAudioTrack(state, {
      attachmentId: asset.attachmentId,
      ...(asset.displayUrl !== undefined ? { previewUrl: asset.displayUrl } : {}),
    });
  }
  return setTimelineOutputAsset(state, {
    ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}),
    ...(asset.displayUrl !== undefined ? { previewUrl: asset.displayUrl } : {}),
  });
}

function promptForProject(project: VideoProject): string {
  const clips = project.timeline.videoClips.map((clip) => clip.attachmentId).join(", ");
  const audio = project.timeline.audioTrack?.attachmentId;
  return [
    "请使用视频工作室 Surface 的镜头上下文，按顺序完成视频任务；必须实际调用媒体工具，不要只输出方案文字。",
    `项目：${project.title}；画幅：${project.aspectRatio}；总时长约 ${project.targetDurationSec} 秒。`,
    ...project.shots.map((shot) => buildShotPrompt(project, shot)),
    ...(clips !== "" ? [`视频轨道已有片段：${clips}；如需合成，调用 video_concat。`] : []),
    ...(audio !== undefined ? [`音轨：audio_url=${audio}；audio_trim_start_seconds=${project.timeline.audioTrack?.trimStartSec ?? 0}，audio_duration_seconds=${project.timeline.audioTrack?.durationSec ?? "省略"}，audio_start_seconds=${project.timeline.audioTrack?.startSec ?? 0}，audio_volume=${project.timeline.audioTrack?.volume ?? 1}，mode=${project.timeline.audioTrack?.mode ?? "replace"}；调用 video_with_audio。`] : []),
  ].join("\n\n");
}

const VideoPlanParameters = Type.Object({
  title: Type.String({ description: "项目标题" }),
  brief: Type.String({ description: "用户创意简报" }),
  aspect_ratio: Type.Union([Type.Literal("16:9"), Type.Literal("9:16"), Type.Literal("1:1")]),
  target_duration_sec: Type.Number({ minimum: 5, maximum: 30 }),
  shots: Type.Array(Type.Object({
    title: Type.String({ description: "镜头标题" }),
    prompt: Type.String({ description: "可直接交给视频模型的完整提示词" }),
    duration_sec: Type.Number({ minimum: 1, maximum: 30 }),
  }), { minItems: 1, maxItems: 6 }),
});

const VideoShotPromptParameters = Type.Object({
  shot_id: Type.String({ description: "当前镜头 ID" }),
  prompt: Type.String({ description: "重新生成的可执行视频提示词" }),
});

function registerVideoStudioAgentTools(pi: ExtensionAPI, handle: SurfaceHandle<VideoStudioState>): void {
  pi.registerTool({
    name: "video_plan",
    label: "生成视频镜头方案",
    description: "由 Agent/LLM 将视频简报拆成结构化镜头方案并写入视频工作室。用户要求生成方案时必须调用此工具。",
    parameters: VideoPlanParameters,
    async execute(_toolCallId, params) {
      const a = argsObject(params);
      const rawShots = Array.isArray(a.shots) ? a.shots : [];
      const plans = rawShots.map((item) => {
        const shot = argsObject(item);
        return {
          title: textArg(shot, "title") ?? "未命名镜头",
          prompt: textArg(shot, "prompt") ?? "",
          durationSec: numberArg(shot, "duration_sec") ?? 5,
        };
      });
      const next = createVideoPlanFromAgent(currentState(), textArg(a, "brief") ?? "", {
        title: textArg(a, "title"),
        aspectRatio: a.aspect_ratio === "9:16" || a.aspect_ratio === "1:1" ? a.aspect_ratio : "16:9",
        targetDurationSec: numberArg(a, "target_duration_sec"),
      }, plans);
      handle.update(() => next);
      return toolResult(`已写入视频工作室：${next.project?.shots.length ?? 0} 个 Agent 镜头方案。`, {
        projectId: next.project?.id,
        shotIds: next.project?.shots.map((shot) => shot.id),
      });
    },
  });
  pi.registerTool({
    name: "video_shot_prompt",
    label: "生成镜头提示词",
    description: "由 Agent/LLM 重新生成指定镜头提示词并保留版本历史。用户要求重写镜头提示词时必须调用此工具。",
    parameters: VideoShotPromptParameters,
    async execute(_toolCallId, params) {
      const a = argsObject(params);
      const shotId = textArg(a, "shot_id") ?? "";
      const prompt = textArg(a, "prompt") ?? "";
      const next = setAgentShotPrompt(currentState(), shotId, prompt);
      handle.update(() => next);
      return toolResult(`已更新 ${shotId} 的 Agent 提示词，并保留历史版本。`, {
        shotId,
        prompt,
        promptHistory: next.project?.shots.find((shot) => shot.id === shotId)?.promptHistory,
      });
    },
  });
}

export function createVideoStudioSurface(
  pi: ExtensionAPI,
): SurfaceHandle<VideoStudioState> {
  const handle = createSurface<VideoStudioState>(pi, {
    domain: VIDEO_STUDIO_DOMAIN,
    initialState: emptyVideoStudioState(),
    commands: {
      "create-plan": (args, ctx) => {
        const a = argsObject(args);
        const next = createVideoPlan(ctx.get(), textArg(a, "brief") ?? "", {
          title: textArg(a, "title"),
          aspectRatio: a.aspectRatio === "9:16" || a.aspectRatio === "1:1" ? a.aspectRatio : "16:9",
          targetDurationSec: numberArg(a, "targetDurationSec"),
          automation: a.automation === "manual" || a.automation === "automatic" ? a.automation : "assisted",
        });
        ctx.setState(() => next);
        return next.project;
      },
      "update-brief": (args, ctx) => {
        const a = argsObject(args);
        const brief = textArg(a, "brief");
        if (brief === undefined || ctx.get().project === null) return { ok: false, error: { code: "invalid_args", message: "需要 brief 与现有项目" } };
        ctx.setState((state) => state.project === null ? state : {
          ...state,
          project: {
            ...state.project,
            brief,
            ...(textArg(a, "title") !== undefined ? { title: textArg(a, "title") } : {}),
            ...(a.aspectRatio === "16:9" || a.aspectRatio === "9:16" || a.aspectRatio === "1:1" ? { aspectRatio: a.aspectRatio } : {}),
            ...(a.automation === "manual" || a.automation === "assisted" || a.automation === "automatic" ? { automation: a.automation } : {}),
            updatedAt: new Date().toISOString(),
          },
        });
        return { brief, title: textArg(a, "title") };
      },
      "update-shot": (args, ctx) => {
        const a = argsObject(args);
        const id = textArg(a, "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        const next = patchVideoShot(ctx.get(), id, {
          ...(textArg(a, "title") !== undefined ? { title: textArg(a, "title") } : {}),
          ...(textArg(a, "prompt") !== undefined ? { prompt: textArg(a, "prompt") } : {}),
          ...(numberArg(a, "durationSec") !== undefined ? { durationSec: numberArg(a, "durationSec") } : {}),
          ...(shotStatus(a.status) !== undefined ? { status: shotStatus(a.status) } : {}),
        });
        ctx.setState(() => next);
        return next.project?.shots.find((shot) => shot.id === id);
      },
      "queue-shot": (args, ctx) => {
        const id = textArg(argsObject(args), "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => patchVideoShot(state, id, { status: "queued", progress: 0, error: "" }));
        return { shotId: id, status: "queued" };
      },
      "queue-all": (_args, ctx) => {
        ctx.setState((state) => state.project === null ? state : {
          ...state,
          project: {
            ...state.project,
            shots: state.project.shots.map((shot) => shot.status === "done" ? shot : { ...shot, status: "queued" as const, progress: 0, error: undefined }),
            updatedAt: new Date().toISOString(),
          },
        });
        return { status: "queued" };
      },
      "pause-shot": (args, ctx) => {
        const id = textArg(argsObject(args), "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => patchVideoShot(state, id, { status: "paused" }));
        return { shotId: id, status: "paused" };
      },
      "resume-shot": (args, ctx) => {
        const id = textArg(argsObject(args), "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => patchVideoShot(state, id, { status: "queued", error: "" }));
        return { shotId: id, status: "queued" };
      },
      "retry-shot": (args, ctx) => {
        const id = textArg(argsObject(args), "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => patchVideoShot(state, id, { status: "queued", progress: 0, error: "" }));
        return { shotId: id, status: "queued" };
      },
      "rollback-shot": (args, ctx) => {
        const id = textArg(argsObject(args), "shotId");
        if (id === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => patchVideoShot(state, id, { status: "draft", progress: 0, error: "" }));
        return { shotId: id, status: "draft" };
      },
      "select-video": (args, ctx) => {
        const a = argsObject(args);
        const shotId = textArg(a, "shotId");
        const videoId = textArg(a, "videoId");
        if (shotId === undefined || videoId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId 与 videoId" } };
        ctx.setState((state) => selectVideoVersion(state, shotId, videoId));
        return { shotId, videoId };
      },
      "select-prompt": (args, ctx) => {
        const a = argsObject(args);
        const shotId = textArg(a, "shotId");
        const promptId = textArg(a, "promptId");
        if (shotId === undefined || promptId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId 与 promptId" } };
        ctx.setState((state) => selectPromptVersion(state, shotId, promptId));
        return { shotId, promptId, status: "selected" };
      },
      "delete-prompt-history": (args, ctx) => {
        const a = argsObject(args);
        const shotId = textArg(a, "shotId");
        const promptId = textArg(a, "promptId");
        if (shotId === undefined || promptId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId 与 promptId" } };
        ctx.setState((state) => deletePromptHistory(state, shotId, promptId));
        return { shotId, promptId, deleted: true };
      },
      "delete-video-history": (args, ctx) => {
        const a = argsObject(args);
        const shotId = textArg(a, "shotId");
        const videoId = textArg(a, "videoId");
        if (shotId === undefined || videoId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId 与 videoId" } };
        ctx.setState((state) => deleteVideoHistory(state, shotId, videoId));
        return { shotId, videoId, deleted: true };
      },
      "add-to-timeline": (args, ctx) => {
        const a = argsObject(args);
        const shotId = textArg(a, "shotId");
        if (shotId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 shotId" } };
        ctx.setState((state) => addVideoToTimeline(state, shotId, textArg(a, "videoId")));
        return { shotId, status: "added" };
      },
      "remove-from-timeline": (args, ctx) => {
        const clipId = textArg(argsObject(args), "clipId");
        if (clipId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 clipId" } };
        ctx.setState((state) => removeTimelineClip(state, clipId));
        return { clipId, status: "removed" };
      },
      "set-audio-track": (args, ctx) => {
        const a = argsObject(args);
        const attachmentId = textArg(a, "attachmentId");
        if (attachmentId === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 attachmentId" } };
        ctx.setState((state) => setAudioTrack(state, {
          attachmentId,
          startSec: numberArg(a, "startSec"),
          trimStartSec: numberArg(a, "trimStartSec"),
          durationSec: numberArg(a, "durationSec"),
          volume: numberArg(a, "volume"),
          mode: a.mode === "mix" ? "mix" : "replace",
        }));
        return { attachmentId, status: "set" };
      },
      "trim-audio-track": (args, ctx) => {
        const a = argsObject(args);
        const trimStartSec = numberArg(a, "trimStartSec");
        const durationSec = numberArg(a, "durationSec");
        if (trimStartSec === undefined || durationSec === undefined) return { ok: false, error: { code: "invalid_args", message: "需要 trimStartSec 与 durationSec" } };
        ctx.setState((state) => trimAudioTrack(state, trimStartSec, durationSec));
        return { status: "trimmed" };
      },
      "clear-audio-track": (_args, ctx) => {
        ctx.setState((state) => clearAudioTrack(state));
        return { status: "cleared" };
      },
      "clear-timeline": (_args, ctx) => {
        ctx.setState((state) => state.project === null ? state : { ...state, project: { ...state.project, timeline: { videoClips: [] }, updatedAt: new Date().toISOString() } });
        return { status: "cleared" };
      },
      "request-export": (_args, ctx) => {
        const project = ctx.get().project;
        if (project === null || project.shots.some((shot) => shot.status !== "done")) return { ok: false, error: { code: "shots_incomplete", message: "请先完成全部镜头并复核" } };
        if (project.timeline.videoClips.length === 0) return { ok: false, error: { code: "timeline_empty", message: "请先把当前视频版本加入视频轨道" } };
        ctx.setState(markVideoExportRequested);
        return { status: "requested" };
      },
      sync: (_args, ctx) => ctx.get(),
    },
  });
  registerVideoStudioAgentTools(pi, handle);
  const events = pi as unknown as PiLike;
  events.on("tool_execution_start", (event) => {
    if (!VIDEO_GENERATION_TOOLS.has(event.toolName ?? "")) return;
    const shot = activeGeneratingShot(currentState(), shotIdFromEvent(event));
    if (shot === undefined) return;
    handle.update((state) => patchVideoShot(state, shot.id, { status: "generating", progress: 5, error: "" }));
  });
  events.on("tool_execution_end", (event) => {
    if (!MEDIA_TOOLS.has(event.toolName ?? "")) return;
    handle.update((state) => stateForToolEnd(normalizeVideoStudioState(state), event));
  });
  return handle;
}

export function buildAutomaticProjectPrompt(state: VideoStudioState): string | undefined {
  const project = normalizeVideoStudioState(state).project;
  return project === null ? undefined : promptForProject(project);
}

export const videoStudioSurfaceExtension: PaneExtensionFactory = (pi) => {
  createVideoStudioSurface(pi);
};

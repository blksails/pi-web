/** 视频工作室领域模型：快照可序列化，引用只存 attachment id/URL。 */

export const VIDEO_STUDIO_DOMAIN = "video-studio";
export const VIDEO_STUDIO_STATE_KEY = `surface:${VIDEO_STUDIO_DOMAIN}`;
export const MAX_VIDEO_SHOTS = 6;
export const MAX_VIDEO_DURATION_SEC = 30;

export type VideoAutomation = "manual" | "assisted" | "automatic";
export type VideoShotStatus =
  | "draft"
  | "queued"
  | "generating"
  | "paused"
  | "review"
  | "done"
  | "failed";
export type VideoExportStatus = "idle" | "requested" | "ready" | "failed";
export type VideoPromptSource = "agent" | "user" | "template";
export type VideoAudioMode = "replace" | "mix";

export interface VideoPromptVersion {
  readonly id: string;
  readonly prompt: string;
  readonly source: VideoPromptSource;
  readonly createdAt: string;
}

export interface VideoAssetVersion {
  readonly id: string;
  readonly attachmentId?: string;
  readonly previewUrl?: string;
  readonly promptVersionId?: string;
  readonly createdAt: string;
}

export interface VideoTimelineClip {
  readonly id: string;
  readonly shotId: string;
  readonly videoId: string;
  readonly attachmentId: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly trimStartSec: number;
}

export interface VideoAudioTrack {
  readonly attachmentId: string;
  readonly previewUrl?: string;
  readonly startSec: number;
  readonly trimStartSec: number;
  readonly durationSec?: number;
  readonly volume: number;
  readonly mode: VideoAudioMode;
  readonly updatedAt: string;
}

export interface VideoTimeline {
  readonly videoClips: readonly VideoTimelineClip[];
  readonly audioTrack?: VideoAudioTrack;
  readonly outputVideo?: VideoAssetVersion;
  readonly selectedVideoId?: string;
}

export interface VideoShot {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly prompt: string;
  readonly promptHistory: readonly VideoPromptVersion[];
  readonly activePromptId?: string;
  readonly videoHistory: readonly VideoAssetVersion[];
  readonly durationSec: number;
  readonly status: VideoShotStatus;
  readonly progress: number;
  readonly attachmentId?: string;
  readonly previewUrl?: string;
  readonly error?: string;
  readonly updatedAt: string;
}

export interface VideoProject {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly aspectRatio: "16:9" | "9:16" | "1:1";
  readonly targetDurationSec: number;
  readonly automation: VideoAutomation;
  readonly shots: readonly VideoShot[];
  readonly activeShotId?: string;
  readonly timeline: VideoTimeline;
  readonly exportStatus: VideoExportStatus;
  readonly exportedAttachmentId?: string;
  readonly updatedAt: string;
}

export interface VideoStudioEvent {
  readonly id: string;
  readonly type:
    | "plan_created"
    | "shot_updated"
    | "generation_started"
    | "generation_finished"
    | "export_requested"
    | "timeline_updated";
  readonly message: string;
  readonly at: string;
}

export interface VideoStudioState {
  readonly project: VideoProject | null;
  readonly events: readonly VideoStudioEvent[];
}

export interface VideoPlanOptions {
  readonly title?: string;
  readonly aspectRatio?: VideoProject["aspectRatio"];
  readonly targetDurationSec?: number;
  readonly automation?: VideoAutomation;
}

export interface AgentVideoShotPlan {
  readonly title: string;
  readonly prompt: string;
  readonly durationSec: number;
}

export interface VideoShotPatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly promptSource?: VideoPromptSource;
  readonly durationSec?: number;
  readonly status?: VideoShotStatus;
  readonly progress?: number;
  readonly error?: string;
}

export function emptyVideoStudioState(): VideoStudioState {
  return { project: null, events: [] };
}

function now(): string {
  return new Date().toISOString();
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  return text === "" ? fallback : text;
}

function duration(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_VIDEO_DURATION_SEC, Math.round(value)));
}

function nonNegative(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value * 100) / 100);
}

function eventId(index: number): string {
  return `video-event-${Date.now()}-${index}`;
}

function versionId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${index}`;
}

function appendEvent(
  state: VideoStudioState,
  type: VideoStudioEvent["type"],
  message: string,
): VideoStudioState {
  const event: VideoStudioEvent = {
    id: eventId(state.events.length),
    type,
    message,
    at: now(),
  };
  return { ...state, events: [...state.events.slice(-49), event] };
}

function shotId(index: number): string {
  return `shot-${String(index + 1).padStart(2, "0")}`;
}

function promptVersion(
  prompt: string,
  source: VideoPromptSource,
  index: number,
  createdAt = now(),
): VideoPromptVersion {
  return { id: versionId("prompt", index), prompt, source, createdAt };
}

function newShot(
  index: number,
  title: string,
  prompt: string,
  durationSec: number,
  source: VideoPromptSource,
): VideoShot {
  const createdAt = now();
  const version = promptVersion(prompt, source, index, createdAt);
  return {
    id: shotId(index),
    index: index + 1,
    title: cleanText(title, `镜头 ${index + 1}`, 80),
    prompt,
    promptHistory: [version],
    activePromptId: version.id,
    videoHistory: [],
    durationSec,
    status: "draft",
    progress: 0,
    updatedAt: createdAt,
  };
}

function planShots(brief: string, targetDurationSec: number): VideoShot[] {
  const normalized = cleanText(brief, "一段有明确起承转合的短视频", 800);
  const count = targetDurationSec >= 18 ? 4 : 3;
  const durations = count === 4 ? [5, 5, 5, 5] : [5, 6, 5];
  const beats = [
    ["开场建立", `建立场景与主体：${normalized}`],
    ["动作推进", `推进核心动作与镜头运动：${normalized}`],
    ["情绪转折", `加入情绪或视觉转折，保持主体连续：${normalized}`],
    ["收束定格", `以清晰收束画面结束，留下可剪辑尾帧：${normalized}`],
  ] as const;
  return beats.slice(0, count).map(([title, prompt], index) => newShot(index, title, prompt, durations[index] ?? 5, "template"));
}

function makeProject(
  brief: string,
  options: VideoPlanOptions,
  shots: readonly VideoShot[],
): VideoProject {
  const cleanBrief = cleanText(brief, "一段有明确起承转合的短视频", 800);
  const targetDurationSec = Math.min(MAX_VIDEO_DURATION_SEC, Math.max(5, Math.round(options.targetDurationSec ?? 15)));
  return {
    id: `project-${Date.now()}`,
    title: cleanText(options.title, "未命名视频项目", 80),
    brief: cleanBrief,
    aspectRatio: options.aspectRatio ?? "16:9",
    targetDurationSec,
    automation: options.automation ?? "assisted",
    shots: shots.slice(0, MAX_VIDEO_SHOTS),
    activeShotId: shots[0]?.id,
    timeline: { videoClips: [] },
    exportStatus: "idle",
    updatedAt: now(),
  };
}

function createPlanState(
  state: VideoStudioState,
  brief: string,
  options: VideoPlanOptions,
  shots: readonly VideoShot[],
): VideoStudioState {
  const project = makeProject(brief, options, shots.length > 0 ? shots : planShots(brief, options.targetDurationSec ?? 15));
  return appendEvent({ project, events: [] }, "plan_created", `已生成 ${project.shots.length} 个镜头方案（${shots.length > 0 ? "Agent" : "模板兜底"}）`);
}

export function createVideoPlan(
  state: VideoStudioState,
  brief: string,
  options: VideoPlanOptions = {},
): VideoStudioState {
  return createPlanState(state, brief, options, planShots(brief, options.targetDurationSec ?? 15));
}

export function createVideoPlanFromAgent(
  state: VideoStudioState,
  brief: string,
  options: VideoPlanOptions,
  plans: readonly AgentVideoShotPlan[],
): VideoStudioState {
  const safePlans = plans.slice(0, MAX_VIDEO_SHOTS).map((plan, index) => newShot(
    index,
    cleanText(plan.title, `镜头 ${index + 1}`, 80),
    cleanText(plan.prompt, `围绕「${brief}」完成镜头 ${index + 1}`, 1200),
    duration(plan.durationSec, 5),
    "agent",
  ));
  return createPlanState(state, brief, options, safePlans);
}

export function normalizeVideoStudioState(value: unknown): VideoStudioState {
  if (typeof value !== "object" || value === null) return emptyVideoStudioState();
  const candidate = value as Partial<VideoStudioState>;
  if (!Array.isArray(candidate.events)) return emptyVideoStudioState();
  if (candidate.project === null || candidate.project === undefined) return { project: null, events: candidate.events };
  const project = candidate.project as VideoProject;
  const shots = Array.isArray(project.shots) ? project.shots.map((rawShot) => {
    const shot = rawShot as VideoShot & { promptHistory?: readonly VideoPromptVersion[]; videoHistory?: readonly VideoAssetVersion[] };
    const history = shot.promptHistory && shot.promptHistory.length > 0
      ? shot.promptHistory
      : [{ id: `legacy-${shot.id}`, prompt: shot.prompt, source: "template" as const, createdAt: shot.updatedAt }];
    const videos = shot.videoHistory ?? (shot.attachmentId !== undefined || shot.previewUrl !== undefined
      ? [{ id: `legacy-video-${shot.id}`, attachmentId: shot.attachmentId, previewUrl: shot.previewUrl, createdAt: shot.updatedAt }]
      : []);
    return {
      ...shot,
      promptHistory: history,
      activePromptId: shot.activePromptId ?? history[history.length - 1]?.id,
      videoHistory: videos,
    };
  }) : [];
  return {
    ...candidate,
    project: {
      ...project,
      shots,
      timeline: project.timeline ?? { videoClips: [] },
    },
    events: candidate.events,
  };
}

export function patchVideoShot(
  state: VideoStudioState,
  shotIdValue: string,
  patch: VideoShotPatch,
): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  let changed = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotIdValue) return shot;
    const nextPrompt = patch.prompt !== undefined ? cleanText(patch.prompt, shot.prompt, 1200) : shot.prompt;
    const promptChanged = nextPrompt !== shot.prompt;
    const nextVersion = promptChanged ? promptVersion(nextPrompt, patch.promptSource ?? "user", shot.promptHistory.length) : undefined;
    const next = {
      ...shot,
      ...(patch.title !== undefined ? { title: cleanText(patch.title, shot.title, 80) } : {}),
      ...(patch.prompt !== undefined ? { prompt: nextPrompt } : {}),
      ...(promptChanged && nextVersion !== undefined ? { promptHistory: [...shot.promptHistory, nextVersion], activePromptId: nextVersion.id } : {}),
      ...(patch.durationSec !== undefined ? { durationSec: duration(patch.durationSec, shot.durationSec) } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.progress !== undefined ? { progress: clampProgress(patch.progress) } : {}),
      ...(patch.error !== undefined ? { error: patch.error.slice(0, 300) } : {}),
      updatedAt: now(),
    };
    changed = JSON.stringify(next) !== JSON.stringify(shot);
    return next;
  });
  if (!changed) return normalized;
  const next = { ...normalized, project: { ...project, shots, activeShotId: shotIdValue, updatedAt: now() } };
  return appendEvent(next, "shot_updated", `已更新镜头 ${shotIdValue}`);
}

export function setAgentShotPrompt(state: VideoStudioState, shotIdValue: string, prompt: string): VideoStudioState {
  return patchVideoShot(state, shotIdValue, { prompt, promptSource: "agent" });
}

export function selectPromptVersion(state: VideoStudioState, shotIdValue: string, promptId: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotIdValue) return shot;
    const version = shot.promptHistory.find((item) => item.id === promptId);
    return version === undefined ? shot : { ...shot, prompt: version.prompt, activePromptId: version.id, updatedAt: now() };
  });
  return appendEvent({ ...normalized, project: { ...project, shots, activeShotId: shotIdValue, updatedAt: now() } }, "shot_updated", `已恢复镜头 ${shotIdValue} 的历史提示词`);
}

export function setVideoShotAsset(
  state: VideoStudioState,
  shotIdValue: string,
  asset: { readonly attachmentId?: string; readonly previewUrl?: string },
): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotIdValue) return shot;
    const hasAsset = asset.attachmentId !== undefined || asset.previewUrl !== undefined;
    const video = hasAsset ? {
      id: versionId("video", shot.videoHistory.length),
      ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}),
      ...(asset.previewUrl !== undefined ? { previewUrl: asset.previewUrl } : {}),
      ...(shot.activePromptId !== undefined ? { promptVersionId: shot.activePromptId } : {}),
      createdAt: now(),
    } : undefined;
    return {
      ...shot,
      status: "done" as const,
      progress: 100,
      ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}),
      ...(asset.previewUrl !== undefined ? { previewUrl: asset.previewUrl } : {}),
      ...(video !== undefined ? { videoHistory: [...shot.videoHistory, video] } : {}),
      error: undefined,
      updatedAt: now(),
    };
  });
  return appendEvent(
    { ...normalized, project: { ...project, shots, activeShotId: shotIdValue, updatedAt: now() } },
    "generation_finished",
    `镜头 ${shotIdValue} 已完成，可人工复核；视频版本已保留`,
  );
}

export function selectVideoVersion(state: VideoStudioState, shotIdValue: string, videoId: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotIdValue) return shot;
    const video = shot.videoHistory.find((item) => item.id === videoId);
    return video === undefined ? shot : {
      ...shot,
      ...(video.attachmentId !== undefined ? { attachmentId: video.attachmentId } : {}),
      ...(video.previewUrl !== undefined ? { previewUrl: video.previewUrl } : {}),
      updatedAt: now(),
    };
  });
  return appendEvent({ ...normalized, project: { ...project, shots, activeShotId: shotIdValue, timeline: { ...project.timeline, selectedVideoId: videoId }, updatedAt: now() } }, "timeline_updated", `已选中镜头 ${shotIdValue} 的视频版本 ${videoId}`);
}

export function deletePromptHistory(state: VideoStudioState, shotIdValue: string, promptId: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shots = project.shots.map((shot) => shot.id !== shotIdValue ? shot : {
    ...shot,
    promptHistory: shot.promptHistory.filter((item) => item.id !== promptId),
    ...(shot.activePromptId === promptId ? { activePromptId: undefined } : {}),
    updatedAt: now(),
  });
  return appendEvent({ ...normalized, project: { ...project, shots, updatedAt: now() } }, "shot_updated", `已删除镜头 ${shotIdValue} 的提示词历史`);
}

export function deleteVideoHistory(state: VideoStudioState, shotIdValue: string, videoId: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotIdValue) return shot;
    const remaining = shot.videoHistory.filter((item) => item.id !== videoId);
    const fallback = remaining[remaining.length - 1];
    return {
      ...shot,
      videoHistory: remaining,
      ...(fallback?.attachmentId !== undefined ? { attachmentId: fallback.attachmentId, previewUrl: fallback.previewUrl } : remaining.length === 0 ? { attachmentId: undefined, previewUrl: undefined } : {}),
      updatedAt: now(),
    };
  });
  const videoClips = project.timeline.videoClips.filter((clip) => clip.videoId !== videoId);
  return appendEvent({ ...normalized, project: { ...project, shots, timeline: { ...project.timeline, videoClips }, updatedAt: now() } }, "timeline_updated", `已删除镜头 ${shotIdValue} 的视频历史`);
}

function timelineEnd(clips: readonly VideoTimelineClip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clip.startSec + clip.durationSec), 0);
}

export function addVideoToTimeline(state: VideoStudioState, shotIdValue: string, videoId?: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shot = project.shots.find((item) => item.id === shotIdValue);
  if (shot === undefined) return normalized;
  const video = videoId === undefined ? shot.videoHistory[shot.videoHistory.length - 1] : shot.videoHistory.find((item) => item.id === videoId);
  const attachmentId = video?.attachmentId ?? shot.attachmentId;
  if (video === undefined || attachmentId === undefined) return normalized;
  const clip: VideoTimelineClip = {
    id: versionId("clip", project.timeline.videoClips.length),
    shotId: shot.id,
    videoId: video.id,
    attachmentId,
    startSec: timelineEnd(project.timeline.videoClips),
    durationSec: shot.durationSec,
    trimStartSec: 0,
  };
  return appendEvent({ ...normalized, project: { ...project, timeline: { ...project.timeline, videoClips: [...project.timeline.videoClips, clip], selectedVideoId: video.id }, updatedAt: now() } }, "timeline_updated", `已将镜头 ${shot.index} 的视频加入轨道`);
}

export function removeTimelineClip(state: VideoStudioState, clipId: string): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const videoClips = project.timeline.videoClips.filter((clip) => clip.id !== clipId);
  return appendEvent({ ...normalized, project: { ...project, timeline: { ...project.timeline, videoClips }, updatedAt: now() } }, "timeline_updated", "已从视频轨道移除片段");
}

export function setAudioTrack(
  state: VideoStudioState,
  track: { readonly attachmentId: string; readonly previewUrl?: string; readonly startSec?: number; readonly trimStartSec?: number; readonly durationSec?: number; readonly volume?: number; readonly mode?: VideoAudioMode },
): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null || track.attachmentId.trim() === "") return normalized;
  const audioTrack: VideoAudioTrack = {
    attachmentId: track.attachmentId.trim(),
    ...(track.previewUrl !== undefined ? { previewUrl: track.previewUrl } : {}),
    startSec: nonNegative(track.startSec),
    trimStartSec: nonNegative(track.trimStartSec),
    ...(track.durationSec !== undefined ? { durationSec: Math.max(0.1, nonNegative(track.durationSec)) } : {}),
    volume: Math.max(0, Math.min(2, track.volume ?? 1)),
    mode: track.mode === "mix" ? "mix" : "replace",
    updatedAt: now(),
  };
  return appendEvent({ ...normalized, project: { ...project, timeline: { ...project.timeline, audioTrack }, updatedAt: now() } }, "timeline_updated", `已设置音轨 ${audioTrack.attachmentId}`);
}

export function trimAudioTrack(state: VideoStudioState, trimStartSec: number, durationSec: number): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null || project.timeline.audioTrack === undefined) return normalized;
  const audioTrack = { ...project.timeline.audioTrack, trimStartSec: nonNegative(trimStartSec), durationSec: Math.max(0.1, nonNegative(durationSec)), updatedAt: now() };
  return appendEvent({ ...normalized, project: { ...project, timeline: { ...project.timeline, audioTrack }, updatedAt: now() } }, "timeline_updated", "已调整音轨裁剪区间");
}

export function clearAudioTrack(state: VideoStudioState): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  return project === null ? normalized : appendEvent({ ...normalized, project: { ...project, timeline: { ...project.timeline, audioTrack: undefined }, updatedAt: now() } }, "timeline_updated", "已清除音轨");
}

export function setTimelineOutputAsset(state: VideoStudioState, asset: { readonly attachmentId?: string; readonly previewUrl?: string }): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const outputVideo: VideoAssetVersion = { id: versionId("export", 0), ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}), ...(asset.previewUrl !== undefined ? { previewUrl: asset.previewUrl } : {}), createdAt: now() };
  return { ...normalized, project: { ...project, timeline: { ...project.timeline, outputVideo }, exportStatus: "ready", exportedAttachmentId: asset.attachmentId, updatedAt: now() } };
}

export function markVideoExportRequested(state: VideoStudioState): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  if (normalized.project === null) return normalized;
  return appendEvent({ ...normalized, project: { ...normalized.project, exportStatus: "requested", updatedAt: now() } }, "export_requested", "已请求合成最终视频");
}

export function stateHasPendingGeneration(state: VideoStudioState): boolean {
  return normalizeVideoStudioState(state).project?.shots.some((shot) => shot.status === "queued" || shot.status === "generating") ?? false;
}

export function buildShotPrompt(project: VideoProject, shot: VideoShot): string {
  return [
    `视频项目：${project.title}`,
    `项目简报：${project.brief}`,
    `画幅：${project.aspectRatio}；镜头时长：${shot.durationSec} 秒`,
    `镜头 ID：${shot.id}；镜头 ${shot.index}「${shot.title}」：${shot.prompt}`,
    ...(shot.attachmentId !== undefined ? [`当前视频参考附件：${shot.attachmentId}；如需基于当前版本改动，优先调用 video_edit。`] : []),
    "请调用合适的视频工具生成这一镜，不要只回复说明；完成后返回 attachment id。保持角色、场景、光线与前后镜头连续；若素材或模型不可用，明确报告可重试错误。",
  ].join("\n");
}

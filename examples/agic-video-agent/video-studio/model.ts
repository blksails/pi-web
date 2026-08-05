/** 视频工作室领域模型：快照可序列化，引用只存 attachment id/URL。 */
import { validateVideoAnalysis, type VideoAnalysisResult } from "./analysis.js";

export const VIDEO_STUDIO_DOMAIN = "video-studio";
export const VIDEO_STUDIO_STATE_KEY = `surface:${VIDEO_STUDIO_DOMAIN}`;
export const VIDEO_PROJECT_SCHEMA_VERSION = 2;
export const MAX_VIDEO_SHOTS = 64;
export const MAX_VIDEO_DURATION_SEC = 3600;

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
export type VideoTransitionType = "cut" | "dissolve" | "fade" | "wipe" | "match-cut" | "morph";
export type VideoContinuityKind = "character" | "location" | "prop" | "lighting" | "camera" | "style" | "narrative";
export type VideoContinuityStatus = "unknown" | "verified" | "warning" | "broken";
export type VideoCommandSource = "agent" | "user" | "system";

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

export interface VideoScene {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly description: string;
  readonly shotIds: readonly string[];
  readonly continuityIds: readonly string[];
}

export interface VideoTransition {
  readonly id: string;
  readonly index: number;
  readonly fromShotId: string;
  readonly toShotId: string;
  readonly type: VideoTransitionType;
  readonly durationSec: number;
  readonly notes?: string;
}

export interface VideoContinuity {
  readonly id: string;
  readonly kind: VideoContinuityKind;
  readonly fromShotId: string;
  readonly toShotId: string;
  readonly status: VideoContinuityStatus;
  readonly confidence: number;
  readonly notes?: string;
}

export interface VideoProject {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly aspectRatio: "16:9" | "9:16" | "1:1";
  readonly targetDurationSec: number;
  readonly automation: VideoAutomation;
  readonly shots: readonly VideoShot[];
  readonly scenes: readonly VideoScene[];
  readonly transitions: readonly VideoTransition[];
  readonly continuity: readonly VideoContinuity[];
  readonly analysis?: VideoAnalysisResult;
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
    | "timeline_updated"
    | "structure_updated"
    | "analysis_updated";
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

export type VideoCommand =
  | {
    readonly type: "create-plan";
    readonly brief: string;
    readonly options?: VideoPlanOptions;
    readonly plans?: readonly AgentVideoShotPlan[];
  }
  | {
    readonly type: "update-brief";
    readonly brief: string;
    readonly title?: string;
    readonly aspectRatio?: VideoProject["aspectRatio"];
    readonly automation?: VideoAutomation;
  }
  | {
    readonly type: "update-shot";
    readonly shotId: string;
    readonly patch: VideoShotPatch;
  }
  | {
    readonly type: "set-scene";
    readonly sceneId: string;
    readonly title?: string;
    readonly description?: string;
    readonly shotIds: readonly string[];
  }
  | {
    readonly type: "set-transition";
    readonly fromShotId: string;
    readonly toShotId: string;
    readonly transition: VideoTransitionType;
    readonly durationSec?: number;
    readonly notes?: string;
  }
  | {
    readonly type: "set-continuity";
    readonly fromShotId: string;
    readonly toShotId: string;
    readonly kind: VideoContinuityKind;
    readonly status?: VideoContinuityStatus;
    readonly confidence?: number;
    readonly notes?: string;
  }
  | {
    readonly type: "set-analysis";
    readonly analysis: VideoAnalysisResult;
  };

export interface VideoTransaction {
  readonly id: string;
  readonly source: VideoCommandSource;
  readonly commands: readonly VideoCommand[];
  readonly expectedSchemaVersion?: number;
}

export interface VideoValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly errors: readonly string[];
}

export interface VideoTransactionResult {
  readonly ok: boolean;
  readonly transactionId: string;
  readonly state: VideoStudioState;
  readonly applied: number;
  readonly errors: readonly string[];
}

export function emptyVideoStudioState(): VideoStudioState {
  return { project: null, events: [] };
}

function now(): string {
  return new Date().toISOString();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function validTransition(value: unknown): VideoTransitionType | undefined {
  return value === "cut" || value === "dissolve" || value === "fade" || value === "wipe" || value === "match-cut" || value === "morph"
    ? value
    : undefined;
}

function validContinuityKind(value: unknown): VideoContinuityKind | undefined {
  return value === "character" || value === "location" || value === "prop" || value === "lighting" || value === "camera" || value === "style" || value === "narrative"
    ? value
    : undefined;
}

function validContinuityStatus(value: unknown): VideoContinuityStatus | undefined {
  return value === "unknown" || value === "verified" || value === "warning" || value === "broken"
    ? value
    : undefined;
}

function eventId(index: number, type: VideoStudioEvent["type"]): string {
  return `video-event-${String(index + 1).padStart(3, "0")}-${type}`;
}

function versionId(prefix: string, index: number, seed = ""): string {
  return `${prefix}-${String(index + 1).padStart(2, "0")}-${stableHash(`${prefix}|${seed}|${index}`)}`;
}

function appendEvent(
  state: VideoStudioState,
  type: VideoStudioEvent["type"],
  message: string,
): VideoStudioState {
  const event: VideoStudioEvent = {
    id: eventId(state.events.length, type),
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
  ownerId: string,
  createdAt = now(),
): VideoPromptVersion {
  return { id: versionId("prompt", index, `${ownerId}|${prompt}|${source}`), prompt, source, createdAt };
}

function newShot(
  index: number,
  title: string,
  prompt: string,
  durationSec: number,
  source: VideoPromptSource,
): VideoShot {
  const createdAt = now();
  const id = shotId(index);
  const version = promptVersion(prompt, source, index, id, createdAt);
  return {
    id,
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

function structureForShots(shots: readonly VideoShot[]): Pick<VideoProject, "scenes" | "transitions" | "continuity"> {
  const continuity = shots.slice(1).map((shot, index): VideoContinuity => ({
    id: `continuity-${String(index + 1).padStart(2, "0")}`,
    kind: "narrative",
    fromShotId: shots[index]?.id ?? shot.id,
    toShotId: shot.id,
    status: "unknown",
    confidence: 0.5,
    notes: "待 Agent 或人工核验前后镜头连续性",
  }));
  const transitions = shots.slice(1).map((shot, index): VideoTransition => ({
    id: `transition-${String(index + 1).padStart(2, "0")}`,
    index: index + 1,
    fromShotId: shots[index]?.id ?? shot.id,
    toShotId: shot.id,
    type: "cut",
    durationSec: 0,
  }));
  const scene: VideoScene = {
    id: "scene-01",
    index: 1,
    title: "主叙事场景",
    description: "由镜头方案自动建立的初始场景，待拆解或人工编辑细分。",
    shotIds: shots.map((shot) => shot.id),
    continuityIds: continuity.map((item) => item.id),
  };
  return { scenes: shots.length === 0 ? [] : [scene], transitions, continuity };
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
  const boundedShots = shots.slice(0, MAX_VIDEO_SHOTS);
  const structure = structureForShots(boundedShots);
  return {
    schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
    id: `project-${stableHash(`${cleanBrief}|${options.title ?? ""}|${options.aspectRatio ?? "16:9"}`)}`,
    title: cleanText(options.title, "未命名视频项目", 80),
    brief: cleanBrief,
    aspectRatio: options.aspectRatio ?? "16:9",
    targetDurationSec,
    automation: options.automation ?? "assisted",
    shots: boundedShots,
    scenes: structure.scenes,
    transitions: structure.transitions,
    continuity: structure.continuity,
    activeShotId: boundedShots[0]?.id,
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
  const shots = Array.isArray(project.shots) ? project.shots.slice(0, MAX_VIDEO_SHOTS).map((rawShot, index) => {
    const shot = rawShot as VideoShot & { promptHistory?: readonly VideoPromptVersion[]; videoHistory?: readonly VideoAssetVersion[] };
    const history = shot.promptHistory && shot.promptHistory.length > 0
      ? shot.promptHistory
      : [{ id: `legacy-${shot.id ?? shotId(index)}`, prompt: shot.prompt ?? "", source: "template" as const, createdAt: shot.updatedAt ?? now() }];
    const videos = shot.videoHistory ?? (shot.attachmentId !== undefined || shot.previewUrl !== undefined
      ? [{ id: `legacy-video-${shot.id ?? shotId(index)}`, attachmentId: shot.attachmentId, previewUrl: shot.previewUrl, createdAt: shot.updatedAt ?? now() }]
      : []);
    return {
      ...shot,
      id: shot.id ?? shotId(index),
      index: index + 1,
      title: cleanText(shot.title, `镜头 ${index + 1}`, 80),
      prompt: cleanText(shot.prompt, `镜头 ${index + 1}`, 1200),
      durationSec: duration(shot.durationSec, 5),
      progress: clampProgress(shot.progress),
      promptHistory: history,
      activePromptId: shot.activePromptId ?? history[history.length - 1]?.id,
      videoHistory: videos,
    };
  }) : [];
  const fallbackStructure = structureForShots(shots);
  const rawScenes = (project as VideoProject & { scenes?: readonly VideoScene[] }).scenes;
  const rawTransitions = (project as VideoProject & { transitions?: readonly VideoTransition[] }).transitions;
  const rawContinuity = (project as VideoProject & { continuity?: readonly VideoContinuity[] }).continuity;
  const shotIds = new Set(shots.map((shot) => shot.id));
  const transitions = Array.isArray(rawTransitions) && rawTransitions.length > 0
    ? rawTransitions.filter((item) => shotIds.has(item.fromShotId) && shotIds.has(item.toShotId)).map((item, index) => ({
      ...item,
      id: cleanText(item.id, `transition-${String(index + 1).padStart(2, "0")}`, 80),
      index: index + 1,
      type: validTransition(item.type) ?? "cut",
      durationSec: Math.max(0, Math.min(30, nonNegative(item.durationSec))),
    }))
    : fallbackStructure.transitions;
  const continuity = Array.isArray(rawContinuity) && rawContinuity.length > 0
    ? rawContinuity.filter((item) => shotIds.has(item.fromShotId) && shotIds.has(item.toShotId)).map((item, index) => ({
      ...item,
      id: cleanText(item.id, `continuity-${String(index + 1).padStart(2, "0")}`, 80),
      kind: validContinuityKind(item.kind) ?? "narrative",
      status: validContinuityStatus(item.status) ?? "unknown",
      confidence: Math.max(0, Math.min(1, nonNegative(item.confidence, 0.5))),
    }))
    : fallbackStructure.continuity;
  const sceneList = Array.isArray(rawScenes) ? rawScenes as readonly VideoScene[] : [];
  const scenes = sceneList.length > 0
    ? sceneList.map((scene, index) => ({
      ...scene,
      id: cleanText(scene.id, `scene-${String(index + 1).padStart(2, "0")}`, 80),
      index: index + 1,
      title: cleanText(scene.title, `场景 ${index + 1}`, 80),
      description: cleanText(scene.description, "待 Agent 或人工补充场景描述", 500),
      shotIds: (Array.isArray(scene.shotIds) ? scene.shotIds : []).filter((id: string) => shotIds.has(id)),
      continuityIds: (Array.isArray(scene.continuityIds) ? scene.continuityIds : []).filter((id: string) => continuity.some((item) => item.id === id)),
    })).filter((scene) => scene.shotIds.length > 0)
    : fallbackStructure.scenes;
  const analysisValidation = project.analysis === undefined ? undefined : validateVideoAnalysis(project.analysis);
  return {
    ...candidate,
    project: {
      ...project,
      schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
      shots,
      scenes,
      transitions,
      continuity,
      ...(analysisValidation?.ok && analysisValidation.value !== undefined ? { analysis: analysisValidation.value } : {}),
      timeline: project.timeline ?? { videoClips: [] },
    },
    events: candidate.events,
  };
}

export function validateVideoProject(value: unknown): VideoValidationResult<VideoProject> {
  if (!isRecord(value)) return { ok: false, errors: ["project 必须为对象"] };
  const errors: string[] = [];
  if (value.schemaVersion !== VIDEO_PROJECT_SCHEMA_VERSION) errors.push(`schemaVersion 必须为 ${VIDEO_PROJECT_SCHEMA_VERSION}`);
  for (const key of ["id", "title", "brief", "aspectRatio", "automation", "updatedAt"] as const) {
    if (typeof value[key] !== "string" || (value[key] as string).trim() === "") errors.push(`project.${key} 无效`);
  }
  if (!Array.isArray(value.shots)) errors.push("project.shots 必须为数组");
  if (!Array.isArray(value.scenes)) errors.push("project.scenes 必须为数组");
  if (!Array.isArray(value.transitions)) errors.push("project.transitions 必须为数组");
  if (!Array.isArray(value.continuity)) errors.push("project.continuity 必须为数组");
  if (!isRecord(value.timeline)) errors.push("project.timeline 必须为对象");
  if (errors.length > 0) return { ok: false, errors };
  const normalized = normalizeVideoStudioState({ project: value, events: [] }).project;
  return normalized === null ? { ok: false, errors: ["project 无法归一化"] } : { ok: true, value: normalized, errors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandSource(value: unknown): value is VideoCommandSource {
  return value === "agent" || value === "user" || value === "system";
}

function validateShotPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowed = new Set(["title", "prompt", "promptSource", "durationSec", "status", "progress", "error"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.title !== undefined && typeof value.title !== "string") return false;
  if (value.prompt !== undefined && typeof value.prompt !== "string") return false;
  if (value.promptSource !== undefined && value.promptSource !== "agent" && value.promptSource !== "user" && value.promptSource !== "template") return false;
  if (value.durationSec !== undefined && (typeof value.durationSec !== "number" || !Number.isFinite(value.durationSec))) return false;
  if (value.status !== undefined && !["draft", "queued", "generating", "paused", "review", "done", "failed"].includes(value.status as string)) return false;
  if (value.progress !== undefined && (typeof value.progress !== "number" || !Number.isFinite(value.progress))) return false;
  return value.error === undefined || typeof value.error === "string";
}

function validateAgentPlans(value: unknown): boolean {
  return Array.isArray(value) && value.every((plan) => isRecord(plan)
    && typeof plan.title === "string"
    && typeof plan.prompt === "string"
    && typeof plan.durationSec === "number"
    && Number.isFinite(plan.durationSec));
}

function commandValidation(value: unknown, index?: number): VideoValidationResult<VideoCommand> {
  const prefix = index === undefined ? "command" : `commands[${index}]`;
  if (!isRecord(value) || typeof value.type !== "string") return { ok: false, errors: [`${prefix}.type 必须存在`] };
  const text = (key: string): boolean => typeof value[key] === "string" && (value[key] as string).trim() !== "";
  switch (value.type) {
    case "create-plan": {
      if (!text("brief")) return { ok: false, errors: [`${prefix}.brief 不能为空`] };
      if (value.plans !== undefined && (!Array.isArray(value.plans) || value.plans.length > MAX_VIDEO_SHOTS)) {
        return { ok: false, errors: [`${prefix}.plans 超出 ${MAX_VIDEO_SHOTS} 个镜头上限`] };
      }
      if (value.plans !== undefined && !validateAgentPlans(value.plans)) return { ok: false, errors: [`${prefix}.plans 结构无效`] };
      return { ok: true, value: value as unknown as VideoCommand, errors: [] };
    }
    case "update-brief":
      return text("brief") && (value.title === undefined || typeof value.title === "string")
        && (value.aspectRatio === undefined || value.aspectRatio === "16:9" || value.aspectRatio === "9:16" || value.aspectRatio === "1:1")
        && (value.automation === undefined || value.automation === "manual" || value.automation === "assisted" || value.automation === "automatic")
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix} 的项目设置无效`] };
    case "update-shot":
      return text("shotId") && validateShotPatch(value.patch)
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix}.shotId 与 patch 必须有效`] };
    case "set-scene":
      return text("sceneId") && Array.isArray(value.shotIds) && value.shotIds.every((id: unknown) => typeof id === "string" && id.trim() !== "")
        && (value.title === undefined || typeof value.title === "string")
        && (value.description === undefined || typeof value.description === "string")
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix}.sceneId 与 shotIds 必须有效`] };
    case "set-transition":
      return text("fromShotId") && text("toShotId") && validTransition(value.transition) !== undefined
        && (value.durationSec === undefined || (typeof value.durationSec === "number" && Number.isFinite(value.durationSec)))
        && (value.notes === undefined || typeof value.notes === "string")
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix} 的镜头引用或 transition 无效`] };
    case "set-continuity":
      return text("fromShotId") && text("toShotId") && validContinuityKind(value.kind) !== undefined
        && (value.status === undefined || validContinuityStatus(value.status) !== undefined)
        && (value.confidence === undefined || (typeof value.confidence === "number" && Number.isFinite(value.confidence)))
        && (value.notes === undefined || typeof value.notes === "string")
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix} 的镜头引用或 continuity kind 无效`] };
    case "set-analysis":
      return validateVideoAnalysis(value.analysis).ok
        ? { ok: true, value: value as unknown as VideoCommand, errors: [] }
        : { ok: false, errors: [`${prefix}.analysis 未通过视频拆解 schema`] };
    default:
      return { ok: false, errors: [`${prefix}.type 不受支持`] };
  }
}

export function validateVideoCommand(value: unknown): VideoValidationResult<VideoCommand> {
  return commandValidation(value);
}

export function validateVideoTransaction(value: unknown): VideoValidationResult<VideoTransaction> {
  if (!isRecord(value)) return { ok: false, errors: ["transaction 必须为对象"] };
  if (typeof value.id !== "string" || value.id.trim() === "") return { ok: false, errors: ["transaction.id 不能为空"] };
  if (!isCommandSource(value.source)) return { ok: false, errors: ["transaction.source 无效"] };
  if (!Array.isArray(value.commands) || value.commands.length === 0 || value.commands.length > 100) {
    return { ok: false, errors: ["transaction.commands 须含 1-100 个命令"] };
  }
  const errors = value.commands.flatMap((command, index) => commandValidation(command, index).errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as VideoTransaction, errors: [] }
    : { ok: false, errors };
}

function updateVideoProject(state: VideoStudioState, command: Extract<VideoCommand, { type: "update-brief" }>): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  if (normalized.project === null) return normalized;
  const project = normalized.project;
  return appendEvent({
    ...normalized,
    project: {
      ...project,
      brief: cleanText(command.brief, project.brief, 800),
      ...(command.title !== undefined ? { title: cleanText(command.title, project.title, 80) } : {}),
      ...(command.aspectRatio !== undefined ? { aspectRatio: command.aspectRatio } : {}),
      ...(command.automation !== undefined ? { automation: command.automation } : {}),
      updatedAt: now(),
    },
  }, "structure_updated", "已更新视频项目简报与创作设置");
}

function updateVideoScene(state: VideoStudioState, command: Extract<VideoCommand, { type: "set-scene" }>): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const shotIds = command.shotIds.filter((id) => project.shots.some((shot) => shot.id === id));
  const existing = project.scenes.find((scene) => scene.id === command.sceneId);
  const scene: VideoScene = {
    id: command.sceneId,
    index: existing?.index ?? project.scenes.length + 1,
    title: cleanText(command.title, existing?.title ?? "未命名场景", 80),
    description: cleanText(command.description, existing?.description ?? "", 500),
    shotIds,
    continuityIds: project.continuity.filter((item) => shotIds.includes(item.fromShotId) && shotIds.includes(item.toShotId)).map((item) => item.id),
  };
  const scenes = existing === undefined ? [...project.scenes, scene] : project.scenes.map((item) => item.id === scene.id ? scene : item);
  return appendEvent({ ...normalized, project: { ...project, scenes, updatedAt: now() } }, "structure_updated", `已更新场景 ${scene.id}`);
}

function updateVideoTransition(state: VideoStudioState, command: Extract<VideoCommand, { type: "set-transition" }>): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const existing = project.transitions.find((item) => item.fromShotId === command.fromShotId && item.toShotId === command.toShotId);
  const transition: VideoTransition = {
    id: existing?.id ?? `transition-${String(project.transitions.length + 1).padStart(2, "0")}`,
    index: existing?.index ?? project.transitions.length + 1,
    fromShotId: command.fromShotId,
    toShotId: command.toShotId,
    type: command.transition,
    durationSec: Math.max(0, Math.min(30, nonNegative(command.durationSec))),
    ...(command.notes !== undefined ? { notes: cleanText(command.notes, "", 300) } : existing?.notes !== undefined ? { notes: existing.notes } : {}),
  };
  const transitions = existing === undefined ? [...project.transitions, transition] : project.transitions.map((item) => item.id === transition.id ? transition : item);
  return appendEvent({ ...normalized, project: { ...project, transitions, updatedAt: now() } }, "structure_updated", `已更新 ${transition.fromShotId} → ${transition.toShotId} 的转场`);
}

function updateVideoContinuity(state: VideoStudioState, command: Extract<VideoCommand, { type: "set-continuity" }>): VideoStudioState {
  const normalized = normalizeVideoStudioState(state);
  const project = normalized.project;
  if (project === null) return normalized;
  const existing = project.continuity.find((item) => item.fromShotId === command.fromShotId && item.toShotId === command.toShotId && item.kind === command.kind);
  const continuity: VideoContinuity = {
    id: existing?.id ?? `continuity-${String(project.continuity.length + 1).padStart(2, "0")}`,
    kind: command.kind,
    fromShotId: command.fromShotId,
    toShotId: command.toShotId,
    status: command.status ?? existing?.status ?? "unknown",
    confidence: Math.max(0, Math.min(1, nonNegative(command.confidence, existing?.confidence ?? 0.5))),
    ...(command.notes !== undefined ? { notes: cleanText(command.notes, "", 300) } : existing?.notes !== undefined ? { notes: existing.notes } : {}),
  };
  const items = existing === undefined ? [...project.continuity, continuity] : project.continuity.map((item) => item.id === continuity.id ? continuity : item);
  return appendEvent({ ...normalized, project: { ...project, continuity: items, updatedAt: now() } }, "structure_updated", `已更新 ${continuity.fromShotId} → ${continuity.toShotId} 的连续性`);
}

function applyCheckedVideoCommand(state: VideoStudioState, command: VideoCommand): { readonly state: VideoStudioState; readonly error?: string } {
  const project = normalizeVideoStudioState(state).project;
  switch (command.type) {
    case "create-plan":
      return { state: command.plans && command.plans.length > 0
        ? createVideoPlanFromAgent(state, command.brief, command.options ?? {}, command.plans)
        : createVideoPlan(state, command.brief, command.options ?? {}) };
    case "update-brief":
      return project === null ? { state, error: "没有可更新的视频项目" } : { state: updateVideoProject(state, command) };
    case "update-shot":
      return project?.shots.some((shot) => shot.id === command.shotId)
        ? { state: patchVideoShot(state, command.shotId, command.patch) }
        : { state, error: `镜头不存在：${command.shotId}` };
    case "set-scene":
      return project === null ? { state, error: "没有可更新的视频项目" } : command.shotIds.every((id) => project.shots.some((shot) => shot.id === id))
        ? { state: updateVideoScene(state, command) }
        : { state, error: "场景引用了不存在的镜头" };
    case "set-transition":
      return project === null ? { state, error: "没有可更新的视频项目" } : command.fromShotId === command.toShotId || !project.shots.some((shot) => shot.id === command.fromShotId) || !project.shots.some((shot) => shot.id === command.toShotId)
        ? { state, error: "转场必须引用两个不同的现有镜头" }
        : { state: updateVideoTransition(state, command) };
    case "set-continuity":
      return project === null ? { state, error: "没有可更新的视频项目" } : command.fromShotId === command.toShotId || !project.shots.some((shot) => shot.id === command.fromShotId) || !project.shots.some((shot) => shot.id === command.toShotId)
        ? { state, error: "连续性必须引用两个不同的现有镜头" }
        : { state: updateVideoContinuity(state, command) };
    case "set-analysis":
      return project === null ? { state, error: "没有可附加拆解结果的视频项目" } : {
        state: appendEvent({ ...normalizeVideoStudioState(state), project: { ...project, analysis: command.analysis, updatedAt: now() } }, "analysis_updated", `已附加视频拆解结果 ${command.analysis.id}`),
      };
  }
}

export function applyVideoTransaction(state: VideoStudioState, value: unknown): VideoTransactionResult {
  const initial = normalizeVideoStudioState(state);
  const validation = validateVideoTransaction(value);
  const transactionId = isRecord(value) && typeof value.id === "string" ? value.id : "invalid-transaction";
  if (!validation.ok || validation.value === undefined) return { ok: false, transactionId, state: initial, applied: 0, errors: validation.errors };
  if (validation.value.expectedSchemaVersion !== undefined && validation.value.expectedSchemaVersion !== VIDEO_PROJECT_SCHEMA_VERSION) {
    return { ok: false, transactionId, state: initial, applied: 0, errors: [`schemaVersion 不匹配：需要 ${VIDEO_PROJECT_SCHEMA_VERSION}`] };
  }
  let next = initial;
  for (const [index, command] of validation.value.commands.entries()) {
    const result = applyCheckedVideoCommand(next, command);
    if (result.error !== undefined) return { ok: false, transactionId, state: initial, applied: 0, errors: [`commands[${index}]: ${result.error}`] };
    next = normalizeVideoStudioState(result.state);
  }
  return { ok: true, transactionId, state: next, applied: validation.value.commands.length, errors: [] };
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
    const nextVersion = promptChanged ? promptVersion(nextPrompt, patch.promptSource ?? "user", shot.promptHistory.length, shot.id) : undefined;
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
      id: versionId("video", shot.videoHistory.length, shot.id),
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
    id: versionId("clip", project.timeline.videoClips.length, project.id),
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
  const outputVideo: VideoAssetVersion = { id: versionId("export", 0, project.id), ...(asset.attachmentId !== undefined ? { attachmentId: asset.attachmentId } : {}), ...(asset.previewUrl !== undefined ? { previewUrl: asset.previewUrl } : {}), createdAt: now() };
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

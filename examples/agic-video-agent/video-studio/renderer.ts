/** 渲染 Adapter POC：核心只消费请求，FFmpeg 只存在于此适配层。 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type RenderSource =
  | { readonly kind: "color"; readonly value: string }
  | { readonly kind: "image"; readonly path: string }
  | { readonly kind: "attachment"; readonly attachmentId: string };

export type RenderTransition = "cut" | "dissolve" | "fade" | "wipe" | "match-cut" | "morph";

export interface RenderShot {
  readonly id: string;
  readonly durationSec: number;
  readonly source: RenderSource;
}

export interface VideoRenderRequest {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly shots: readonly RenderShot[];
  readonly transitions: readonly RenderTransition[];
}

export interface FfmpegRenderPlan {
  readonly args: readonly string[];
  readonly estimatedDurationSec: number;
  readonly actualTransitions: readonly RenderTransition[];
  readonly degradedTransitions: readonly RenderTransition[];
}

export interface VideoRenderResult {
  readonly engine: "ffmpeg";
  readonly outputPath: string;
  readonly estimatedDurationSec: number;
  readonly degradedTransitions: readonly RenderTransition[];
}

export interface VideoRendererAdapter {
  readonly id: string;
  render(request: VideoRenderRequest): Promise<VideoRenderResult>;
}

export interface RenderAttachmentContext {
  resolve(attachmentId: string): Promise<{ localPath(): Promise<string> }>;
  putOutput(input: { readonly bytes: Uint8Array; readonly name: string; readonly mimeType: string }): Promise<{ readonly attachmentId: string; readonly displayUrl: string }>;
}

export interface AttachmentVideoRenderRequest {
  readonly outputName?: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly shots: readonly (Omit<RenderShot, "source"> & { readonly source: { readonly kind: "attachment"; readonly attachmentId: string } })[];
  readonly transitions: readonly RenderTransition[];
}

export interface AttachmentVideoRenderResult extends VideoRenderResult {
  readonly attachmentId: string;
  readonly displayUrl: string;
}

const TRANSITIONS: readonly RenderTransition[] = ["cut", "dissolve", "fade", "wipe", "match-cut", "morph"];

function validColor(value: string): boolean {
  return /^[a-zA-Z0-9#.,]+$/.test(value);
}

export function validateRenderRequest(request: VideoRenderRequest): readonly string[] {
  const errors: string[] = [];
  if (!request.outputPath.trim()) errors.push("outputPath 不能为空");
  if (!Number.isInteger(request.width) || request.width < 2 || request.width % 2 !== 0) errors.push("width 必须为正偶数像素");
  if (!Number.isInteger(request.height) || request.height < 2 || request.height % 2 !== 0) errors.push("height 必须为正偶数像素");
  if (!Number.isInteger(request.fps) || request.fps < 1 || request.fps > 60) errors.push("fps 必须在 1-60");
  if (request.shots.length === 0) errors.push("至少需要一个镜头");
  if (request.transitions.length !== Math.max(0, request.shots.length - 1)) errors.push("transitions 必须恰好连接相邻镜头");
  for (const [index, shot] of request.shots.entries()) {
    if (!shot.id.trim() || !Number.isFinite(shot.durationSec) || shot.durationSec <= 0) errors.push(`shots[${index}] 身份或时长无效`);
    if (shot.source.kind === "color" && !validColor(shot.source.value)) errors.push(`shots[${index}] color 无效`);
    if (shot.source.kind === "image" && !shot.source.path.trim()) errors.push(`shots[${index}] image path 不能为空`);
    if (shot.source.kind === "attachment" && !shot.source.attachmentId.trim()) errors.push(`shots[${index}] attachmentId 不能为空`);
  }
  if (request.transitions.some((transition) => !TRANSITIONS.includes(transition))) errors.push("存在不支持的 transition");
  return errors;
}

function inputArgs(source: RenderSource, width: number, height: number, fps: number): string[] {
  return source.kind === "color"
    ? ["-f", "lavfi", "-i", `color=c=${source.value}:s=${width}x${height}:r=${fps}`]
    : source.kind === "image" ? ["-loop", "1", "-i", source.path] : (() => { throw new Error("attachment source must be resolved before rendering"); })();
}

function baseFilter(index: number, shot: RenderShot, width: number, height: number, fps: number, transitionBefore?: RenderTransition, transitionAfter?: RenderTransition): string {
  const filters = [
    `[${index}:v]trim=duration=${shot.durationSec},setpts=PTS-STARTPTS`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `setsar=1`,
    `fps=${fps}`,
  ];
  if (transitionBefore === "fade") filters.push("fade=t=in:st=0:d=0.25");
  if (transitionAfter === "fade") filters.push(`fade=t=out:st=${Math.max(0, shot.durationSec - 0.25)}:d=0.25`);
  filters.push("format=yuv420p");
  return `${filters.join(",")}[v${index}]`;
}

export function buildFfmpegRenderPlan(request: VideoRenderRequest): FfmpegRenderPlan {
  const errors = validateRenderRequest(request);
  if (errors.length > 0) throw new Error(errors.join("；"));
  const actualTransitions = request.transitions.filter((transition) => transition === "cut" || transition === "fade");
  const degradedTransitions = request.transitions.filter((transition) => transition !== "cut" && transition !== "fade");
  const args = ["-y"];
  for (const shot of request.shots) args.push(...inputArgs(shot.source, request.width, request.height, request.fps));
  const filters = request.shots.map((shot, index) => baseFilter(index, shot, request.width, request.height, request.fps, request.transitions[index - 1], request.transitions[index]));
  filters.push(`${request.shots.map((_shot, index) => `[v${index}]`).join("")}concat=n=${request.shots.length}:v=1:a=0[outv]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", request.outputPath);
  const estimatedDurationSec = request.shots.reduce((total, shot) => total + shot.durationSec, 0);
  return { args, estimatedDurationSec, actualTransitions, degradedTransitions };
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-2000) || `ffmpeg exited ${code ?? "unknown"}`)));
  });
}

export const ffmpegRendererAdapter: VideoRendererAdapter = {
  id: "ffmpeg-poc",
  async render(request) {
    const plan = buildFfmpegRenderPlan(request);
    await runFfmpeg(plan.args);
    return {
      engine: "ffmpeg",
      outputPath: request.outputPath,
      estimatedDurationSec: plan.estimatedDurationSec,
      degradedTransitions: plan.degradedTransitions,
    };
  },
};

export async function renderAttachmentImagesToMp4(
  request: AttachmentVideoRenderRequest,
  attachments: RenderAttachmentContext,
  adapter: VideoRendererAdapter = ffmpegRendererAdapter,
): Promise<AttachmentVideoRenderResult> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agic-video-render-"));
  const outputPath = join(tempRoot, "render.mp4");
  try {
    const shots = await Promise.all(request.shots.map(async (shot) => {
      const handle = await attachments.resolve(shot.source.attachmentId);
      const path = await handle.localPath();
      return { ...shot, source: { kind: "image" as const, path } };
    }));
    const result = await adapter.render({ outputPath, width: request.width, height: request.height, fps: request.fps, shots, transitions: request.transitions });
    const bytes = new Uint8Array(await readFile(outputPath));
    const ref = await attachments.putOutput({ bytes, name: request.outputName ?? "video-render.mp4", mimeType: "video/mp4" });
    return { ...result, attachmentId: ref.attachmentId, displayUrl: ref.displayUrl };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

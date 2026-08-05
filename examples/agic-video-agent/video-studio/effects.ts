/** 多层 VFX 契约与 FFmpeg Adapter POC；不改变 VideoProject 领域模型。 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type VfxLayer =
  | {
    readonly id: string;
    readonly kind: "color-grade";
    readonly contrast?: number;
    readonly saturation?: number;
    readonly brightness?: number;
  }
  | {
    readonly id: string;
    readonly kind: "vignette";
    readonly angle?: number;
  }
  | {
    readonly id: string;
    readonly kind: "shape";
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly opacity?: number;
  }
  | {
    readonly id: string;
    readonly kind: "text";
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly fontSize?: number;
    readonly color?: string;
    readonly startSec?: number;
    readonly endSec?: number;
  };

export interface VfxSpec {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly layers: readonly VfxLayer[];
}

export interface VfxValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface FfmpegVfxPlan {
  readonly filter: string;
  readonly appliedLayers: readonly string[];
}

export interface VfxAttachmentContext {
  resolve(attachmentId: string): Promise<{ localPath(): Promise<string> }>;
  putOutput(input: { readonly bytes: Uint8Array; readonly name: string; readonly mimeType: string }): Promise<{ readonly attachmentId: string; readonly displayUrl: string }>;
}

export interface VfxAttachmentResult extends FfmpegVfxPlan {
  readonly attachmentId: string;
  readonly displayUrl: string;
}

function numberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-zA-Z]+|#[0-9a-fA-F]{6})(?:@[0-9.]+)?$/.test(value);
}

export function validateVfxSpec(value: unknown): VfxValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, errors: ["vfx spec 必须为对象"] };
  const candidate = value as Record<string, unknown>;
  const errors: string[] = [];
  if (candidate.schemaVersion !== 1) errors.push("vfx schemaVersion 必须为 1");
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") errors.push("vfx.id 不能为空");
  if (!Array.isArray(candidate.layers) || candidate.layers.length === 0 || candidate.layers.length > 32) errors.push("vfx.layers 须含 1-32 层");
  const ids = new Set<string>();
  for (const [index, raw] of (Array.isArray(candidate.layers) ? candidate.layers : []).entries()) {
    const layer = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    if (layer === undefined || typeof layer.id !== "string" || layer.id.trim() === "" || ids.has(layer.id)) {
      errors.push(`layers[${index}] 身份无效或重复`);
      continue;
    }
    ids.add(layer.id);
    if (layer.kind === "color-grade") {
      if (layer.contrast !== undefined && !numberInRange(layer.contrast, 0, 3)) errors.push(`layers[${index}].contrast 无效`);
      if (layer.saturation !== undefined && !numberInRange(layer.saturation, 0, 3)) errors.push(`layers[${index}].saturation 无效`);
      if (layer.brightness !== undefined && !numberInRange(layer.brightness, -1, 1)) errors.push(`layers[${index}].brightness 无效`);
    } else if (layer.kind === "vignette") {
      if (layer.angle !== undefined && !numberInRange(layer.angle, 0, Math.PI)) errors.push(`layers[${index}].angle 无效`);
    } else if (layer.kind === "shape") {
      if (!numberInRange(layer.x, 0, 10000) || !numberInRange(layer.y, 0, 10000) || !numberInRange(layer.width, 1, 10000) || !numberInRange(layer.height, 1, 10000) || !validColor(layer.color)) errors.push(`layers[${index}] shape 参数无效`);
      if (layer.opacity !== undefined && !numberInRange(layer.opacity, 0, 1)) errors.push(`layers[${index}].opacity 无效`);
    } else if (layer.kind === "text") {
      if (typeof layer.text !== "string" || layer.text.length === 0 || layer.text.length > 200 || !numberInRange(layer.x, 0, 10000) || !numberInRange(layer.y, 0, 10000)) errors.push(`layers[${index}] text 参数无效`);
      if (layer.fontSize !== undefined && !numberInRange(layer.fontSize, 6, 256)) errors.push(`layers[${index}].fontSize 无效`);
      if (layer.color !== undefined && !validColor(layer.color)) errors.push(`layers[${index}].color 无效`);
      if (layer.startSec !== undefined && !numberInRange(layer.startSec, 0, 3600)) errors.push(`layers[${index}].startSec 无效`);
      if (layer.endSec !== undefined && (!numberInRange(layer.endSec, 0, 3600) || (typeof layer.startSec === "number" && layer.endSec <= layer.startSec))) errors.push(`layers[${index}].endSec 无效`);
    } else {
      errors.push(`layers[${index}].kind 不受支持`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function escapeFilterText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'").replaceAll(",", "\\,");
}

export function buildFfmpegVfxPlan(spec: VfxSpec): FfmpegVfxPlan {
  const validation = validateVfxSpec(spec);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const filters: string[] = [];
  for (const layer of spec.layers) {
    switch (layer.kind) {
      case "color-grade":
        filters.push(`eq=contrast=${layer.contrast ?? 1}:saturation=${layer.saturation ?? 1}:brightness=${layer.brightness ?? 0}`);
        break;
      case "vignette":
        filters.push(`vignette=angle=${layer.angle ?? Math.PI / 4}`);
        break;
      case "shape":
        filters.push(`drawbox=x=${layer.x}:y=${layer.y}:w=${layer.width}:h=${layer.height}:color=${layer.color}:t=fill`);
        break;
      case "text": {
        const enable = layer.startSec !== undefined || layer.endSec !== undefined
          ? `:enable='between(t\\,${layer.startSec ?? 0}\\,${layer.endSec ?? 3600})'`
          : "";
        filters.push(`drawtext=text='${escapeFilterText(layer.text)}':x=${layer.x}:y=${layer.y}:fontsize=${layer.fontSize ?? 32}:fontcolor=${layer.color ?? "white"}${enable}`);
        break;
      }
    }
  }
  return { filter: filters.join(","), appliedLayers: spec.layers.map((layer) => layer.id) };
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-2000) || `ffmpeg exited ${code ?? "unknown"}`)));
  });
}

export async function applyFfmpegVfx(inputPath: string, outputPath: string, spec: VfxSpec): Promise<FfmpegVfxPlan> {
  const plan = buildFfmpegVfxPlan(spec);
  await runFfmpeg(["-y", "-i", inputPath, "-vf", plan.filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]);
  return plan;
}

export async function applyAttachmentVfxToMp4(
  inputAttachmentId: string,
  outputName: string,
  spec: VfxSpec,
  attachments: VfxAttachmentContext,
): Promise<VfxAttachmentResult> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agic-video-vfx-"));
  const outputPath = join(tempRoot, "vfx.mp4");
  try {
    const input = await attachments.resolve(inputAttachmentId);
    const plan = await applyFfmpegVfx(await input.localPath(), outputPath, spec);
    const ref = await attachments.putOutput({ bytes: new Uint8Array(await readFile(outputPath)), name: outputName || "video-vfx.mp4", mimeType: "video/mp4" });
    return { ...plan, attachmentId: ref.attachmentId, displayUrl: ref.displayUrl };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

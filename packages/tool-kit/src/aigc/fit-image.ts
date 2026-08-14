/**
 * 把图像精确化到用户目标尺寸(对标 pi-labs fitImageToTarget)。
 * sharp 按需加载:未装则返回 undefined,调用方保留原图。
 */
import { planGeometry, type Size } from "./size-fit.js";

export type FittedImage = { bytes: Uint8Array; mimeType: string };

interface SharpPipeline {
  metadata: () => Promise<{ width?: number; height?: number }>;
  resize: (opts: {
    width: number;
    height: number;
    fit: "cover" | "contain";
    position?: string;
    kernel?: string;
    withoutEnlargement?: boolean;
  }) => SharpPipeline;
  jpeg: (opts: { quality: number; mozjpeg?: boolean }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
}
type SharpFn = (input: Uint8Array, options?: { failOn?: string }) => SharpPipeline;

function decodeDataUri(uri: string): { bytes: Uint8Array; mimeType: string } | undefined {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri);
  if (!m) return undefined;
  const mime = m[1] ?? "image/png";
  const bytes = m[2]
    ? new Uint8Array(Buffer.from(m[3] ?? "", "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(m[3] ?? ""), "utf8"));
  return { mimeType: mime, bytes };
}

async function loadSharp(): Promise<SharpFn | undefined> {
  try {
    const mod: unknown = await import("sharp");
    if (typeof mod === "function") return mod as SharpFn;
    if (mod !== null && typeof mod === "object" && "default" in mod) {
      const d = (mod as { default: unknown }).default;
      if (typeof d === "function") return d as SharpFn;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function fitImageBytesToTarget(
  input: Uint8Array,
  target: Size,
): Promise<FittedImage | undefined> {
  const sharp = await loadSharp();
  if (sharp === undefined) return undefined;
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const aw = meta.width;
  const ah = meta.height;
  if (!aw || !ah) return undefined;
  const mode = planGeometry({ w: aw, h: ah }, target);
  let pipeline = sharp(input, { failOn: "none" });
  if (mode === "cover") {
    pipeline = pipeline.resize({
      width: target.w,
      height: target.h,
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
      withoutEnlargement: false,
    });
  } else if (mode === "contain") {
    pipeline = pipeline.resize({
      width: target.w,
      height: target.h,
      fit: "contain",
      kernel: "lanczos3",
      withoutEnlargement: false,
    });
  }
  const bytes = new Uint8Array(await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer());
  return { bytes, mimeType: "image/jpeg" };
}

export async function fitDataUriToTarget(
  dataUri: string,
  target: Size,
): Promise<FittedImage | undefined> {
  const decoded = decodeDataUri(dataUri);
  if (decoded === undefined) return undefined;
  return fitImageBytesToTarget(decoded.bytes, target);
}

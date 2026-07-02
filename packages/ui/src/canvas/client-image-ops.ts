/**
 * B 档客户端图像处理(aigc-canvas · Req 5.1 / 5.4 / 8.1)。
 *
 * 纯浏览器 Canvas 2D:裁剪 / 旋转 / 拼贴 / 标注 + inpaint/outpaint 的 B/W mask 画布,坐标系按源图
 * **像素坐标**对齐。产出 data URI(可先 `normalizeImageDataUri`),经既有附件上传接缝落成新 `att_`
 * (base64 / 二进制**不进命令 payload**);A 档命令仅收 `att_` 引用。
 *
 * 为在 jsdom 下可测(无真实 Canvas),对 canvas 工厂与上传函数做**依赖注入**:几何计算纯函数化,
 * 光栅化经注入的 `CanvasLike` 工厂(默认 `document.createElement("canvas")`)。
 */

/** 最小 2D 上下文形状(本模块实际消费的绘制原语)。 */
export interface Ctx2DLike {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number,
  ): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** 最小 canvas 形状。 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Ctx2DLike | null;
  toDataURL(type?: string): string;
}

export type CanvasFactory = () => CanvasLike;

function defaultCanvasFactory(): CanvasLike {
  if (typeof document === "undefined") {
    throw new Error("client-image-ops: no document; inject a CanvasFactory");
  }
  return document.createElement("canvas") as unknown as CanvasLike;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSourceLike {
  /** 源图像素宽。 */
  readonly width: number;
  /** 源图像素高。 */
  readonly height: number;
  /** 可绘制源(HTMLImageElement / ImageBitmap 等);mask 生成不需要。 */
  readonly source?: CanvasImageSource;
}

/** 把裁剪框钳制到源图边界内(纯几何,坐标系对齐)。 */
export function clampRect(rect: Rect, bounds: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(rect.x, bounds.width));
  const y = Math.max(0, Math.min(rect.y, bounds.height));
  const width = Math.max(0, Math.min(rect.width, bounds.width - x));
  const height = Math.max(0, Math.min(rect.height, bounds.height - y));
  return { x, y, width, height };
}

/** 旋转 90 的倍数后的画布尺寸(纯几何)。 */
export function rotatedSize(
  size: { width: number; height: number },
  degrees: number,
): { width: number; height: number } {
  const norm = ((degrees % 360) + 360) % 360;
  return norm === 90 || norm === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

export interface ClientImageOpsDeps {
  canvasFactory?: CanvasFactory;
  mimeType?: string;
}

/**
 * 裁剪:输出尺寸 = 钳制后的裁剪框(与源图像素坐标对齐)。返回 data URI。
 */
export function cropImage(
  image: ImageSourceLike,
  rect: Rect,
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const clamped = clampRect(rect, image);
  const canvas = factory();
  canvas.width = clamped.width;
  canvas.height = clamped.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  if (image.source !== undefined) {
    // 负偏移把源图对应区域对齐到 (0,0)。
    ctx.drawImage(image.source, -clamped.x, -clamped.y);
  }
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

/** 旋转(90 的倍数):输出尺寸按 rotatedSize;绕中心旋转后绘制。 */
export function rotateImage(
  image: ImageSourceLike,
  degrees: number,
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const out = rotatedSize(image, degrees);
  const canvas = factory();
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  ctx.save();
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  if (image.source !== undefined) {
    ctx.drawImage(image.source, -image.width / 2, -image.height / 2);
  }
  ctx.restore();
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

/**
 * 生成与源图**同尺寸**的 B/W mask:黑底(保留)+ 白色 region(重绘区)。
 * 供 A 档 `inpaint` / `outpaint` 的 `mask` 参数(B 档产物喂 A 档,Req 5.4)。
 */
export function createMask(
  size: { width: number; height: number },
  regions: readonly Rect[],
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const canvas = factory();
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  // 黑底 = 保留区。
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);
  // 白 region = 重绘区(坐标系与源图像素对齐)。
  ctx.fillStyle = "#ffffff";
  for (const r of regions) {
    const c = clampRect(r, size);
    ctx.fillRect(c.x, c.y, c.width, c.height);
  }
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

// ── 上传接缝(B 档产物落 att_)─────────────────────────────────────────────────

/** 上传函数签名(对齐 react `useAttachments` 的注入形态);产物落库回传描述符。 */
export type UploadFn = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ attachment: { id: string }; displayUrl: string }>;

export interface UploadDataUriInput {
  dataUri: string;
  name: string;
  baseUrl: string;
  sessionId: string;
  upload: UploadFn;
  fileFactory?: (bytes: Uint8Array, name: string, mimeType: string) => File;
}

/** 从 data URI 解析 mimeType + 裸 base64。 */
export function parseDataUri(dataUri: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUri);
  if (match === null) return { mimeType: "application/octet-stream", base64: dataUri };
  return { mimeType: match[1] ?? "application/octet-stream", base64: match[3] ?? "" };
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/**
 * 把 data URI 上传为新 `att_`(经既有附件上传接缝);返回落库后的公开 id + 展示 URL。
 * base64 / 二进制仅在上传体内,**不进命令 payload**(A/B 档命令只收 `att_` 引用,Req 8.1)。
 */
export async function uploadDataUri(
  input: UploadDataUriInput,
): Promise<{ attachmentId: string; displayUrl: string }> {
  const { mimeType, base64 } = parseDataUri(input.dataUri);
  const bytes = base64ToBytes(base64);
  const file =
    input.fileFactory !== undefined
      ? input.fileFactory(bytes, input.name, mimeType)
      : new File([bytes as BlobPart], input.name, { type: mimeType });
  const res = await input.upload(input.baseUrl, input.sessionId, file);
  return { attachmentId: res.attachment.id, displayUrl: res.displayUrl };
}

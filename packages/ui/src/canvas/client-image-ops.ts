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
    image: CanvasImageSource | CanvasLike,
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
  // ── 可选路径原语(掩码笔迹光栅化;旧注入 fake 可缺省,strokesToMask 退化为方点)──
  strokeStyle?: string;
  lineWidth?: number;
  lineCap?: string;
  lineJoin?: string;
  globalCompositeOperation?: string;
  beginPath?(): void;
  moveTo?(x: number, y: number): void;
  lineTo?(x: number, y: number): void;
  stroke?(): void;
  arc?(x: number, y: number, r: number, a0: number, a1: number): void;
  fill?(): void;
  font?: string;
  fillText?(text: string, x: number, y: number): void;
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

// ── 图层拍平(M3:拖入资产成层 → 本地合成回流)─────────────────────────────────────

/** 一个待拍平图层(位置/尺寸均为**底图像素坐标**;后序在上)。 */
export interface FlattenLayer {
  readonly source: CanvasImageSource | CanvasLike;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 图层拍平:底图打底 + 依序绘制各层(后加的在上)。返回 data URI,经上传接缝落 `att_`
 * 后 `register` 回流画廊(B 档,Req 5.2)。
 */
export function flattenLayers(
  base: ImageSourceLike,
  layers: readonly FlattenLayer[],
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const canvas = factory();
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  if (base.source !== undefined) {
    ctx.drawImage(base.source, 0, 0, base.width, base.height);
  }
  for (const l of layers) {
    ctx.drawImage(l.source, l.x, l.y, l.w, l.h);
  }
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

// ── 掩码笔迹(掩码刷/擦除 → B/W mask)────────────────────────────────────────────

/** 一笔掩码笔迹(源图**像素坐标**折线;paint=涂白(重绘区) / erase=涂黑(收回))。 */
export interface MaskStroke {
  readonly mode: "paint" | "erase";
  /** 笔刷直径(源图像素)。 */
  readonly size: number;
  readonly points: readonly { x: number; y: number }[];
}

/** 是否存在有效重绘内容(至少一笔 paint)。 */
export function hasMaskContent(strokes: readonly MaskStroke[]): boolean {
  return strokes.some((s) => s.mode === "paint" && s.points.length > 0);
}

/**
 * 笔迹光栅化为与源图**同尺寸**的 **alpha mask PNG**(OpenAI images/edits 标准):
 *  - 全画布先铺**不透明**底(保留区,"non-transparent areas stay unchanged");
 *  - `paint` 笔迹以 `destination-out` **抠透明洞**(alpha=0 = 允许模型重绘);
 *  - `erase` 笔迹以 `source-over` 重涂不透明(收回编辑区)。
 * 注意不是黑白灰度 mask——OpenAI 用 **Alpha 通道**表达编辑区(透明=编辑,不透明=保留)。
 * 供 A 档 `inpaint` 的 `mask` 参数(B 档产物喂 A 档,Req 5.4)。
 * 注入 fake 缺路径原语时退化为逐点方块(几何近似,测试友好)。
 */
export function strokesToMask(
  size: { width: number; height: number },
  strokes: readonly MaskStroke[],
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const canvas = factory();
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  // 不透明底 = 保留区(色值无关紧要,alpha 通道才是语义)。
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);
  // paint → destination-out 抠透明洞;erase → source-over 重涂不透明。收尾自动复位。
  replayStrokes(ctx, strokes, { paint: "destination-out", erase: "source-over" });
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

// ── 标注(线/箭头/文本 → 批注参考图,M2)──────────────────────────────────────────

/** 一条标注(源图**像素坐标**;text 时 `from` 为锚点、`text` 为内容)。 */
export interface Annotation {
  readonly kind: "line" | "arrow" | "text";
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  readonly text?: string;
  /** 线宽(text 时为字号基数,实际字号 = size × 4)。 */
  readonly size: number;
}

/** 批注红(给模型看的指令色,业界惯例)。 */
export const ANNOTATION_COLOR = "#ef4444";

/** 在 ctx 上绘制标注序列(线/带头箭头/文本;fake 缺原语时静默跳过对应部分)。 */
export function drawAnnotations(
  ctx: Ctx2DLike,
  annotations: readonly Annotation[],
  color: string = ANNOTATION_COLOR,
): void {
  const hasPath =
    typeof ctx.beginPath === "function" &&
    typeof ctx.moveTo === "function" &&
    typeof ctx.lineTo === "function" &&
    typeof ctx.stroke === "function";
  for (const a of annotations) {
    if (a.kind === "text") {
      if (typeof ctx.fillText === "function") {
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.max(10, Math.round(a.size * 4))}px sans-serif`;
        ctx.fillText(a.text ?? "", a.from.x, a.from.y);
      }
      continue;
    }
    if (!hasPath) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = a.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath!();
    ctx.moveTo!(a.from.x, a.from.y);
    ctx.lineTo!(a.to.x, a.to.y);
    if (a.kind === "arrow") {
      // 箭头头:自终点回折两条短线(30°,长 = 线宽 × 3,至少 12px)。
      const angle = Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x);
      const head = Math.max(12, a.size * 3);
      for (const side of [-1, 1]) {
        const t = angle + (side * Math.PI) / 6 + Math.PI;
        ctx.moveTo!(a.to.x, a.to.y);
        ctx.lineTo!(a.to.x + Math.cos(t) * head, a.to.y + Math.sin(t) * head);
      }
    }
    ctx.stroke!();
  }
}

/**
 * 标注拍平为「批注参考图」:原图打底 + 红色标注(线/箭头/文本)。返回 data URI,经上传接缝
 * 落 `att_` 后并入 `reference` 命令的 `reference_images` —— 画个箭头写句话直接指挥模型
 * (标注即指令;M2 已拍板「烤进参考图喂模型」)。
 */
export function annotationsToImage(
  base: ImageSourceLike,
  annotations: readonly Annotation[],
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const canvas = factory();
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("client-image-ops: 2d context unavailable");
  if (base.source !== undefined) {
    ctx.drawImage(base.source, 0, 0, base.width, base.height);
  }
  drawAnnotations(ctx, annotations);
  return canvas.toDataURL(deps.mimeType ?? "image/png");
}

/** 笔迹回放:按序绘制折线(paint/erase 各配 composite);fake 缺路径原语时退化逐点方块。 */
function replayStrokes(
  ctx: Ctx2DLike,
  strokes: readonly MaskStroke[],
  composites: { paint: string; erase: string },
): void {
  const hasPath =
    typeof ctx.beginPath === "function" &&
    typeof ctx.moveTo === "function" &&
    typeof ctx.lineTo === "function" &&
    typeof ctx.stroke === "function";
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const composite = s.mode === "paint" ? composites.paint : composites.erase;
    ctx.globalCompositeOperation = composite;
    if (hasPath) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath!();
      const [first, ...rest] = s.points;
      ctx.moveTo!(first!.x, first!.y);
      if (rest.length === 0) {
        ctx.lineTo!(first!.x + 0.01, first!.y);
      } else {
        for (const p of rest) ctx.lineTo!(p.x, p.y);
      }
      ctx.stroke!();
    } else {
      ctx.fillStyle = "#000000";
      for (const p of s.points) {
        ctx.fillRect(p.x - s.size / 2, p.y - s.size / 2, s.size, s.size);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

/**
 * 掩码回贴合成(inpaint 结果的像素级局部化):
 * gpt-image 系 edits 是「整图重生成、mask 引导」,掩码外仍会漂移;本函数把模型结果 `patch`
 * **仅掩码区域**叠回原图 `base`,掩码外像素与原图完全一致(Photoshop 生成填充式回贴)。
 *
 * 三步(全本地 Canvas 2D,B 档):
 *  1. shape 画布:透明底 + 笔迹形状(paint 实描 / erase 收回)= 编辑区形状;
 *  2. patch 画布:模型结果拉到源图尺寸 → `destination-in` shape = 只剩掩码内的新内容;
 *  3. 输出画布:原图打底 + 叠 patch 画布。
 */
export function compositeByMask(
  base: ImageSourceLike,
  patch: CanvasImageSource | CanvasLike,
  strokes: readonly MaskStroke[],
  deps: ClientImageOpsDeps = {},
): string {
  const factory = deps.canvasFactory ?? defaultCanvasFactory;
  const { width, height } = base;

  // 1. 编辑区形状。
  const shape = factory();
  shape.width = width;
  shape.height = height;
  const shapeCtx = shape.getContext("2d");
  if (shapeCtx === null) throw new Error("client-image-ops: 2d context unavailable");
  replayStrokes(shapeCtx, strokes, { paint: "source-over", erase: "destination-out" });

  // 2. 模型结果裁到掩码内。
  const patchCanvas = factory();
  patchCanvas.width = width;
  patchCanvas.height = height;
  const patchCtx = patchCanvas.getContext("2d");
  if (patchCtx === null) throw new Error("client-image-ops: 2d context unavailable");
  patchCtx.drawImage(patch, 0, 0, width, height);
  patchCtx.globalCompositeOperation = "destination-in";
  patchCtx.drawImage(shape, 0, 0);
  patchCtx.globalCompositeOperation = "source-over";

  // 3. 原图打底 + 掩码内新内容。
  const out = factory();
  out.width = width;
  out.height = height;
  const outCtx = out.getContext("2d");
  if (outCtx === null) throw new Error("client-image-ops: 2d context unavailable");
  if (base.source !== undefined) {
    outCtx.drawImage(base.source, 0, 0, width, height);
  }
  outCtx.drawImage(patchCanvas, 0, 0);
  return out.toDataURL(deps.mimeType ?? "image/png");
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

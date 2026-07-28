/**
 * 上传前图片压缩(spec `upload-image-compression`,Req 1/2/3/4)。
 *
 * **为什么需要**:图像端点卡死取决于 payload 字节数,与分辨率无关。2026-07-28 真机实测,
 * 同一张 764×763 的照片 ——
 *   - 存为 PNG(766KB) → NewAPI gemini relay **23 分钟无响应**
 *   - 转 JPEG q85(174KB,像素一个没少) → 152s 正常出图
 * 故本模块的手段是**转码**而非缩放:默认保持原始像素(临床/设计类图缩放即丢细节),
 * 仅在长边超过极端上限时兜底等比缩放。
 *
 * **副产品**:重绘不保留任何元数据,EXIF(设备型号、GPS)随之清除。
 *
 * **契约**:本函数**永不抛出**。压缩是优化而非关口 —— 任何不适用或失败的情形一律返回
 * 原 `file`,调用方无需 try/catch(Req 4)。
 */

/** 触发压缩的体积阈值。实测 174KB 通过 / 766KB 卡死,取激进档以换确定性。 */
const COMPRESS_THRESHOLD_BYTES = 200 * 1024;

/** 极端尺寸兜底上限(长边)。正常照片不会触发 —— 默认不缩放是本设计的取向。 */
const MAX_EDGE = 4096;

const JPEG_QUALITY = 0.85;

/**
 * 一律跳过的类型:
 *  - GIF   压缩后动画退化为静帧;
 *  - SVG   矢量,栅格化后反而更大。
 */
const SKIP_TYPES: ReadonlySet<string> = new Set(["image/gif", "image/svg+xml"]);

/** 编码目标类型(与 {@link JPEG_QUALITY} 配套)。 */
const OUTPUT_MIME = "image/jpeg";

/** 把扩展名换成 .jpg;无扩展名则直接追加。 */
function renameToJpg(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || name}.jpg`;
}

/** 长边超过 {@link MAX_EDGE} 时等比缩放,否则原尺寸(Req 1.3/1.4)。 */
export function fitWithinMaxEdge(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 判定是否值得压缩(Req 1.5/3.2/3.3/4.2)。
 *
 * 抽成纯函数以便在无 DOM 的环境下直接测试短路逻辑 —— 短路必须**零成本**,
 * 即未达阈值 / 跳过类型 / 环境无能力时都不得触碰解码接口。
 */
export function shouldCompress(file: File): boolean {
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return false;
  if (SKIP_TYPES.has(file.type)) return false;
  if (typeof createImageBitmap !== "function") return false;
  return true;
}

/** 2D 上下文的最小可用子集(OffscreenCanvas 与 HTMLCanvasElement 共有的部分)。 */
interface DrawTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * 白底 + 重绘 + 编码。
 *
 * ★**必须先铺白底**:带 alpha 的 PNG 直接转 JPEG 会把透明区渲染成**黑色**(Req 3.1)。
 * ★优先 `OffscreenCanvas.convertToBlob`,把编码彻底移出主线程;不可用时降级常规画布。
 */
async function drawAndEncode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | null> {
  const paint = (ctx: DrawTarget): void => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
  };

  if (typeof OffscreenCanvas === "function") {
    const off = new OffscreenCanvas(width, height);
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    paint(ctx as unknown as DrawTarget);
    return off.convertToBlob({ type: OUTPUT_MIME, quality: JPEG_QUALITY });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    paint(ctx as unknown as DrawTarget);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, OUTPUT_MIME, JPEG_QUALITY);
    });
  } finally {
    // 立刻释放位图内存,不等 GC —— 批量上传时这决定了内存峰值。
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * 上传前压缩单张图片。
 *
 * @returns 压缩后的 `File`(`image/jpeg`,扩展名 `.jpg`);任何不适用或失败的情形返回原 `file`。
 */
export async function compressImage(file: File): Promise<File> {
  if (!shouldCompress(file)) return file;

  let bitmap: ImageBitmap | undefined;
  try {
    // ★`imageOrientation: "from-image"` 让浏览器先应用 EXIF Orientation(Req 2.2)。
    // 缺了它,「横着存 + 靠 EXIF 标记旋转」的手机照片重绘后会躺倒;而元数据在重绘中
    // 一并被清除,下游**再也无法补救**(Req 2.3)。这是本模块不可回归的硬约束。
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const { width, height } = fitWithinMaxEdge(bitmap.width, bitmap.height);
    const blob = await drawAndEncode(bitmap, width, height);

    // 压完反而更大(源已是高压缩率 JPEG)→ 保留原图(Req 3.4)。
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameToJpg(file.name), {
      type: OUTPUT_MIME,
      lastModified: file.lastModified,
    });
  } catch {
    // Req 4.1:压缩是优化不是关口,任何异常都不许阻断上传。
    return file;
  } finally {
    bitmap?.close();
  }
}

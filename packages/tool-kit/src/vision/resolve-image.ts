/**
 * vision 图像来源解析 — `att_<id>` 引用或「会话内最近一张图」→ {@link ResolvedImage}。
 *
 * 产出**裸 base64**(无 `data:` 前缀),直接对应 pi-ai `ImageContent.data`。
 * 刻意**不复用** `attachment/persist.ts` 的 `resolveInputToDataUri`(它产 data URI):
 * 前缀处理只有一行,跨模块抽象的收益不抵触碰既有 attachment 层的回归风险。
 *
 * 一切来自附件层的异常都被就地捕获、映射为 {@link VisionFail},绝不外泄(1.3)。
 */
import type { Attachment } from "@blksails/pi-web-protocol";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import { describeError, fail } from "./errors.js";
import type { ResolvedImage, VisionFail } from "./types.js";

/** 附件是否为图像(据 mimeType)。 */
function isImage(mimeType: string | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

/**
 * `createdAt` 的可比较时间值。
 *
 * 优先 `Date.parse`(正确处理 `Z` 与 `+08:00` 等不同偏移表示);解析失败(非法日期)
 * 回退 `NaN`,由调用方退化为字典序比较。**不要**只用字典序:当前 attachment store
 * 产出的都是 `toISOString()` 的 `Z` 形式,但这是未强制的生产者约定,
 * 一旦有来源改用偏移表示,纯字典序会把 `2026-01-01T09:00:00+08:00`(= 01:00Z)
 * 排到 `2026-01-01T02:00:00Z` 之后。
 */
function timeValue(iso: string): number {
  return Date.parse(iso);
}

/** `a` 是否严格晚于 `b`(解析失败时退化为字典序)。 */
function isNewer(a: string, b: string): boolean {
  const ta = timeValue(a);
  const tb = timeValue(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}

/**
 * 从会话附件中挑出「最近一张图」:过滤图像类型,按 `createdAt` 降序取首个。
 */
export function pickLatestImage(
  attachments: readonly Attachment[],
): Attachment | undefined {
  let latest: Attachment | undefined;
  for (const att of attachments) {
    if (!isImage(att.mimeType)) continue;
    if (latest === undefined || isNewer(att.createdAt, latest.createdAt)) latest = att;
  }
  return latest;
}

/** 把附件句柄的字节读成裸 base64。 */
async function toBase64(
  ctx: AttachmentToolContext,
  attachmentId: string,
): Promise<ResolvedImage> {
  const handle = await ctx.resolve(attachmentId);
  const mimeType = handle.meta.mimeType;
  const bytes = await handle.bytes();
  return {
    base64: Buffer.from(bytes).toString("base64"),
    mimeType,
    attachmentId,
  };
}

/**
 * 解析图像来源。
 *
 * - `image` 给定 → 解析该引用;不可解析 → `attachment_not_found`;非图像 → `not_an_image`。
 * - `image` 省略 → 取会话内最近一张图;无图 → `no_image`。
 *
 * 前置:`attCtx.available === true`(由内核前置检查,此处不重复判定)。
 */
export async function resolveImageSource(
  image: string | undefined,
  attCtx: AttachmentToolContext,
): Promise<ResolvedImage | VisionFail> {
  if (image !== undefined && image.length > 0) {
    let mimeType: string;
    try {
      const handle = await attCtx.resolve(image);
      mimeType = handle.meta.mimeType;
    } catch (err) {
      return fail("attachment_not_found", describeError(err));
    }
    // 先判类型再取字节:非图像时不必白读一遍字节。
    if (!isImage(mimeType)) {
      return fail("not_an_image", `attachment ${image} has mimeType ${mimeType}`);
    }
    try {
      return await toBase64(attCtx, image);
    } catch (err) {
      return fail("attachment_not_found", describeError(err));
    }
  }

  let attachments: readonly Attachment[];
  try {
    attachments = await attCtx.listBySession();
  } catch (err) {
    return fail("no_image", describeError(err));
  }
  const latest = pickLatestImage(attachments);
  if (latest === undefined) {
    return fail("no_image", "当前会话内没有可识别的图像");
  }
  try {
    return await toBase64(attCtx, latest.id);
  } catch (err) {
    return fail("attachment_not_found", describeError(err));
  }
}

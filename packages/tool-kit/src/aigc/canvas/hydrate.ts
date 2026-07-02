/**
 * Canvas 物化视图重建 `rebuildGalleryFromAttachments`(aigc-canvas · Req 2.1 / 7.2 / 12.x)。
 *
 * 画廊快照是 **attachment store 的物化视图**(非独立持久 state)。子进程(重)启动装配期与
 * `sync` 命令经此函数重建:
 *  1. 经**上游 `attachment-tool-bridge` seam** `attachments.listBySession()` 列当前会话附件描述符
 *     (只取轻量描述符,不物化字节,Req 12.4);
 *  2. filter `mimeType.startsWith("image/")`;
 *  3. 逐个经 `attachments.resolve(id).url()`(既有签名 seam)生成 `displayUrl`;
 *  4. 逐个经**上游 seam** `attachments.getMeta(id)` 读回不透明扩展 meta 的血缘(`derivedFrom`/`genParams`;
 *     无则根节点,Req 7.4);
 *  5. 按 `createdAt` newest-first 组 `GalleryState`。
 *
 * **不自建枚举 / meta 实现**(上游提供),仅经 `AttachmentToolContext` 消费;单个附件解析 / meta 读取
 * 失败仅跳过该资产(不崩整份重建);枚举整体失败由调用方(`createSurface.hydrate` 兜底)退到空 / 现快照。
 */
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { GalleryAsset, GalleryState } from "./schema.js";

/** 从不透明 meta 记录中安全提取 canvas 血缘(仅识别本领域字段,其余忽略)。 */
function lineageFromMeta(
  meta: Record<string, unknown> | undefined,
): { derivedFrom?: string; genParams?: unknown } {
  if (meta === undefined) return {};
  const out: { derivedFrom?: string; genParams?: unknown } = {};
  if (typeof meta.derivedFrom === "string") out.derivedFrom = meta.derivedFrom;
  if ("genParams" in meta) out.genParams = meta.genParams;
  return out;
}

/**
 * 经上游 attachment seam 枚举当前会话图片附件、附加血缘,重建 newest-first 画廊快照。
 *
 * @param attachments 上游注入的 `AttachmentToolContext`(`SurfaceCtx.attachments`)。
 * @returns 重建后的 `GalleryState`(能力不可用或无图片附件 → 空画廊)。
 */
export async function rebuildGalleryFromAttachments(
  attachments: AttachmentToolContext,
): Promise<GalleryState> {
  if (!attachments.available) return { assets: [] };

  const descriptors = await attachments.listBySession();
  const images = descriptors.filter((a) => a.mimeType.startsWith("image/"));

  const built = await Promise.all(
    images.map(async (att): Promise<GalleryAsset | undefined> => {
      try {
        const handle = await attachments.resolve(att.id);
        const displayUrl = await handle.url();
        const meta = await attachments.getMeta(att.id).catch(() => undefined);
        const { derivedFrom, genParams } = lineageFromMeta(meta);
        const asset: GalleryAsset = {
          attachmentId: att.id,
          displayUrl,
          mimeType: att.mimeType,
          name: att.name,
          createdAt: att.createdAt,
          origin: att.origin,
          ...(derivedFrom !== undefined ? { derivedFrom } : {}),
          ...(genParams !== undefined ? { genParams } : {}),
        };
        return asset;
      } catch {
        // 单个资产解析失败(签名/属主/后端瞬时)→ 跳过,不崩整份重建。
        return undefined;
      }
    }),
  );

  const assets = built.filter((a): a is GalleryAsset => a !== undefined);
  // newest-first:createdAt 倒序(ISO 8601 字符串比较即时间序)。
  assets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { assets };
}

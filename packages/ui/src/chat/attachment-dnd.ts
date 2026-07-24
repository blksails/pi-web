/**
 * composer 拖放受口的 DataTransfer 契约(attachment-dnd)。
 *
 * 发端(素材库 chip 等)以自定义 mime `text/att-id` 携带**已落库**附件的正式公开 id
 * (server 铸造 `att_…`);可选并挂 `text/uri-list`(展示 URL,chip 缩略图用)与
 * `text/plain`(展示名)。受端(pi-chat composer)解析后经 useAttachments.addExisting
 * 零上传入列,提交时仅以 id 引用上行——文件拖放(Files)不走本契约,零回归。
 */

/** 附件引用拖拽的自定义 mime(与业务侧发端字面一致,勿改)。 */
export const ATTACHMENT_ID_MIME = "text/att-id";

export interface DroppedAttachmentRef {
  readonly attachmentId: string;
  readonly name?: string;
  readonly displayUrl?: string;
}

/** dragover 期判定(此时 getData 不可用,只能看 types)。 */
export function hasAttachmentRef(dt: DataTransfer | null): boolean {
  return dt !== null && Array.from(dt.types).includes(ATTACHMENT_ID_MIME);
}

/**
 * drop 期解析:`text/att-id` 载荷按空白/逗号切分为多 id;单 id 时并读
 * `text/uri-list`(首行)与 `text/plain` 作展示 URL/名。无该 mime → null
 * (调用方放行,让文件拖放走既有路径)。
 */
export function attachmentRefsFromDataTransfer(
  dt: DataTransfer | null,
): DroppedAttachmentRef[] | null {
  if (!hasAttachmentRef(dt) || dt === null) return null;
  const ids = dt
    .getData(ATTACHMENT_ID_MIME)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (ids.length === 0) return [];
  if (ids.length === 1) {
    const uri = dt.getData("text/uri-list").split(/\r?\n/)[0]?.trim() ?? "";
    const name = dt.getData("text/plain").trim();
    return [
      {
        attachmentId: ids[0]!,
        ...(name !== "" ? { name } : {}),
        ...(uri !== "" ? { displayUrl: uri } : {}),
      },
    ];
  }
  return ids.map((attachmentId) => ({ attachmentId }));
}

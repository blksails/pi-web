/**
 * attachment-tool-bridge · L2 投影入口 `resolveAttachment`
 * (task 2.2;Req 1.1, 1.6)。
 *
 * 按公开 id 把一个已落库附件 `resolve` 成 {@link AttachmentHandle}(四形态 + 上游元数据)。
 *
 * 设计约束(design.md §AttachmentHandle / resolve · Error Handling):
 * - **存在性前置**:经门面 `head(id)` 取上游 {@link Attachment} 描述符;门面 `head` 对不存在返回
 *   `undefined`(不抛),故在此把 `undefined` 显式包装为可 `instanceof` 识别的
 *   {@link AttachmentResolveError},不返回空当成功(Req 1.6)。
 * - **不可读透传**:若读字节阶段后端抛 `BlobNotFoundError`(描述符在但字节缺失等不可读),由句柄
 *   形态调用时透传上游错误(亦可经 `instanceof` 识别),不被静默吞成空。
 * - 成功路径返回的句柄四形态全部经门面派生(localPath 委托门面 `localPath(id)`,url 委托
 *   `presignUrl`,bytes/stream 委托 `getReadStream`),**不绕过门面抠后端内部**、**无 base64 形态**。
 */
import type { ChildAttachmentStore } from "./child-store.js";
import {
  createAttachmentHandle,
  type AttachmentHandle,
} from "./attachment-handle.js";

/**
 * 解析失败错误:被解析的公开 id 不存在或不可读时抛出(Req 1.6)。
 *
 * 可经 `instanceof` 识别、是 `Error` 子类、携带命中的 `id`,使调用方(tool `execute`)能把它
 * 与「成功」明确区分并以 `details` 标失败,而非把空内容当成功。风格与上游 `BlobNotFoundError` 一致。
 */
export class AttachmentResolveError extends Error {
  constructor(public readonly id: string) {
    super(`attachment not resolvable: ${id}`);
    this.name = "AttachmentResolveError";
  }
}

/**
 * 按公开 id 解析出 {@link AttachmentHandle}(Req 1.1)。
 *
 * 经门面 `head(id)` 前置确认存在 → 组装四形态句柄;不存在 → 抛 {@link AttachmentResolveError}(Req 1.6)。
 *
 * @param store 子进程 store 客户端(上游门面)。
 * @param id    公开 id(形如 `att_<nanoid>`)。
 * @throws {AttachmentResolveError} id 不存在(门面 `head` 返回 `undefined`)。
 */
export async function resolveAttachment(
  store: ChildAttachmentStore,
  id: string,
): Promise<AttachmentHandle> {
  // 经门面取描述符;不存在返回 undefined → 包装为可识别解析错误(不返回空当成功)。
  const meta = await store.head(id);
  if (meta === undefined) {
    throw new AttachmentResolveError(id);
  }
  return createAttachmentHandle(store, meta);
}

/**
 * attachment-tool-bridge · L2 投影句柄 `AttachmentHandle`
 * (task 2.2;Req 1.1, 1.2, 1.3, 1.4, 1.5, 9.2)。
 *
 * `AttachmentHandle` 是子进程 store 客户端(即上游 {@link AttachmentStore} 门面)之上的**纯派生只读
 * 投影**:按公开 id 把一个已落库附件投影为 tool 可消费的**四形态** —— 原始字节(`bytes`)、
 * 可读流(`stream`)、本地路径(`localPath`)、网络 URL(`url`)。**不提供 base64 形态**(守 Req 9.2)。
 *
 * 设计约束(design.md §AttachmentHandle / resolve):
 * - `meta` **复用上游 {@link Attachment}** 描述符(不含字节,不内联重定义);`stream()` 的 meta
 *   **复用上游 {@link BlobMeta}**(`{ mimeType, size }`,经门面 `getReadStream` 透传,不内联)。
 * - `localPath()` 跨后端语义:**LocalFs 直接委托上游门面 `localPath(id)`**(返回 `<root>/<id>`,
 *   依赖已冻结的盘上布局 `<root>/<id>`、`key=id` 契约;**不复制、不绕过门面抠后端内部**);
 *   远程后端(S3 风格)经 {@link TempFileTracker} 懒下载临时文件(接口预留可切换,**本切片不落地
 *   S3 实现**,远程后端门面 `localPath(id)` 返回 `undefined` → 抛可识别错误,留待 future 落地)。
 * - `bytes()`/`stream()` 经门面 `getReadStream` 读后端字节(不另开后端读路径)。
 * - `url()` 复用门面 `presignUrl`(与 attachment-store 分发签名同形,Req 1.5)。
 */
import type { Attachment } from "@blksails/protocol";
import type { BlobMeta } from "../attachment/blob-store.js";
import type { ChildAttachmentStore } from "./child-store.js";

/**
 * L2 解析句柄:按公开 id 投影出的四形态访问门面 + 上游附件元数据。
 *
 * 不变式:**不物化 base64**(无 base64/data 形态,Req 9.2);四形态均经上游门面派生。
 */
export interface AttachmentHandle {
  /** 上游 {@link Attachment} 描述符(不含字节;复用,不内联重定义)。 */
  readonly meta: Attachment;
  /** 原始字节形态:从后端读全部字节(Req 1.2)。 */
  bytes(): Promise<Uint8Array>;
  /**
   * 可读流形态:`stream` + 上游 {@link BlobMeta}(`{ mimeType, size }`,不内联重定义)(Req 1.2)。
   */
  stream(): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }>;
  /**
   * 本地路径形态:LocalFs 委托上游门面 `localPath(id)` 直返落盘路径 `<root>/<id>`(不复制,Req 1.3);
   * 远程后端懒下载临时文件并登记回收(接口预留,本切片不落地 S3,Req 1.4)。
   */
  localPath(): Promise<string>;
  /** 网络 URL 形态:客户端可达展示 URL,复用门面 `presignUrl`(与分发签名同形,Req 1.5)。 */
  url(opts?: { expiresInMs?: number }): Promise<string>;
}

/**
 * 把已读出的上游 `Attachment` 描述符 + 子进程 store 门面组装为 {@link AttachmentHandle}。
 *
 * 四形态全部惰性派生(调用时才读后端/委托门面);**不在句柄上暴露 base64**(Req 9.2)。
 *
 * @param store 子进程 store 客户端(上游门面)。
 * @param meta  已由 `resolve` 经门面 `head(id)` 读出的上游附件描述符(确保 id 存在)。
 */
export function createAttachmentHandle(
  store: ChildAttachmentStore,
  meta: Attachment,
): AttachmentHandle {
  const id = meta.id;
  return {
    meta,
    async bytes(): Promise<Uint8Array> {
      // 经门面读流,聚合为整块字节(小文件/确需整块时用)。
      const { stream } = await store.getReadStream(id);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of stream) {
        // 流块可能是 Buffer/Uint8Array(二进制流)或 string(文本流);统一规整为 Uint8Array。
        const part =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(
                (chunk as Uint8Array).buffer,
                (chunk as Uint8Array).byteOffset,
                (chunk as Uint8Array).byteLength,
              );
        chunks.push(part);
        total += part.length;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    },
    async stream(): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
      // 经门面 getReadStream:stream + 上游 BlobMeta(不内联 {mimeType,size})。
      return store.getReadStream(id);
    },
    async localPath(): Promise<string> {
      // LocalFs:委托上游门面 localPath(id) 直返 <root>/<id>(不复制,不抠后端内部)。
      const path = await store.localPath(id);
      if (path === undefined) {
        // 非本地后端(无盘上路径)→ 远程懒下载接口预留,本切片不落地 S3 实现。
        // 以可识别错误暴露,而非返回空当成功(与不存在/不可读同风格)。
        throw new AttachmentLocalPathUnavailableError(id);
      }
      return path;
    },
    async url(opts?: { expiresInMs?: number }): Promise<string> {
      // 复用门面分发签名(与 attachment-store presign 同形)。
      return store.presignUrl(id, opts);
    },
  };
}

/**
 * 远程后端本地路径形态尚未落地(本切片 S3 懒下载接口预留)时抛出的可识别错误。
 *
 * 与 `AttachmentResolveError` 同风格:`instanceof` 可识别、携带命中的 id,使调用方能把
 * 「本地路径不可得(非本地后端)」与「成功」明确区分,而非把 `undefined` 当成功路径。
 */
export class AttachmentLocalPathUnavailableError extends Error {
  constructor(public readonly id: string) {
    super(`local path unavailable for non-local backend: ${id}`);
    this.name = "AttachmentLocalPathUnavailableError";
  }
}

/**
 * attachment-store · 对象存储端口 `BlobStore`(L0)+ 元信息类型 `BlobMeta` + 未找到错误。
 *
 * S3 风格、后端无关的对象存储抽象:只负责**字节**(写入/读流/元信息/可达 URL/删除),
 * 不知 `Attachment` 描述符语义(描述符由 `AttachmentRegistry` 管;字节与元数据分离)。
 * 本切片默认实现为 `LocalFsBlobBackend`(task 2.2);S3 等其他后端经配置选择(接口预留)。
 *
 * 设计约束(design.md §Components/BlobStore;Req 1.1/1.5/1.6/1.8):
 * - 五能力:`put` / `getReadStream` / `head` / `presignUrl` / `delete`(Req 1.1);
 * - 接口风格与既有可插拔存储(session-store-adapters)对齐:异步 `动词+名词`、
 *   错误类型化、后端经配置选择(Req 1.8);
 * - 读取不存在对象抛可经 `instanceof` 识别的 {@link BlobNotFoundError}(Req 1.5);
 * - `getReadStream` 的元信息统一为本模块导出的 {@link BlobMeta},供门面 `getReadStream`
 *   与下游 `attachment-tool-bridge` 复用,不另起内联类型(Req 1.6)。
 */

/**
 * 对象元信息:可重复展示所需的最小元数据。
 * 受认可的复用面 —— 门面 `getReadStream`/`head` 的 meta 与下游统一引用此类型(Req 1.6)。
 */
export interface BlobMeta {
  readonly mimeType: string;
  readonly size: number;
}

/**
 * S3 风格对象存储端口(后端无关)。仅承担字节存取;`key` 唯一性由门面保证
 * (本切片 `key` = 公开 id)。
 */
/**
 * `put` 写入回执:组合后端(union)据此报告实际承载字节的具名后端(`attachment-backend-pluggable`
 * spec 引入);单后端实现(如 `LocalFsBlobBackend`)返回空回执 `{}`,调用方零语义变化。
 */
export interface PutReceipt {
  readonly backendName?: string;
}

/**
 * `put` 的 per-call 写目标覆盖(`agent-attachment-profile` spec,Req 3.1/3.3)。仅
 * {@link ../union-blob-store.js!UnionBlobStore} 消费(优先于其 `writePolicy`);单后端实现
 * (`LocalFsBlobBackend`/`S3BlobBackend`)签名兼容但忽略——不传等价现状,零行为变化。
 */
export interface PutOptions {
  /** 显式指定的具名后端(优先于 union 的 `writePolicy`);未注册名字 → union 既有 throw 语义。 */
  readonly writeBackend?: string;
}

export interface BlobStore {
  /**
   * 写入字节(本切片由调用方传入 `key` = 公开 id)。
   * `body` 支持 `Uint8Array` 或可读流以便大文件流式落盘,避免全量入内存。
   * 返回 {@link PutReceipt}:单后端实现返回 `{}`;组合后端(union)报告实际选中的后端名,
   * 供门面把绑定固化进描述符(`attachment-backend-pluggable` spec)。
   * `opts.writeBackend` 为 per-call 写目标覆盖(`agent-attachment-profile` spec);缺省走
   * 各实现既有写路由,单后端实现忽略该参数。
   */
  put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
    opts?: PutOptions,
  ): Promise<PutReceipt>;
  /** 读取为可读流 + 元信息;不存在抛 {@link BlobNotFoundError}(Req 1.4/1.5/1.6)。 */
  getReadStream(key: string): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }>;
  /** 查询元信息;不存在抛 {@link BlobNotFoundError}(Req 1.5)。 */
  head(key: string): Promise<BlobMeta>;
  /**
   * 签发客户端可达 URL(本地后端 = 签名 `/attachments/:key/raw` URL;
   * S3 = presign,同形,Req 4.5)。
   */
  presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string>;
  /** 删除对象;不存在为幂等(不抛)。 */
  delete(key: string): Promise<void>;
}

/**
 * 读取不存在对象时抛出的「未找到」错误(Req 1.5)。
 *
 * 可经 `instanceof` 识别、是 Error 子类、携带命中的 `key`,使调用方能把它与「成功」
 * 明确区分并映射为 404(分发 handler 防枚举),而非 500。命名/风格与
 * session-store-adapters 的 `SessionStoreNotFoundError` 对齐(Req 1.8 错误类型化)。
 */
export class BlobNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`blob not found: ${key}`);
    this.name = "BlobNotFoundError";
  }
}

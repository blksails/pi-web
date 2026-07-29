/**
 * attachment · S3 字节后端 `S3BlobBackend`(`attachment-backend-pluggable` spec,任务 4.3;
 * Req 5.1, 5.3, 5.4)。
 *
 * 实现 {@link BlobStore} 端口,把字节承载在 S3 兼容对象存储(经 {@link S3Client})。
 *
 * 设计约束(design.md §S3 后端):
 * - **key 布局**:`<prefix>blob/<key>`(`prefix` 缺省空串,供同一 bucket 内多具名后端共存);
 * - **meta**:经对象头 `Content-Type`/`Content-Length` 存取,不落额外旁路对象;
 * - `head`:由 S3 `HEAD` 直接回读;
 * - `presignUrl`:委托 {@link S3Client.presignGetUrl}(SigV4 query presign),时效语义与既有本地
 *   后端一致(`opts.expiresInMs` 缺省回落 env `PI_WEB_ATTACHMENT_URL_TTL_MS`,与
 *   {@link ../local-fs-backend.js} 同一约定);
 * - 无 `diskPath` 能力(S3 承载对象无盘上路径;门面 `localPath` 对此类后端天然返回 `undefined`,
 *   契约既有允许)。
 * - 未找到 → {@link BlobNotFoundError}(把 {@link S3NotFoundError} 映射为既有类型化未找到错误,
 *   使门面/union 读路径零感知具体后端实现)。
 */
import { BlobNotFoundError, type BlobMeta, type BlobStore, type PutReceipt } from "../blob-store.js";
import { S3Client, S3NotFoundError, type S3ClientConfig } from "./s3-client.js";

/** 默认可达 URL 过期窗口(ms);与 {@link ../local-fs-backend.js} 同一 env 约定,长 TTL 使历史消息
 * 回放的签名 URL 长期可达。 */
function resolveDefaultUrlTtlMs(): number {
  const raw = process.env["PI_WEB_ATTACHMENT_URL_TTL_MS"];
  const n = raw !== undefined && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10 * 365 * 24 * 60 * 60_000;
}

/**
 * SigV4 query presign 的协议上限:`X-Amz-Expires` 不得超过 7 天(604800s),超限时 S3/MinIO
 * 直接 400 AuthorizationQueryParametersError 拒签。local-fs 的 10 年默认 TTL(HMAC 自签名,
 * 无协议上限)传到这里必须收口,否则 S3 后端开箱即坏(画廊 displayUrl 全 400)。
 */
const S3_PRESIGN_MAX_SECONDS = 604_800;

export interface S3BlobBackendConfig extends S3ClientConfig {
  /** key 前缀(缺省空串);字节对象落 `<prefix>blob/<key>`。 */
  readonly prefix?: string;
}

/** S3 兼容对象存储承载字节的 {@link BlobStore} 实现。 */
export class S3BlobBackend implements BlobStore {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(config: S3BlobBackendConfig) {
    this.client = new S3Client(config);
    this.prefix = config.prefix ?? "";
  }

  private objectKey(key: string): string {
    return `${this.prefix}blob/${key}`;
  }

  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
  ): Promise<PutReceipt> {
    await this.client.putObject(this.objectKey(key), body, { contentType: meta.mimeType });
    return {};
  }

  async getReadStream(
    key: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
    try {
      const { stream, meta } = await this.client.getObject(this.objectKey(key));
      return { stream, meta: { mimeType: meta.contentType, size: meta.contentLength } };
    } catch (err) {
      if (err instanceof S3NotFoundError) throw new BlobNotFoundError(key);
      throw err;
    }
  }

  async head(key: string): Promise<BlobMeta> {
    try {
      const meta = await this.client.headObject(this.objectKey(key));
      return { mimeType: meta.contentType, size: meta.contentLength };
    } catch (err) {
      if (err instanceof S3NotFoundError) throw new BlobNotFoundError(key);
      throw err;
    }
  }

  async presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string> {
    const expiresInMs = opts?.expiresInMs ?? resolveDefaultUrlTtlMs();
    const expiresInSeconds = Math.min(
      S3_PRESIGN_MAX_SECONDS,
      Math.max(1, Math.ceil(expiresInMs / 1000)),
    );
    return this.client.presignGetUrl(this.objectKey(key), expiresInSeconds);
  }

  /** 删除对象;不存在为幂等(端口契约,{@link S3Client.deleteObject} 已对 404 幂等)。 */
  async delete(key: string): Promise<void> {
    await this.client.deleteObject(this.objectKey(key));
  }
}

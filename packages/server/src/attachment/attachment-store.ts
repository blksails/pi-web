/**
 * attachment-store · `AttachmentStore` 门面(L0+L1 组合,task 2.4)。
 *
 * 组合 {@link BlobStore}(字节)+ {@link AttachmentRegistry}(描述符元数据)+ {@link UrlSigner}(签名),
 * 在**写路径**(`put`)内铸造公开 id、落盘字节、写描述符,对外只暴露稳定引用而非内联字节。
 *
 * 设计约束(design.md §AttachmentStore;Req 1.3/1.6/1.7/2.3/2.4/2.5/2.7/4.5):
 * - **公开 id 仅由 `put` 铸造**(经内部 {@link mintAttachmentId}),门面无对外铸造入口
 *   → 前端无法自造被系统接受为「已落库」的正式 id(Req 2.4 单一身份 / server 铸造)。
 * - **先落 blob 再写描述符**:`put` 先 `blob.put` 落字节,再 `registry.save` 写描述符;
 *   描述符写失败时**回滚已落 blob 并抛错**,绝不返回半落库引用(design.md Error Handling 业务不变式)。
 * - `head`/`getReadStream`/`presignUrl`/`verifyUrl`/`delete` 暴露读路径;`getReadStream` 的 meta
 *   统一为导出的 {@link BlobMeta}(Req 1.6,不另起内联类型)。
 * - 一等只读访问器 `localPath(id)`(委托 LocalFs 后端 {@link LocalFsBlobBackend.diskPath},
 *   返回 `<root>/<id>`,Req 1.7)与 `listBySession(sessionId)`(委托 {@link AttachmentRegistry},Req 2.7),
 *   冻结为跨 spec 复用契约。
 * - store **不对 `origin` 取值设限**:前端上传路径仅产 `"upload"`,`origin` 由调用方传入;
 *   `tool-output` 由下游 `attachment-tool-bridge` 经**同一** `put` 写入(枚举已含 `tool-output`)。
 *
 * 受认可的复用面经 barrel 导出(`AttachmentStore` 门面类型 / `PutInput` / `BlobStore` /
 * `AttachmentRegistry` / `LocalFsBlobBackend` / `BlobMeta` / `UrlSigner`),供 `attachment-tool-bridge`
 * 在 runner 子进程内组合实例化(避免下游另起内联类型)。
 */
import type { Attachment, AttachmentOrigin } from "@blksails/pi-web-protocol";
import { mintAttachmentId } from "./id.js";
import type { BlobMeta, BlobStore } from "./blob-store.js";
import type { LocalFsBlobBackend } from "./local-fs-backend.js";
import type { AttachmentRegistry } from "./attachment-registry.js";
import type { UrlSigner } from "./url-signer.js";

/**
 * `put` 写入入参:字节 + 描述符元数据(`origin` 由调用方传入,store 不设限)。
 *
 * 受认可的复用面 —— 下游 `attachment-tool-bridge` 的 `putOutput` 经此形状调用 `put`。
 */
export interface PutInput {
  /** 字节内容:`Uint8Array` 或可读流(流式落盘,避免大文件全量入内存)。 */
  readonly bytes: Uint8Array | NodeJS.ReadableStream;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  /** 所属会话 id(描述符属主)。 */
  readonly sessionId: string;
  /** 来源:`"upload"`(前端)或 `"tool-output"`(下游 bridge);store 不对取值设限。 */
  readonly origin: AttachmentOrigin;
}

/**
 * 后端可选暴露盘上绝对路径解析的契约(LocalFs 后端实现 `diskPath`)。
 *
 * 门面 `localPath(id)` 经此能力委托到本地后端;非本地后端(无 `diskPath`)返回 `undefined`。
 */
interface DiskPathCapable {
  diskPath(key: string): string;
}

function hasDiskPath(backend: unknown): backend is DiskPathCapable {
  return (
    typeof backend === "object" &&
    backend !== null &&
    typeof (backend as { diskPath?: unknown }).diskPath === "function"
  );
}

/**
 * 构造门面的依赖(组合 blob / registry / signer;`backend` 可选,用于 `localPath` 委托)。
 */
export interface AttachmentStoreDeps {
  /** 字节对象存储端口(本切片 = {@link LocalFsBlobBackend})。 */
  readonly blob: BlobStore;
  /** 描述符元数据注册表。 */
  readonly registry: AttachmentRegistry;
  /** HMAC 签名器(`presignUrl`/`verifyUrl`)。 */
  readonly signer: UrlSigner;
  /**
   * 暴露盘上路径的本地后端(用于 `localPath`)。通常与 `blob` 是同一实例;
   * 非本地后端可省略,此时 `localPath` 返回 `undefined`。
   */
  readonly backend?: LocalFsBlobBackend | DiskPathCapable;
}

/**
 * `AttachmentStore` 门面:组合字节存储 + 描述符注册表 + 签名器。
 *
 * 写路径(`put`)内铸造公开 id 并保证「先落库后引用」;读路径暴露按 id 取流/取描述符/签发与校验 URL,
 * 并提供一等只读访问器 `localPath`/`listBySession`(冻结复用契约)。
 */
export class AttachmentStore {
  private readonly blob: BlobStore;
  private readonly registry: AttachmentRegistry;
  private readonly signer: UrlSigner;
  private readonly backend?: DiskPathCapable;

  constructor(deps: AttachmentStoreDeps) {
    this.blob = deps.blob;
    this.registry = deps.registry;
    this.signer = deps.signer;
    this.backend = deps.backend && hasDiskPath(deps.backend) ? deps.backend : undefined;
  }

  /**
   * 写路径:铸造公开 id → 落盘字节 → 写描述符,返回**不含字节**的 {@link Attachment} 描述符。
   *
   * 不变式:**先落 blob 再写描述符**;描述符写失败时回滚已落 blob 并抛错,绝不返回半落库引用
   * (Req 单一身份 / 先落库后引用)。公开 id 仅在此铸造(Req 2.4)。
   */
  async put(input: PutInput): Promise<Attachment> {
    const id = mintAttachmentId();
    const meta: BlobMeta = { mimeType: input.mimeType, size: input.size };

    // 1) 先落字节(key = 公开 id,本切片单一身份)。
    await this.blob.put(id, input.bytes, meta);

    // 2) 再写描述符;失败则回滚已落 blob,绝不暴露半落库引用。
    const descriptor: Attachment = {
      id,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      origin: input.origin,
      sessionId: input.sessionId,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.registry.save(descriptor);
    } catch (err) {
      // 回滚:删除已落 blob(delete 对不存在幂等);回滚失败不掩盖原始描述符写错误。
      try {
        await this.blob.delete(id);
      } catch {
        /* 回滚失败不应掩盖原始 save 错误;blob 删除为幂等尽力而为 */
      }
      throw err;
    }
    return descriptor;
  }

  /** 按 id 取描述符(不含字节);不存在返回 `undefined`(Req 2.1)。 */
  async head(id: string): Promise<Attachment | undefined> {
    return this.registry.get(id);
  }

  /**
   * 按 id 取可读流 + 元信息;不存在抛 `BlobNotFoundError`(Req 1.4/1.6)。
   * meta 统一为导出的 {@link BlobMeta}。
   */
  async getReadStream(
    id: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
    return this.blob.getReadStream(id);
  }

  /**
   * 一等只读访问器:返回附件在本地后端的盘上绝对路径(LocalFs = `<root>/<id>`,Req 1.7)。
   *
   * 委托后端 {@link LocalFsBlobBackend.diskPath};非本地后端(无 `diskPath`)返回 `undefined`。
   * 冻结为跨 spec 复用契约(下游 `attachment-tool-bridge` 依赖)。
   */
  async localPath(id: string): Promise<string | undefined> {
    if (!this.backend) return undefined;
    return this.backend.diskPath(id);
  }

  /**
   * 一等只读访问器:按会话属主列出附件描述符(委托 {@link AttachmentRegistry.listBySession},Req 2.7)。
   *
   * 冻结为跨 spec 复用契约。
   */
  async listBySession(sessionId: string): Promise<Attachment[]> {
    return this.registry.listBySession(sessionId);
  }

  /**
   * 签发客户端可达 URL(本地后端 = 签名 `/attachments/:id/raw` URL;与 S3 presign 同形,Req 4.5)。
   */
  async presignUrl(id: string, opts?: { expiresInMs?: number }): Promise<string> {
    return this.blob.presignUrl(id, opts);
  }

  /** 校验签名 URL 的 `exp`/`sig`(常量时间;失败返回 false,防枚举,Req 4.3/4.4)。 */
  verifyUrl(id: string, exp: number, sig: string): boolean {
    return this.signer.verify(id, exp, sig);
  }

  /** 删除字节(blob)与描述符。 */
  async delete(id: string): Promise<void> {
    await this.blob.delete(id);
  }
}

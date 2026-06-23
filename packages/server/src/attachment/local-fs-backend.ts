/**
 * attachment-store · 本地文件系统后端 `LocalFsBlobBackend`(L0,task 2.2)。
 *
 * 实现后端无关的 {@link BlobStore} 端口(task 2.1 定义),把**字节**落盘到约定目录并按 key
 * 读为可读流。不知 `Attachment` 描述符语义(描述符归 `AttachmentRegistry`)。
 *
 * 设计约束(design.md §BlobStore/LocalFsBlobBackend、Physical Data Model;Req 1.2/1.3/1.4/1.6/1.7/2.6):
 * - **盘上布局**(冻结为跨 spec 契约,下游 `attachment-tool-bridge` 的 `localPath` 依赖此布局):
 *     <root>/<key>            字节内容(本切片 key = 公开 id,平铺,Req 2.6)
 *     <root>/<key>.meta.json  { mimeType, size } 旁路元信息
 * - 字节以**流式**写/读(`createWriteStream`/`createReadStream`),避免大文件全量入内存(Req 1.3/1.4);
 * - 读不存在 key 抛可经 `instanceof` 识别的 {@link BlobNotFoundError}(Req 1.5);
 * - `presignUrl` 委托注入的 {@link UrlSigner} 产 `/attachments/:key/raw?exp&sig`(与 S3 presign 同形,Req 4.5);
 * - 暴露盘上绝对路径解析 {@link LocalFsBlobBackend.diskPath}(`<root>/<key>`),供门面 `localPath(id)` 复用契约取用(Req 1.7);
 * - `delete` 对不存在为幂等(不抛),与端口契约一致。
 *
 * root 目录(`PI_WEB_ATTACHMENT_DIR`)经构造注入;完整 config 解析(目录 + secret)归 task 2.5。
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { isAbsolute, join, resolve } from "node:path";
import { BlobNotFoundError, type BlobMeta, type BlobStore } from "./blob-store.js";
import type { UrlSigner } from "./url-signer.js";

/** 默认可达 URL 过期窗口(ms);调用方可经 `presignUrl` opts 覆盖。 */
const DEFAULT_URL_TTL_MS = 5 * 60_000;

/** meta 旁路文件后缀(`<root>/<key>.meta.json`)。 */
const META_SUFFIX = ".meta.json";

/**
 * 本地文件系统对象存储后端。把字节落盘到 `<root>/<key>`、元信息落盘到 `<root>/<key>.meta.json`。
 *
 * 持久化语义:`put` 后(包含进程重启 = 对同一 root 新建实例)`getReadStream`/`head` 返回一致 mime/size。
 *
 * @param root 落盘根目录的绝对路径(单一来源,`PI_WEB_ATTACHMENT_DIR`)。
 * @param signer 用于 `presignUrl` 的 HMAC 签名器(与 S3 presign 同形,Req 4.5)。
 */
export class LocalFsBlobBackend implements BlobStore {
  private readonly root: string;

  constructor(
    root: string,
    private readonly signer: UrlSigner,
    /**
     * 分发 URL 的 base path 前缀。pi-web app 把附件分发端点挂在 `/api/**` 下
     * (见 pi-handler `sse.basePath: "/api"`),故**经 config 构造**的主/子进程 store
     * 用 `/api`,使签名 URL 直接可达;缺省 `""`(直接构造的单测/独立场景不加前缀,
     * 与既有 `/attachments/:id/raw` 形态一致,签名校验不依赖前缀)。
     */
    private readonly urlBasePath: string = "",
  ) {
    // 归一化为绝对路径,使 diskPath 永远返回稳定的绝对路径(Req 1.7)。
    this.root = isAbsolute(root) ? root : resolve(root);
  }

  /**
   * 盘上绝对路径解析:返回该附件字节在本地后端的落盘绝对路径(`<root>/<key>`)。
   *
   * 冻结为跨 spec 契约 —— 门面 `localPath(id)` 直接复用此解析(Req 1.7);布局 `<root>/<key>`、
   * key=id(平铺)是下游 `attachment-tool-bridge` 依赖的盘上契约(design.md Revalidation)。
   */
  diskPath(key: string): string {
    return join(this.root, key);
  }

  /** meta 旁路文件的盘上绝对路径(`<root>/<key>.meta.json`)。 */
  private metaPath(key: string): string {
    return join(this.root, key + META_SUFFIX);
  }

  /**
   * 流式写入字节到 `<root>/<key>` 并把 meta 落盘到旁路文件。
   *
   * `body` 支持 `Uint8Array` 或可读流;两者均经 `createWriteStream` 流式落盘,避免大文件全量入内存。
   * 本切片由门面传入 `key` = 公开 id(单一身份);未来可后置内容哈希而不改对外 id(Req 2.6)。
   */
  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
  ): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const source =
      body instanceof Uint8Array ? Readable.from(Buffer.from(body)) : body;
    // 流式落字节,再写 meta 旁路(meta 在字节之后写,保证 head 命中时字节已就位)。
    await pipeline(source, createWriteStream(this.diskPath(key)));
    await writeFile(
      this.metaPath(key),
      JSON.stringify({ mimeType: meta.mimeType, size: meta.size }),
      "utf8",
    );
  }

  /**
   * 读取为可读流 + 元信息;不存在抛 {@link BlobNotFoundError}(Req 1.4/1.5/1.6)。
   *
   * meta 类型统一为导出的 {@link BlobMeta}(供门面与下游复用,不另起内联类型)。
   */
  async getReadStream(
    key: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
    const meta = await this.head(key); // head 不存在即抛 BlobNotFoundError。
    return { stream: createReadStream(this.diskPath(key)), meta };
  }

  /** 查询元信息(读旁路文件);不存在抛 {@link BlobNotFoundError}(Req 1.5)。 */
  async head(key: string): Promise<BlobMeta> {
    let raw: string;
    try {
      raw = await readFile(this.metaPath(key), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BlobNotFoundError(key);
      }
      throw err;
    }
    const parsed = JSON.parse(raw) as BlobMeta;
    return { mimeType: parsed.mimeType, size: parsed.size };
  }

  /**
   * 签发客户端可达 URL `/attachments/:key/raw?exp&sig`(本地后端 = 签名 URL;与 S3 presign 同形,Req 4.5)。
   *
   * 委托注入的 {@link UrlSigner} 计算 `exp`/`sig`;相同 secret 的主/子进程可互验(Req 4.6 由 signer 保证)。
   */
  async presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string> {
    const { exp, sig } = this.signer.sign(key, opts?.expiresInMs ?? DEFAULT_URL_TTL_MS);
    const params = new URLSearchParams({ exp: String(exp), sig });
    return `${this.urlBasePath}/attachments/${encodeURIComponent(key)}/raw?${params.toString()}`;
  }

  /** 删除字节与 meta 旁路;不存在为幂等(不抛,Req 1.1 端口契约)。 */
  async delete(key: string): Promise<void> {
    await rm(this.diskPath(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }
}

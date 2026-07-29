/**
 * attachment · `cloud-http` 字节后端 `HttpBlobStore`(`sandbox-attachment-store` spec Wave A'1，
 * design §7.1)。
 *
 * 实现 {@link BlobStore} 端口，把字节经 HTTP 代理到 pi-clouds `cloud` 内部路由（cloud 再落 OSS）。
 * 与 {@link ../s3/s3-blob-backend.js!S3BlobBackend} 同形（远端字节后端，同一 `BlobStore` 五能力），
 * 差别只在传输层：S3 走 SigV4 直连对象存储，本类走一个受 scoped token 保护的 HTTP endpoint。
 *
 * ## 两仓线协议（与 pi-clouds `apps/cloud` 内部路由的契约，design §3.2/§7.3 为准）
 * 全部请求携带请求头 `X-Pi-Attachment-Token: <token>`（scoped attachment token，由
 * `resolveCredentialEnv` 按声明的 `tokenEnv` 变量名解析；**绝不落 console/日志**）。
 *
 * | 方法   | 路径                                  | body/说明                                            |
 * |--------|---------------------------------------|-------------------------------------------------------|
 * | PUT    | `{endpoint}/{key}`                    | body=原始字节；头 `X-Pi-Attachment-Name`/`-Mime`；响应 JSON `{backendName?}` |
 * | GET    | `{endpoint}/{key}/raw`                | 响应体=原始字节；头 `content-type`/`content-length` 即 meta |
 * | GET    | `{endpoint}/{key}/head`               | 响应 JSON `{mimeType,size}`                            |
 * | GET    | `{endpoint}/{key}/presign?expiresInMs=` | 响应 JSON `{url}`                                    |
 * | DELETE | `{endpoint}/{key}`                    | 204/404 均视为成功（幂等）                             |
 *
 * 404（`raw`/`head`）→ {@link BlobNotFoundError}（字节端口未找到语义，Req 1.5 同构）；其余非 2xx
 * 或网络层失败（连接失败/超时）→ {@link RemoteAttachmentError}。30s 请求超时（含 `put` 大文件场景，
 * design.md §7.1 30s 超时约束）。
 */
import { Readable } from "node:stream";
import { BlobNotFoundError, type BlobMeta, type BlobStore, type PutOptions, type PutReceipt } from "../blob-store.js";
import { RemoteAttachmentError } from "./remote-attachment-error.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpBlobStoreConfig {
  /** cloud 内部路由 base（不含尾部 `/`），如 `https://cloud.internal/internal/attachments/blob`。 */
  readonly endpoint: string;
  /** scoped attachment token（已从声明的 `tokenEnv` 变量名解引用为明文）。**不落 console/日志**。 */
  readonly token: string;
  /** 单次请求超时（ms），缺省 30s。 */
  readonly timeoutMs?: number;
  /** 可注入的 `fetch` 实现(单测用假端点断言路由/头/错误映射)；缺省全局 `fetch`。 */
  readonly fetchImpl?: typeof fetch;
}

/** 经 HTTP 代理到 pi-clouds cloud 内部路由的 {@link BlobStore} 实现（`kind: "cloud-http"`）。 */
export class HttpBlobStore implements BlobStore {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpBlobStoreConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private objectUrl(key: string, suffix = ""): string {
    return `${this.endpoint}/${encodeURIComponent(key)}${suffix}`;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { "X-Pi-Attachment-Token": this.token, ...extra };
  }

  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body as RequestInit["body"],
        signal: controller.signal,
      });
    } catch (err) {
      // 网络层失败(连接被拒/超时/DNS 等) —— message 不含 token(token 只在 header 里，Error.message
      // 由 fetch 自身产出，不回显请求头)。
      throw new RemoteAttachmentError(
        `cloud-http blob request failed: ${init.method} ${url}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
    _opts?: PutOptions,
  ): Promise<PutReceipt> {
    const bytes = body instanceof Uint8Array ? body : await streamToBuffer(body);
    const res = await this.request(this.objectUrl(key), {
      method: "PUT",
      headers: this.authHeaders({
        "X-Pi-Attachment-Name": key,
        "X-Pi-Attachment-Mime": meta.mimeType,
        "content-type": meta.mimeType,
      }),
      body: bytes,
    });
    if (!res.ok) throw await toRemoteError("PUT", this.objectUrl(key), res);
    const json = (await res.json().catch(() => ({}))) as { backendName?: string };
    return { backendName: json.backendName };
  }

  async getReadStream(key: string): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
    const url = this.objectUrl(key, "/raw");
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (res.status === 404) throw new BlobNotFoundError(key);
    if (!res.ok) throw await toRemoteError("GET", url, res);
    const meta: BlobMeta = {
      mimeType: res.headers.get("content-type") ?? "application/octet-stream",
      size: Number(res.headers.get("content-length") ?? "0"),
    };
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { stream: Readable.from(Buffer.from(bytes)), meta };
  }

  async head(key: string): Promise<BlobMeta> {
    const url = this.objectUrl(key, "/head");
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (res.status === 404) throw new BlobNotFoundError(key);
    if (!res.ok) throw await toRemoteError("GET", url, res);
    return (await res.json()) as BlobMeta;
  }

  async presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string> {
    const url = this.objectUrl(
      key,
      opts?.expiresInMs !== undefined ? `/presign?expiresInMs=${opts.expiresInMs}` : "/presign",
    );
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (!res.ok) throw await toRemoteError("GET", url, res);
    const json = (await res.json()) as { url: string };
    return json.url;
  }

  /** 幂等：404 视为成功(对象已不存在即达成目的)。 */
  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const res = await this.request(url, { method: "DELETE", headers: this.authHeaders() });
    if (!res.ok && res.status !== 404) throw await toRemoteError("DELETE", url, res);
  }
}

async function toRemoteError(method: string, url: string, res: Response): Promise<RemoteAttachmentError> {
  const text = await res.text().catch(() => "");
  return new RemoteAttachmentError(
    `cloud-http blob request failed: ${method} ${url} -> ${res.status}${text ? ` ${text}` : ""}`,
    res.status,
  );
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

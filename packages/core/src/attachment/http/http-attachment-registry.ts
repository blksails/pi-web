/**
 * attachment · `cloud-http` 描述符注册表 `HttpAttachmentRegistry`(`sandbox-attachment-store` spec
 * Wave A'2，design §7.1)。
 *
 * 实现 {@link AttachmentRegistryPort} 端口，把 `Attachment` 描述符经 HTTP 代理到 pi-clouds `cloud`
 * 内部路由（cloud 再落 Supabase `pi_clouds.attachments`）。与
 * {@link ../s3/s3-registry.js!S3AttachmentRegistry} 同形（远端描述符注册表，同一端口五方法）。
 *
 * ## 两仓线协议（与 pi-clouds `apps/cloud` 内部路由的契约，design §3.2/§7.3 为准）
 * 全部请求携带请求头 `X-Pi-Attachment-Token: <token>`（scoped attachment token，**绝不落
 * console/日志**）。
 *
 * | 方法 | 路径                              | body/说明                                    |
 * |------|-----------------------------------|-----------------------------------------------|
 * | POST | `{endpoint}/descriptor`           | body=JSON `Attachment` → save（幂等覆盖）      |
 * | GET  | `{endpoint}/{id}`                 | 响应 JSON `Attachment`；404 → `undefined`      |
 * | GET  | `{endpoint}?sessionId={sessionId}`| 响应 JSON `Attachment[]`                       |
 * | GET  | `{endpoint}/{id}/meta`            | 响应 JSON `ext`（或 404 → `undefined`）         |
 * | PUT  | `{endpoint}/{id}/meta`            | body=JSON `ext` → setMeta；404 → 描述符未找到  |
 *
 * 404（`{id}/meta` 的 PUT，即目标描述符不存在）→
 * {@link ../attachment-registry.js!AttachmentDescriptorNotFoundError}；其余非 2xx 或网络层失败 →
 * {@link RemoteAttachmentError}。30s 请求超时。
 */
import type { Attachment } from "@blksails/pi-web-protocol";
import {
  AttachmentDescriptorNotFoundError,
  type AttachmentRegistryPort,
} from "../attachment-registry.js";
import { RemoteAttachmentError } from "./remote-attachment-error.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpAttachmentRegistryConfig {
  /** cloud 内部路由 base（不含尾部 `/`），如 `https://cloud.internal/internal/attachments/descriptor`。 */
  readonly endpoint: string;
  /** scoped attachment token（已从声明的 `tokenEnv` 变量名解引用为明文）。**不落 console/日志**。 */
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** 经 HTTP 代理到 pi-clouds cloud 内部路由的 {@link AttachmentRegistryPort} 实现（`kind: "cloud-http"`）。 */
export class HttpAttachmentRegistry implements AttachmentRegistryPort {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpAttachmentRegistryConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { "X-Pi-Attachment-Token": this.token, ...extra };
  }

  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new RemoteAttachmentError(
        `cloud-http registry request failed: ${init.method} ${url}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async save(att: Attachment): Promise<void> {
    const url = `${this.endpoint}/descriptor`;
    const res = await this.request(url, {
      method: "POST",
      headers: this.authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(att),
    });
    if (!res.ok) throw await toRemoteError("POST", url, res);
  }

  async get(id: string): Promise<Attachment | undefined> {
    const url = `${this.endpoint}/${encodeURIComponent(id)}`;
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (res.status === 404) return undefined;
    if (!res.ok) throw await toRemoteError("GET", url, res);
    return (await res.json()) as Attachment;
  }

  async listBySession(sessionId: string): Promise<Attachment[]> {
    const url = `${this.endpoint}?sessionId=${encodeURIComponent(sessionId)}`;
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (!res.ok) throw await toRemoteError("GET", url, res);
    return (await res.json()) as Attachment[];
  }

  async getMeta(id: string): Promise<Record<string, unknown> | undefined> {
    const url = `${this.endpoint}/${encodeURIComponent(id)}/meta`;
    const res = await this.request(url, { method: "GET", headers: this.authHeaders() });
    if (res.status === 404) return undefined;
    if (!res.ok) throw await toRemoteError("GET", url, res);
    const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    return json;
  }

  async setMeta(id: string, meta: Record<string, unknown>): Promise<void> {
    const url = `${this.endpoint}/${encodeURIComponent(id)}/meta`;
    const res = await this.request(url, {
      method: "PUT",
      headers: this.authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(meta),
    });
    if (res.status === 404) throw new AttachmentDescriptorNotFoundError(id);
    if (!res.ok) throw await toRemoteError("PUT", url, res);
  }
}

async function toRemoteError(method: string, url: string, res: Response): Promise<RemoteAttachmentError> {
  const text = await res.text().catch(() => "");
  return new RemoteAttachmentError(
    `cloud-http registry request failed: ${method} ${url} -> ${res.status}${text ? ` ${text}` : ""}`,
    res.status,
  );
}

/**
 * attachment · S3 兼容对象存储最小 HTTP 客户端(`attachment-backend-pluggable` spec,任务 4.2;
 * Req 5.1)。
 *
 * 仅实现字节/描述符两层后端所需的五操作(PUT / GET / HEAD / DELETE / ListObjectsV2),经全局
 * `fetch` + {@link ../s3/sigv4.js} SigV4 header 签名直连 S3 兼容端点,零第三方运行时依赖
 * (design.md Allowed Dependencies:禁止新增第三方运行时依赖,含 AWS SDK)。
 *
 * 错误语义:HTTP 404 / S3 `NoSuchKey` → {@link S3NotFoundError}(类型化,供上层映射为
 * `BlobNotFoundError`/`undefined`);其余非 2xx → {@link S3RequestError}(携带 `status`/`code`)。
 */
import { Readable } from "node:stream";
import {
  EMPTY_PAYLOAD_HASH,
  UNSIGNED_PAYLOAD,
  signHeaders,
  presignQuery,
} from "./sigv4.js";

/** S3 端点/凭据配置(每个具名后端一份;凭据在 config 工厂层已从 env 解引用为明文字符串)。 */
export interface S3ClientConfig {
  readonly bucket: string;
  readonly region: string;
  /** 自定义端点(S3 兼容服务,如 MinIO/R2);缺省 = AWS 官方端点 `s3.<region>.amazonaws.com`。 */
  readonly endpoint?: string;
  /** 路径风格寻址(`<endpoint>/<bucket>/<key>`);缺省 `false`(虚拟托管风格)。 */
  readonly forcePathStyle?: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  /** 可注入的 `fetch` 实现(单测用假 fetch 断言请求/响应映射);缺省全局 `fetch`。 */
  readonly fetchImpl?: typeof fetch;
}

/** 对象不存在(HTTP 404 或 S3 `<Code>NoSuchKey</Code>`)。 */
export class S3NotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`s3 object not found: ${key}`);
    this.name = "S3NotFoundError";
  }
}

/** 非 2xx 且非「未找到」的请求错误(携带 HTTP 状态码与 S3 错误码,便于诊断)。 */
export class S3RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "S3RequestError";
  }
}

export interface S3ObjectMeta {
  readonly contentType: string;
  readonly contentLength: number;
}

export interface S3ListEntry {
  readonly key: string;
}

/** 端点基础信息:协议 + 裸主机(不含 bucket 前缀)。缺省 = AWS 官方端点。 */
function resolveEndpointBase(config: S3ClientConfig): { protocol: string; bareHost: string } {
  if (config.endpoint !== undefined) {
    const url = new URL(config.endpoint);
    return { protocol: url.protocol, bareHost: url.host };
  }
  const bareHost =
    config.region === "us-east-1" ? "s3.amazonaws.com" : `s3.${config.region}.amazonaws.com`;
  return { protocol: "https:", bareHost };
}

/** 解析请求的 `{ origin, host, path }`(路径风格 vs 虚拟托管风格寻址,Req 5.1)。 */
function resolveRequestTarget(
  config: S3ClientConfig,
  key: string | undefined,
): { origin: string; host: string; path: string } {
  const { protocol, bareHost } = resolveEndpointBase(config);
  const encodedKey =
    key !== undefined ? key.split("/").map(encodeURIComponent).join("/") : "";
  if (config.forcePathStyle === true) {
    return {
      origin: `${protocol}//${bareHost}`,
      host: bareHost,
      path: `/${config.bucket}${encodedKey ? `/${encodedKey}` : ""}`,
    };
  }
  const host = `${config.bucket}.${bareHost}`;
  return {
    origin: `${protocol}//${host}`,
    host,
    path: encodedKey ? `/${encodedKey}` : "/",
  };
}

function amzDateNow(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function extractS3ErrorCode(xml: string): string | undefined {
  const m = /<Code>([^<]+)<\/Code>/.exec(xml);
  return m?.[1];
}

/**
 * S3 兼容对象存储的最小 HTTP 客户端。每具名 S3 后端持有一个实例(config 工厂构造)。
 */
export class S3Client {
  constructor(private readonly config: S3ClientConfig) {}

  /** 签发指定 key 的 presign query URL(`presignUrl` 后端实现委托本方法)。 */
  presignGetUrl(key: string, expiresInSeconds: number): string {
    const { origin, host, path } = resolveRequestTarget(this.config, key);
    const query = presignQuery({
      method: "GET",
      path,
      host,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate: amzDateNow(),
      region: this.config.region,
      service: "s3",
      expiresInSeconds,
      sessionToken: this.config.sessionToken,
    });
    return `${origin}${path}?${query}`;
  }

  /**
   * 写入对象(payload hash 固定 {@link UNSIGNED_PAYLOAD}:`body` 可为可读流,签名前不缓冲整体
   * 字节以保持流式写入,S3 header 签名接受该占位值,design.md §S3 后端)。
   */
  async putObject(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: { contentType: string },
  ): Promise<void> {
    const bytes = body instanceof Uint8Array ? body : await streamToBuffer(body);
    await this.request("PUT", key, {
      headers: { "content-type": meta.contentType },
      payloadHash: UNSIGNED_PAYLOAD,
      body: bytes,
    });
  }

  /** 读取对象为可读流 + 元信息;不存在抛 {@link S3NotFoundError}。 */
  async getObject(key: string): Promise<{ stream: NodeJS.ReadableStream; meta: S3ObjectMeta }> {
    const res = await this.request("GET", key, { payloadHash: EMPTY_PAYLOAD_HASH });
    const meta = metaFromHeaders(res.headers);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { stream: Readable.from(Buffer.from(bytes)), meta };
  }

  /** 查询对象元信息(HEAD);不存在抛 {@link S3NotFoundError}。 */
  async headObject(key: string): Promise<S3ObjectMeta> {
    const res = await this.request("HEAD", key, { payloadHash: EMPTY_PAYLOAD_HASH });
    return metaFromHeaders(res.headers);
  }

  /** 删除对象;不存在为幂等(S3 delete 本身对不存在 key 返回 204,无需特殊处理)。 */
  async deleteObject(key: string): Promise<void> {
    await this.request("DELETE", key, { payloadHash: EMPTY_PAYLOAD_HASH, allow404: true });
  }

  /** 按前缀枚举对象 key(ListObjectsV2)。 */
  async listObjectsV2(prefix: string): Promise<S3ListEntry[]> {
    const { origin, host, path } = resolveRequestTarget(this.config, undefined);
    const query = { "list-type": "2", prefix };
    const res = await this.rawRequest("GET", origin, host, path, query, {
      payloadHash: EMPTY_PAYLOAD_HASH,
    });
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => ({ key: decodeXmlEntities(m[1]!) }));
    return keys;
  }

  private async request(
    method: string,
    key: string,
    opts: {
      headers?: Record<string, string>;
      payloadHash: string;
      body?: Uint8Array;
      allow404?: boolean;
    },
  ): Promise<Response> {
    const { origin, host, path } = resolveRequestTarget(this.config, key);
    return this.rawRequest(method, origin, host, path, undefined, opts);
  }

  private async rawRequest(
    method: string,
    origin: string,
    host: string,
    path: string,
    query: Record<string, string> | undefined,
    opts: {
      headers?: Record<string, string>;
      payloadHash: string;
      body?: Uint8Array;
      allow404?: boolean;
    },
  ): Promise<Response> {
    const amzDate = amzDateNow();
    const headers: Record<string, string> = {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": opts.payloadHash,
      ...(this.config.sessionToken !== undefined
        ? { "x-amz-security-token": this.config.sessionToken }
        : {}),
      ...opts.headers,
    };
    const { authorization } = signHeaders({
      method,
      path,
      query,
      headers,
      payloadHash: opts.payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate,
      region: this.config.region,
      service: "s3",
    });
    const qs = query !== undefined ? "?" + new URLSearchParams(query).toString() : "";
    const url = `${origin}${path}${qs}`;
    const doFetch = this.config.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      method,
      headers: { ...headers, authorization },
      // RequestInit["body"] typing varies across the DOM lib versions picked up by
      // different tsconfigs in this monorepo (root vs package-local); Uint8Array is
      // a valid runtime fetch body, cast via the ambient RequestInit shape to avoid
      // depending on a DOM-lib-only global type name.
      body: opts.body as RequestInit["body"],
    });
    if (res.ok) return res;
    if (res.status === 404) {
      if (opts.allow404 === true) return res;
      throw new S3NotFoundError(path);
    }
    const xml = await res.text().catch(() => "");
    const code = extractS3ErrorCode(xml) ?? String(res.status);
    if (code === "NoSuchKey") {
      if (opts.allow404 === true) return res;
      throw new S3NotFoundError(path);
    }
    throw new S3RequestError(res.status, code, `S3 request failed: ${method} ${path} -> ${res.status} ${code}`);
  }
}

function metaFromHeaders(headers: Headers): S3ObjectMeta {
  return {
    contentType: headers.get("content-type") ?? "application/octet-stream",
    contentLength: Number(headers.get("content-length") ?? "0"),
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

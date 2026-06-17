/**
 * REST 请求发送与错误归一。
 *
 * 统一:URL 拼接(baseUrl + path)、JSON body 序列化、headers 透传、注入 fetch 的发送;
 * 非 2xx → PiHttpError(尽力解析协议错误体 { code, message, fields? });
 * 响应携带 protocolVersion 时经 version 层做兼容判定(不兼容 → PiProtocolVersionError)。
 *
 * 仅依赖标准 Web Fetch;fetch 由调用方注入(createPiClient 的第二参)。
 */
import { assertProtocolVersion } from "../version.js";
import { PiHttpError, type PiErrorBody } from "./errors.js";

/** 注入式 fetch(默认全局 fetch)。 */
export type FetchLike = typeof fetch;

export interface RequestOptions {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string> | Headers;
  readonly signal?: AbortSignal;
}

/** 把 baseUrl 与 path 安全拼接(去重斜杠)。 */
export function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function toHeaderRecord(
  headers: Record<string, string> | Headers | undefined,
): Headers {
  const h = new Headers();
  if (headers instanceof Headers) {
    headers.forEach((value, key) => h.set(key, value));
  } else if (headers !== undefined) {
    for (const [key, value] of Object.entries(headers)) h.set(key, value);
  }
  return h;
}

async function parseErrorBody(res: Response): Promise<PiErrorBody | undefined> {
  try {
    const text = await res.text();
    if (text === "") return undefined;
    const json: unknown = JSON.parse(text);
    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      const body: { code?: string; message?: string; fields?: Record<string, unknown> } = {};
      if (typeof obj["code"] === "string") body.code = obj["code"];
      if (typeof obj["message"] === "string") body.message = obj["message"];
      if (typeof obj["error"] === "string" && body.message === undefined)
        body.message = obj["error"];
      if (typeof obj["fields"] === "object" && obj["fields"] !== null)
        body.fields = obj["fields"] as Record<string, unknown>;
      return body;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 发送一个 JSON REST 请求,返回已解析的响应体(204/空体返回 undefined)。
 * 非 2xx → PiHttpError;响应 protocolVersion 不兼容 → PiProtocolVersionError。
 */
export async function sendRequest<T>(
  baseUrl: string,
  fetchImpl: FetchLike,
  options: RequestOptions,
): Promise<T> {
  const headers = toHeaderRecord(options.headers);
  let bodyInit: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    bodyInit = JSON.stringify(options.body);
  }
  headers.set("accept", "application/json");

  const init: RequestInit = {
    method: options.method,
    headers,
  };
  if (bodyInit !== undefined) init.body = bodyInit;
  if (options.signal !== undefined) init.signal = options.signal;

  const res = await fetchImpl(joinUrl(baseUrl, options.path), init);

  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new PiHttpError(res.status, body);
  }

  // 读取响应体(可能为空)。
  const text = await res.text();
  if (text === "") {
    return undefined as T;
  }
  const json: unknown = JSON.parse(text);
  if (typeof json === "object" && json !== null) {
    const pv = (json as Record<string, unknown>)["protocolVersion"];
    if (typeof pv === "string") assertProtocolVersion(pv);
  }
  return json as T;
}

/**
 * Proxied `fetch` wrapper for `@blksails/pi-web-tool-kit` runtime.
 *
 * Per-request design: `proxyUrl` is threaded in per call (not read from global
 * env).  Each `EndpointBehavior.proxy` declares its own proxy URL (or a
 * `${VAR}` placeholder); variant authors opt-in explicitly.
 *
 * Supported proxy protocols (Wave 1):
 *  - `http://` / `https://`  → undici `ProxyAgent`
 *  - `socks5://`             → TODO: Wave 2 — undici `Socks5ProxyAgent`
 *                              Falls through to direct fetch for now.
 *  - no proxyUrl             → `globalThis.fetch` directly
 *
 * Dispatcher instances are cached by `proxyUrl` string to avoid the overhead
 * of constructing a new agent on every call.
 */

import { createLogger } from "@blksails/pi-web-logger";

// 命名空间 toolkit:proxy —— 代理传输不可用时的降级告警(走日志系统,非裸 console.warn)。
const log = createLogger({ namespace: "toolkit:proxy" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dispatcher = any;

interface CachedTransport {
  fetchFn: typeof fetch;
  dispatcher: Dispatcher;
}

const transportCache = new Map<string, CachedTransport>();

/**
 * 传输层超时上限(ms)。
 *
 * ★undici 的 `headersTimeout` / `bodyTimeout` 默认均为 **300s**,而图像端点实测
 * 普遍更慢:gemini relay 单图 edit(0.97MB body)在 **301.0s** 被掐断、多图(4.25MB)
 * 在 **301.6s** 被掐断,`err.cause` 均为 `HeadersTimeoutError`(2026-07-28 真机,
 * 已排除代理:清空 HTTP_PROXY/ALL_PROXY 后同样复现)。同批对照中 250s 完成的请求
 * 则正常返回 —— 即失败与否只取决于是否越过 300s 这条线,与体积/多图无关。
 *
 * 故直连与代理传输统一放宽到 15 分钟。真正的取消仍由调用方的 `AbortSignal` 负责
 * (本值只是「别在服务端还在算的时候把连接掐了」的下限保障)。
 */
const TRANSPORT_TIMEOUT_MS = 900_000;

/** 直连 dispatcher:`undefined`=未初始化,`null`=undici 不可用(此时行为与放宽前逐字一致)。 */
let directDispatcher: Dispatcher | null | undefined;

/**
 * 直连用的放宽超时 dispatcher。
 *
 * ★注意这里**仍调用 `globalThis.fetch`**、只是多传一个 `dispatcher` init 字段
 * (Node 的 global fetch 即 undici,支持该扩展)。曾一度改为直接调用 `undici.fetch`,
 * 结果所有 `vi.spyOn(globalThis, "fetch")` 的测试全部绕过 stub **打到真实网络** ——
 * 测试污染比超时本身更糟。保持调用者不变是这里的硬约束。
 */
async function getDirectDispatcher(): Promise<Dispatcher | null> {
  if (directDispatcher !== undefined) return directDispatcher;
  try {
    const undici = await import("undici");
    directDispatcher = new undici.Agent({
      headersTimeout: TRANSPORT_TIMEOUT_MS,
      bodyTimeout: TRANSPORT_TIMEOUT_MS,
    });
  } catch (err) {
    log.warn("undici unavailable; keeping global fetch default timeout (300s)", {
      error: err instanceof Error ? err.message : String(err),
    });
    directDispatcher = null;
  }
  return directDispatcher;
}

async function getTransport(proxyUrl: string): Promise<CachedTransport | null> {
  const cached = transportCache.get(proxyUrl);
  if (cached) return cached;

  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return null;
  }

  const proto = url.protocol;

  // TODO(Wave 2): socks5:// → undici Socks5ProxyAgent (remote DNS resolution).
  // For now fall through to direct fetch so a misconfigured socks proxy doesn't
  // silently break tool calls.
  if (
    proto === "socks5:" ||
    proto === "socks5h:" ||
    proto === "socks:" ||
    proto === "socks4:" ||
    proto === "socks4a:"
  ) {
    return null;
  }

  if (proto !== "http:" && proto !== "https:") return null;

  try {
    const undici = await import("undici");
    // 代理传输同样放宽超时(理由见 TRANSPORT_TIMEOUT_MS)。
    const dispatcher = new undici.ProxyAgent({
      uri: proxyUrl,
      headersTimeout: TRANSPORT_TIMEOUT_MS,
      bodyTimeout: TRANSPORT_TIMEOUT_MS,
    });
    const fetchFn = undici.fetch as unknown as typeof fetch;
    const transport: CachedTransport = { fetchFn, dispatcher };
    transportCache.set(proxyUrl, transport);
    return transport;
  } catch (err) {
    log.warn("proxy transport unavailable; falling back to direct fetch", {
      proxy: proxyUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Drop-in `fetch` replacement that routes through a proxy when `proxyUrl` is
 * provided.
 *
 * - `proxyUrl` absent / empty → `globalThis.fetch` directly.
 * - http/https proxy → undici `ProxyAgent`.
 * - socks proxy → TODO Wave 2; currently falls through to direct fetch.
 */
export async function proxyFetch(
  url: string | URL,
  init?: RequestInit,
  proxyUrl?: string,
): Promise<Response> {
  if (!proxyUrl) {
    // 直连:调用者仍是 globalThis.fetch,只附加放宽超时的 dispatcher(见 getDirectDispatcher)。
    const dispatcher = await getDirectDispatcher();
    if (!dispatcher) return globalThis.fetch(url, init);
    return globalThis.fetch(url, { ...(init ?? {}), dispatcher } as RequestInit);
  }

  const transport = await getTransport(proxyUrl);
  if (!transport) return globalThis.fetch(url, init);

  const merged: RequestInit & { dispatcher?: Dispatcher } = {
    ...(init ?? {}),
    dispatcher: transport.dispatcher,
  };
  return transport.fetchFn(url, merged);
}

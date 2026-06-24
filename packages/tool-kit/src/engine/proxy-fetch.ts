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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dispatcher = any;

interface CachedTransport {
  fetchFn: typeof fetch;
  dispatcher: Dispatcher;
}

const transportCache = new Map<string, CachedTransport>();

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
    const dispatcher = new undici.ProxyAgent({ uri: proxyUrl });
    const fetchFn = undici.fetch as unknown as typeof fetch;
    const transport: CachedTransport = { fetchFn, dispatcher };
    transportCache.set(proxyUrl, transport);
    return transport;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "tool_kit_proxy_unavailable",
        proxy: proxyUrl,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
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
  if (!proxyUrl) return globalThis.fetch(url, init);

  const transport = await getTransport(proxyUrl);
  if (!transport) return globalThis.fetch(url, init);

  const merged: RequestInit & { dispatcher?: Dispatcher } = {
    ...(init ?? {}),
    dispatcher: transport.dispatcher,
  };
  return transport.fetchFn(url, merged);
}

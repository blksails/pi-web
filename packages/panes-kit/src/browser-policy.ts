const CONTROLLED_PROTOCOLS = new Set(["http:", "https:"]);

export function normaliseBrowserUrl(raw: string): URL | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  const isHostPort = /^(?:\[[^\]]+\]|[^/?#:]+):\d+(?:[/?#]|$)/.test(value);
  if (hasExplicitScheme && !/^https?:\/\//i.test(value) && !isHostPort) return undefined;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!CONTROLLED_PROTOCOLS.has(url.protocol) || url.username !== "" || url.password !== "") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function controlledBrowserOrigins(referrer: string, pageOrigin?: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const candidate of [referrer, pageOrigin]) {
    if (candidate === undefined || candidate.length === 0) continue;
    try {
      const url = new URL(candidate);
      if (CONTROLLED_PROTOCOLS.has(url.protocol)) origins.add(url.origin);
    } catch {
      // Ignore opaque or malformed origins.
    }
  }
  return origins;
}

export function isControlledBrowserOrigin(url: URL, origins: ReadonlySet<string>): boolean {
  if (origins.has(url.origin)) return true;
  return url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]"
    || url.hostname === "::1";
}

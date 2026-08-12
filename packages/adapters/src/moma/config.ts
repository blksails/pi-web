/** MOMA environment contract and URL normalization. */

/** MOMA credential environment variable. */
export const MOMA_API_KEY_ENV = "MOMA_API_KEY";
/** MOMA endpoint environment variable. */
export const MOMA_BASE_URL_ENV = "MOMA_BASE_URL";

export interface MomaConfig {
  /** Bare MOMA host/path, without the OpenAI-compatible `/v1` suffix. */
  readonly baseUrl: string;
  /** OpenAI-compatible API root, always ending at `/v1` (or equivalent). */
  readonly apiBaseUrl: string;
  readonly apiKey: string;
}

export class MomaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MomaConfigError";
  }
}

function trimTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, "");
}

/**
 * Accept the provider's host, `/v1`, or the full `/v1/chat/completions` URL.
 * The rest of pi-web expects a bare gateway base and appends `/v1` itself.
 */
export function normalizeMomaBaseUrl(raw: string): Pick<MomaConfig, "baseUrl" | "apiBaseUrl"> {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new MomaConfigError(`${MOMA_BASE_URL_ENV} must be an absolute HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MomaConfigError(`${MOMA_BASE_URL_ENV} must use http:// or https://.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new MomaConfigError(`${MOMA_BASE_URL_ENV} must not contain credentials, query, or hash components.`);
  }

  let pathname = trimTrailingSlashes(parsed.pathname);
  for (const suffix of ["/chat/completions", "/responses", "/videos", "/images/generations"]) {
    if (pathname.toLowerCase().endsWith(suffix)) {
      pathname = trimTrailingSlashes(pathname.slice(0, -suffix.length));
      break;
    }
  }

  const versioned = pathname.toLowerCase().endsWith("/v1");
  const rootPath = versioned ? trimTrailingSlashes(pathname.slice(0, -3)) : pathname;
  const origin = parsed.origin;
  const baseUrl = `${origin}${rootPath}`;
  const apiBaseUrl = versioned ? `${origin}${pathname}` : `${baseUrl}/v1`;
  return { baseUrl, apiBaseUrl };
}

/** Resolve MOMA only when both endpoint and key are present. */
export function resolveMomaConfig(env: NodeJS.ProcessEnv): MomaConfig | undefined {
  const rawBaseUrl = env[MOMA_BASE_URL_ENV]?.trim();
  const apiKey = env[MOMA_API_KEY_ENV]?.trim();
  if (!rawBaseUrl || !apiKey) return undefined;
  return { ...normalizeMomaBaseUrl(rawBaseUrl), apiKey };
}

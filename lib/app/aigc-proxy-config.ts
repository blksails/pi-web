/**
 * aigc-proxy-config — pure functions consumed by the e2b branch of `pi-handler`
 * (spec aigc-key-proxy, Req 1.1/1.4/3.2/4.1). Same style as `packages/server`'s
 * `*ConfigFromEnv`: consumes a passed-in env snapshot, never reads `process.env`
 * directly, so tests can inject fixtures without polluting global state.
 *
 * Three responsibilities, kept separate on purpose (each independently testable):
 *  - `resolveAigcProxyConfig`  — parse & fail-fast validate the operator-configured
 *    public base URL (Req 1.4). Returns `undefined` when unset (compat mode).
 *  - `resolveAigcProxyTokenTtlMs` — derive the session token TTL from the sandbox's
 *    own timeout config, so the token never expires before the sandbox does (Req 3.2).
 *  - `buildSandboxGatewayEnv` — produce the six env keys injected into the sandbox
 *    in place of the three real provider keys (Req 1.1, 4.1).
 */

/** Env var carrying the operator-configured, externally-reachable proxy base URL. */
const PUBLIC_BASE_ENV_VAR = "PI_WEB_AIGC_PROXY_PUBLIC_BASE";

/** Env var overriding the derived token TTL (ms). */
const TOKEN_TTL_OVERRIDE_ENV_VAR = "PI_WEB_AIGC_PROXY_TOKEN_TTL_MS";

/**
 * Conservative fallback for the sandbox's max lifetime when `PI_WEB_E2B_TIMEOUT_MS`
 * is unset. `e2b-config.ts` leaves `timeoutMs` undefined in that case (deferring to
 * the e2b SDK's own default, documented upstream as ~5 minutes for `Sandbox.create`);
 * we pick a larger, conservative value here on purpose — this TTL only bounds how
 * long a leaked/replayed proxy token stays valid, so over-estimating the sandbox
 * lifetime is the safe direction (never expiring the token *before* the sandbox does
 * is the hard requirement, Req 3.2) at the cost of a slightly longer-lived token.
 */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 3_600_000; // 1h

/** Safety margin added on top of the sandbox timeout so the token outlives it. */
export const TOKEN_TTL_SAFETY_MARGIN_MS = 15 * 60_000; // 15min

/** Resolved aigc proxy configuration (proxy mode enabled). */
export interface AigcProxyConfig {
  /** Externally-reachable base URL of this pi-web deployment (no trailing slash). */
  readonly publicBase: string;
}

/** Provider ids registered with the proxy (must match the provider-registry table). */
const PROXY_PROVIDER_IDS = ["newapi", "sufy", "dashscope"] as const;

/** Strip any trailing slash(es) from a URL string. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Parse & validate `PI_WEB_AIGC_PROXY_PUBLIC_BASE`. Returns `undefined` when unset
 * (compat / key-passthrough mode). Throws a clear, fix-guidance-carrying error when
 * set to something that isn't a valid `http:`/`https:` URL (Req 1.4) — this must
 * fail session creation loudly rather than silently falling back to passthrough.
 */
export function resolveAigcProxyConfig(
  env: Record<string, string | undefined>,
): AigcProxyConfig | undefined {
  const raw = env[PUBLIC_BASE_ENV_VAR]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${PUBLIC_BASE_ENV_VAR} 不是合法的 URL:"${raw}"。请选择以下修复路径之一:` +
        `1) 改正为合法的 http/https 地址(如 http://your-host:3010);` +
        `2) 移除该环境变量以回退到 key 透传兼容模式;` +
        `3) 若不需要代理模式,可将 PI_WEB_TRANSPORT 切换为 local。`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${PUBLIC_BASE_ENV_VAR} 必须是 http:// 或 https:// 地址,实际协议为 "${parsed.protocol}"(值:"${raw}")。` +
        `请选择以下修复路径之一:` +
        `1) 改正为合法的 http/https 地址(如 http://your-host:3010);` +
        `2) 移除该环境变量以回退到 key 透传兼容模式;` +
        `3) 若不需要代理模式,可将 PI_WEB_TRANSPORT 切换为 local。`,
    );
  }

  return { publicBase: stripTrailingSlashes(raw) };
}

/** Parse a positive integer env value; returns `undefined` for missing/invalid values. */
function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (v.length === 0) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Derive the proxy session token TTL: `(PI_WEB_E2B_TIMEOUT_MS ?? DEFAULT_SANDBOX_TIMEOUT_MS)
 * + TOKEN_TTL_SAFETY_MARGIN_MS`, overridable independently via
 * `PI_WEB_AIGC_PROXY_TOKEN_TTL_MS` (invalid override values are ignored, falling back
 * to the derived value) (Req 3.2).
 */
export function resolveAigcProxyTokenTtlMs(
  env: Record<string, string | undefined>,
): number {
  const override = parsePositiveInt(env[TOKEN_TTL_OVERRIDE_ENV_VAR]);
  if (override !== undefined) return override;

  const sandboxTimeoutMs =
    parsePositiveInt(env.PI_WEB_E2B_TIMEOUT_MS) ?? DEFAULT_SANDBOX_TIMEOUT_MS;
  return sandboxTimeoutMs + TOKEN_TTL_SAFETY_MARGIN_MS;
}

/**
 * Build the six sandbox gateway env keys injected in place of the three real
 * provider keys: `{NEWAPI,SUFY,DASHSCOPE}_BASE_URL` pointing at this deployment's
 * proxy endpoint, and `{NEWAPI,SUFY,DASHSCOPE}_API_KEY` set to the session token
 * (never the real key) (Req 1.1, 4.1).
 */
export function buildSandboxGatewayEnv({
  publicBase,
  token,
}: {
  readonly publicBase: string;
  readonly token: string;
}): Record<string, string> {
  const base = stripTrailingSlashes(publicBase);
  const env: Record<string, string> = {};
  for (const id of PROXY_PROVIDER_IDS) {
    const prefix = id.toUpperCase();
    env[`${prefix}_BASE_URL`] = `${base}/api/aigc-proxy/${id}`;
    env[`${prefix}_API_KEY`] = token;
  }
  return env;
}

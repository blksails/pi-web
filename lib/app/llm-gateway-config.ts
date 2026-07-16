/**
 * llm-gateway-config — pure functions consumed by the e2b branch of `pi-handler`
 * (spec sandbox-credentials-v2, design.md LlmGatewayAssembly, Req 2.1/2.2/2.4/2.5).
 * Same style as the retired `aigc-proxy-config.ts`'s `*ConfigFromEnv` functions:
 * consumes a passed-in env snapshot, never reads `process.env` directly, so tests
 * can inject fixtures without polluting global state.
 *
 * Two responsibilities, kept separate on purpose (each independently testable):
 *  - `resolveLlmGatewayConfig`  — parse & fail-fast validate the operator-configured
 *    public base URL, token TTL and serve toggle. Returns `undefined` when the
 *    public base is unset (compat mode: real provider keys keep being passed
 *    through as-is, Req 2.4).
 *  - `buildSandboxLlmEnv` — produce the `PI_LLM_GATEWAY_BASE` / `PI_LLM_TOKEN_<ID>`
 *    env keys injected into the sandbox in place of the real provider keys
 *    (Req 2.1, 2.2). Token env names are derived via the llm-gateway package's
 *    `llmGatewayTokenEnvName` (provider-registry.ts) — not reimplemented here, so
 *    the derivation rule (`PI_LLM_TOKEN_` + providerId upper-cased, `-` → `_`)
 *    stays in one place shared with the gateway route's own scope naming.
 */
import { llmGatewayTokenEnvName } from "@blksails/pi-web-server";

/** Env var carrying the operator-configured, sandbox-reachable gateway base URL. */
const PUBLIC_BASE_ENV_VAR = "PI_WEB_LLM_GATEWAY_PUBLIC_BASE";

/** Env var overriding the derived token TTL (ms). */
const TOKEN_TTL_OVERRIDE_ENV_VAR = "PI_WEB_LLM_GATEWAY_TOKEN_TTL_MS";

/** Env var toggling whether pi-web itself mounts the gateway routes (task 3.4). */
const SERVE_ENV_VAR = "PI_WEB_LLM_GATEWAY_SERVE";

/**
 * Conservative fallback for the sandbox's max lifetime when `PI_WEB_E2B_TIMEOUT_MS`
 * is unset — same rationale and value as the retired aigc-proxy config: this TTL
 * only bounds how long a leaked/replayed token stays valid, so over-estimating the
 * sandbox lifetime is the safe direction (never expiring the token *before* the
 * sandbox does is the hard requirement) at the cost of a slightly longer-lived
 * token.
 */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 3_600_000; // 1h

/** Safety margin added on top of the sandbox timeout so the token outlives it. */
export const TOKEN_TTL_SAFETY_MARGIN_MS = 15 * 60_000; // 15min

/** Resolved LLM gateway configuration (gateway mode enabled). */
export interface LlmGatewayConfig {
  /** Sandbox-reachable base URL of this pi-web deployment (no trailing slash). */
  readonly publicBase: string;
  /** Scoped-token TTL (ms) minted for each provider on session creation. */
  readonly tokenTtlMs: number;
  /** Whether pi-handler should mount `createLlmGatewayRoutes` (task 3.4 consumes this). */
  readonly serve: boolean;
}

/** Strip any trailing slash(es) from a URL string. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Parse a positive integer env value; returns `undefined` for missing/invalid values. */
function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (v.length === 0) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Parse an explicit-off boolean env value (`"0"` / `"false"`, case-insensitive). */
function isExplicitlyOff(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false";
}

/**
 * Parse & validate `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`. Returns `undefined` when unset
 * (compat / key-passthrough mode, Req 2.4) — this is the single discriminator for
 * "LLM gateway configured or not" that `pi-handler`'s e2b branch (task 3.3) and
 * route-mounting (task 3.4) both key off of. Throws a clear, fix-guidance-carrying
 * error when set to something that isn't a valid `http:`/`https:` URL, mirroring
 * the retired `resolveAigcProxyConfig`'s fail-fast behavior — a misconfigured
 * public base must fail session creation loudly rather than silently falling back
 * to passthrough.
 *
 * When configured, also derives:
 *  - `tokenTtlMs`: `(PI_WEB_E2B_TIMEOUT_MS ?? DEFAULT_SANDBOX_TIMEOUT_MS) +
 *    TOKEN_TTL_SAFETY_MARGIN_MS`, overridable independently via
 *    `PI_WEB_LLM_GATEWAY_TOKEN_TTL_MS` (invalid override values are ignored,
 *    falling back to the derived value).
 *  - `serve`: defaults to `true` (the public base being set implies the gateway
 *    should be reachable); `PI_WEB_LLM_GATEWAY_SERVE` set to `"0"` or `"false"`
 *    (case-insensitive) explicitly disables route mounting while still letting
 *    `publicBase`/`tokenTtlMs` drive env injection (task 3.4 consumes `serve`).
 */
export function resolveLlmGatewayConfig(
  env: Record<string, string | undefined>,
): LlmGatewayConfig | undefined {
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
        `3) 若不需要网关模式,可将 PI_WEB_TRANSPORT 切换为 local。`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${PUBLIC_BASE_ENV_VAR} 必须是 http:// 或 https:// 地址,实际协议为 "${parsed.protocol}"(值:"${raw}")。` +
        `请选择以下修复路径之一:` +
        `1) 改正为合法的 http/https 地址(如 http://your-host:3010);` +
        `2) 移除该环境变量以回退到 key 透传兼容模式;` +
        `3) 若不需要网关模式,可将 PI_WEB_TRANSPORT 切换为 local。`,
    );
  }

  const override = parsePositiveInt(env[TOKEN_TTL_OVERRIDE_ENV_VAR]);
  const sandboxTimeoutMs =
    parsePositiveInt(env.PI_WEB_E2B_TIMEOUT_MS) ?? DEFAULT_SANDBOX_TIMEOUT_MS;
  const tokenTtlMs = override ?? sandboxTimeoutMs + TOKEN_TTL_SAFETY_MARGIN_MS;

  const serve = !isExplicitlyOff(env[SERVE_ENV_VAR]);

  return {
    publicBase: stripTrailingSlashes(raw),
    tokenTtlMs,
    serve,
  };
}

/**
 * Build the sandbox LLM gateway env keys injected in place of the real provider
 * keys: `PI_LLM_GATEWAY_BASE` (gateway base as seen from inside the sandbox,
 * `<publicBase>/api/llm-gateway` — the gateway routes are mounted under `/api`,
 * and the sandbox's own `models.json` appends `/<provider>` per provider entry to
 * match the gateway route `/llm-gateway/:provider/*`) and one `PI_LLM_TOKEN_<ID>`
 * per entry in `tokens` (Req 2.1, 2.2). This is the cross-repo env contract the
 * baked sandbox image's entrypoint and pi-clouds' production assembly both read
 * (design.md Revalidation Trigger) — do not rename these keys without updating
 * both.
 */
export function buildSandboxLlmEnv({
  publicBase,
  tokens,
}: {
  readonly publicBase: string;
  readonly tokens: Readonly<Record<string, string>>;
}): Record<string, string> {
  const base = stripTrailingSlashes(publicBase);
  const env: Record<string, string> = {
    PI_LLM_GATEWAY_BASE: `${base}/api/llm-gateway`,
  };
  for (const [providerId, token] of Object.entries(tokens)) {
    env[llmGatewayTokenEnvName(providerId)] = token;
  }
  return env;
}

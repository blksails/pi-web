/**
 * llm-gateway-assembly — the e2b-branch credential switch decision, extracted as a
 * pure function so it is unit-testable without spinning up a real e2b/ws-runner
 * transport (spec sandbox-credentials-v2, design.md LlmGatewayAssembly, task 3.3,
 * Req 2.1, 2.2, 2.4, 2.5, 4.3, 4.4).
 *
 * `pi-handler.ts`'s e2b branch (createChannel closure) calls
 * `computeE2bProviderEnv` once per session creation and merges its output into
 * `e2bSpec.env` / the `envPassthrough` allowlist — mirroring the pre-existing
 * "providerKeysForE2b + envPassthrough" wiring so the security invariant (only
 * allowlisted keys reach the transport) is unchanged, only *which* keys/values
 * flow through it changes.
 *
 * Decision (config.llmGateway is the single discriminator, resolved once at
 * config-load time by `resolveLlmGatewayConfig` — task 3.3 does not re-parse env
 * itself, per 3.2's Implementation Notes):
 *  - **configured** (`config.llmGateway !== undefined`): none of the real
 *    `PROVIDER_KEY_NAMES` values are forwarded (`providerKeysForE2b = {}`, and
 *    those keys are absent from `passthroughKeys` too — the safety invariant
 *    this task exists for). For every provider in the llm-gateway registry whose
 *    `keyEnvCandidates` resolve to a non-empty value in the host `env`, a scoped
 *    token (`scope: "llm:<providerId>"`) is minted and folded into
 *    `buildSandboxLlmEnv`'s output (`PI_LLM_GATEWAY_BASE` + `PI_LLM_TOKEN_<ID>`),
 *    which *is* forwarded (both as env values and passthrough keys) — that's the
 *    replacement credential surface for the sandbox.
 *  - **unconfigured** (`undefined`): unchanged pre-3.3 behavior —
 *    `providerKeysForE2b = config.providerKeys` (real keys pass through as-is,
 *    Req 4.3/4.4 — this also keeps the three AIGC keys, NEWAPI/SUFY/DASHSCOPE,
 *    flowing since they're part of `PROVIDER_KEY_NAMES`), plus a `warn` message
 *    the caller logs once per session creation under the `app:llm-gateway`
 *    namespace (Req 2.4).
 *
 * The local (non-e2b) spawn branch never calls this function — it is scoped
 * entirely to the e2b credential-injection decision (Req 2.5).
 */
import {
  mintScopedToken,
  resolveLlmGatewaySecret,
  resolveLlmGatewayProviderTable,
} from "@blksails/pi-web-server";
import type { AppConfig } from "./config.js";
import { buildSandboxLlmEnv } from "./llm-gateway-config.js";

/** Result of the e2b-branch LLM credential switch decision. */
export interface E2bProviderEnvResult {
  /**
   * Real provider key/value pairs to merge into `e2bSpec.env` (and whose keys
   * join the `envPassthrough` allowlist). Empty when the LLM gateway is
   * configured — this is the safety invariant under test.
   */
  readonly providerKeysForE2b: Readonly<Record<string, string>>;
  /**
   * `PI_LLM_GATEWAY_BASE` / `PI_LLM_TOKEN_<ID>` env to merge into `e2bSpec.env`
   * (and whose keys join the `envPassthrough` allowlist). Empty when the
   * gateway is not configured.
   */
  readonly sandboxLlmEnv: Readonly<Record<string, string>>;
  /**
   * Union of `providerKeysForE2b` and `sandboxLlmEnv` keys — the full set the
   * caller must fold into the `envPassthrough` allowlist for these values to
   * actually reach the sandbox.
   */
  readonly passthroughKeys: readonly string[];
  /**
   * Present only in the unconfigured case: a human-readable warning the caller
   * logs once per session creation under the `app:llm-gateway` namespace
   * (Req 2.4), nudging operators toward configuring the gateway.
   */
  readonly warn?: string;
}

/**
 * Compute the e2b-branch LLM credential switch decision (task 3.3). Pure: takes
 * an explicit `env` snapshot (never reads `process.env` directly) so tests can
 * inject fixtures; the caller (`pi-handler.ts`) passes `process.env`.
 *
 * @param input.config    Loaded app config (`config.providerKeys` / `config.llmGateway`).
 * @param input.sessionId The session id to bind minted tokens to (same id used
 *                        elsewhere in the e2b branch for `PI_WEB_SESSION_ID`).
 * @param input.env       Host env snapshot: source of both real provider key
 *                        values (`config.providerKeys` already captured this at
 *                        config-load time) and the "does the host actually hold
 *                        this provider's key" check driving which providers get
 *                        minted a token.
 */
export function computeE2bProviderEnv(input: {
  readonly config: Pick<AppConfig, "providerKeys" | "llmGateway">;
  readonly sessionId: string;
  readonly env: NodeJS.ProcessEnv;
}): E2bProviderEnvResult {
  const { config, sessionId, env } = input;

  if (config.llmGateway === undefined) {
    // Unconfigured: pre-3.3 baseline, real keys pass through as-is (Req 4.3/4.4).
    const providerKeysForE2b = config.providerKeys;
    return {
      providerKeysForE2b,
      sandboxLlmEnv: {},
      passthroughKeys: Object.keys(providerKeysForE2b),
      warn:
        "LLM 网关未配置(PI_WEB_LLM_GATEWAY_PUBLIC_BASE 未设置):沙箱仍以真实 LLM " +
        "provider 凭据透传(现状行为,零回归)。如需让沙箱内 agent 及其依赖不再持有真实 " +
        "凭据,请配置 PI_WEB_LLM_GATEWAY_PUBLIC_BASE 启用 LLM 网关 token 换钥模式。",
    };
  }

  // Configured: strip all real provider key values, mint one scoped token per
  // provider the host actually holds a key for, inject the gateway env instead.
  const table = resolveLlmGatewayProviderTable(env);
  const secret = resolveLlmGatewaySecret(env);
  const tokens: Record<string, string> = {};
  for (const [providerId, entry] of Object.entries(table)) {
    const hasHostKey = entry.keyEnvCandidates.some((candidate) => {
      const value = env[candidate];
      return value !== undefined && value.length > 0;
    });
    if (!hasHostKey) continue;
    tokens[providerId] = mintScopedToken({
      scope: `llm:${providerId}`,
      sessionId,
      ttlMs: config.llmGateway.tokenTtlMs,
      secret,
    });
  }
  const sandboxLlmEnv = buildSandboxLlmEnv({
    publicBase: config.llmGateway.publicBase,
    tokens,
  });

  return {
    providerKeysForE2b: {},
    sandboxLlmEnv,
    passthroughKeys: Object.keys(sandboxLlmEnv),
  };
}

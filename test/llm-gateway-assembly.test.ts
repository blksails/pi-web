/**
 * llm-gateway-assembly — pi-handler e2b 分支 LLM 凭据切换决策的纯函数单测。
 * spec: sandbox-credentials-v2, task 3.3 (Req 2.1, 2.2, 2.4, 2.5, 4.3, 4.4)
 *
 * `computeE2bProviderEnv` 是 pi-handler.ts 里唯一决定「真实 provider key 是否进
 * e2bSpec.env / envPassthrough 白名单」的逻辑,抽成纯函数以便脱离真实 e2b/ws-runner
 * 传输直接断言安全不变式(配置网关后沙箱 env/白名单不含任何真实 provider key 值)。
 */
import { describe, expect, it } from "vitest";
import {
  computeE2bProviderEnv,
  deprecatedAigcProxyWarning,
  DEPRECATED_AIGC_PROXY_ENV_NAMES,
} from "@/lib/app/llm-gateway-assembly";
import type { LlmGatewayConfig } from "@/lib/app/llm-gateway-config";

/** A representative subset of `PROVIDER_KEY_NAMES` (lib/app/config.ts), covering
 * the three AIGC-critical keys (NEWAPI/SUFY/DASHSCOPE) plus a couple of the
 * "traditional" main-LLM keys — enough to exercise the registry-intersection
 * logic without needing to import the (unexported) full constant. */
const REAL_PROVIDER_KEYS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-REAL-SECRET-VALUE",
  OPENAI_API_KEY: "sk-openai-REAL-SECRET-VALUE",
  NEWAPI_API_KEY: "newapi-REAL-SECRET-VALUE",
  SUFY_API_KEY: "sufy-REAL-SECRET-VALUE",
  DASHSCOPE_API_KEY: "dashscope-REAL-SECRET-VALUE",
};

const GATEWAY_CONFIG: LlmGatewayConfig = {
  publicBase: "https://sandbox-host.example",
  tokenTtlMs: 3_600_000,
  serve: true,
};

/** All real secret values as a flat array, for the "not present anywhere" scan. */
const REAL_SECRET_VALUES = Object.values(REAL_PROVIDER_KEYS);

function assertNoRealSecrets(haystack: Record<string, string>): void {
  const serialized = JSON.stringify(haystack);
  for (const secret of REAL_SECRET_VALUES) {
    expect(serialized).not.toContain(secret);
  }
}

describe("computeE2bProviderEnv — LLM gateway configured", () => {
  const env: NodeJS.ProcessEnv = {
    ...REAL_PROVIDER_KEYS,
    PI_WEB_LLM_GATEWAY_SECRET: "test-llm-gateway-secret",
  };

  it("strips every real provider key — providerKeysForE2b is empty", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    expect(result.providerKeysForE2b).toEqual({});
  });

  it("sandboxLlmEnv + passthroughKeys contain no real provider key value (safety invariant)", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    // Union of everything that would be merged into e2bSpec.env.
    const mergedEnv = { ...result.providerKeysForE2b, ...result.sandboxLlmEnv };
    assertNoRealSecrets(mergedEnv);
    // The passthrough allowlist itself must not carry secret values either
    // (it's a list of key *names*, but assert the invariant at both layers).
    assertNoRealSecrets(
      Object.fromEntries(result.passthroughKeys.map((k) => [k, ""])),
    );
    for (const key of Object.keys(REAL_PROVIDER_KEYS)) {
      // Real provider key *names* must not appear in the passthrough allowlist
      // either — the invariant is "PROVIDER_KEY_NAMES entirely absent from env
      // and the allowlist", not just "values redacted".
      expect(result.passthroughKeys).not.toContain(key);
    }
  });

  it("mints PI_LLM_TOKEN_<ID> for every provider the host env holds a key for", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    // Registry providers with a matching host env key: anthropic, openai,
    // newapi (NEWAPI_API_KEY candidate), sufy, dashscope.
    expect(Object.keys(result.sandboxLlmEnv).sort()).toEqual(
      [
        "PI_LLM_GATEWAY_BASE",
        "PI_LLM_TOKEN_ANTHROPIC",
        "PI_LLM_TOKEN_DASHSCOPE",
        "PI_LLM_TOKEN_NEWAPI",
        "PI_LLM_TOKEN_OPENAI",
        "PI_LLM_TOKEN_SUFY",
      ].sort(),
    );
    // Registry providers with no matching host key (google/mistral/openrouter
    // not present in `env` above) must not get a token env var.
    expect(result.sandboxLlmEnv.PI_LLM_TOKEN_GOOGLE).toBeUndefined();
    expect(result.sandboxLlmEnv.PI_LLM_TOKEN_MISTRAL).toBeUndefined();
    expect(result.sandboxLlmEnv.PI_LLM_TOKEN_OPENROUTER).toBeUndefined();
  });

  it("PI_LLM_GATEWAY_BASE is derived from config.llmGateway.publicBase", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    expect(result.sandboxLlmEnv.PI_LLM_GATEWAY_BASE).toBe(
      "https://sandbox-host.example/api/llm-gateway",
    );
  });

  it("passthroughKeys is exactly the sandboxLlmEnv key set", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    expect([...result.passthroughKeys].sort()).toEqual(
      Object.keys(result.sandboxLlmEnv).sort(),
    );
  });

  it("no warn is produced when configured", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-1",
      env,
    });
    expect(result.warn).toBeUndefined();
  });

  it("mints tokens bound to the given sessionId and scoped per provider (verifiable)", async () => {
    const { verifyScopedToken } = await import("@blksails/pi-web-server");
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: GATEWAY_CONFIG },
      sessionId: "sess-42",
      env,
    });
    const token = result.sandboxLlmEnv.PI_LLM_TOKEN_ANTHROPIC;
    expect(token).toBeDefined();
    const verified = verifyScopedToken({
      token: token as string,
      expectedScope: "llm:anthropic",
      secret: "test-llm-gateway-secret",
    });
    expect(verified).toMatchObject({ ok: true, sessionId: "sess-42", scope: "llm:anthropic" });
  });
});

describe("computeE2bProviderEnv — LLM gateway not configured", () => {
  it("maintains current passthrough behavior: providerKeysForE2b === config.providerKeys", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: undefined },
      sessionId: "sess-1",
      env: {},
    });
    expect(result.providerKeysForE2b).toEqual(REAL_PROVIDER_KEYS);
  });

  it("sandboxLlmEnv is empty and passthroughKeys mirrors providerKeys", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: undefined },
      sessionId: "sess-1",
      env: {},
    });
    expect(result.sandboxLlmEnv).toEqual({});
    expect([...result.passthroughKeys].sort()).toEqual(
      Object.keys(REAL_PROVIDER_KEYS).sort(),
    );
  });

  it("still passes through the three AIGC keys (NEWAPI/SUFY/DASHSCOPE) unchanged (Req 4.3/4.4)", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: undefined },
      sessionId: "sess-1",
      env: {},
    });
    expect(result.providerKeysForE2b.NEWAPI_API_KEY).toBe(
      REAL_PROVIDER_KEYS.NEWAPI_API_KEY,
    );
    expect(result.providerKeysForE2b.SUFY_API_KEY).toBe(
      REAL_PROVIDER_KEYS.SUFY_API_KEY,
    );
    expect(result.providerKeysForE2b.DASHSCOPE_API_KEY).toBe(
      REAL_PROVIDER_KEYS.DASHSCOPE_API_KEY,
    );
  });

  it("produces an app:llm-gateway-recognizable warn message", () => {
    const result = computeE2bProviderEnv({
      config: { providerKeys: REAL_PROVIDER_KEYS, llmGateway: undefined },
      sessionId: "sess-1",
      env: {},
    });
    expect(result.warn).toBeDefined();
    expect(result.warn).toMatch(/LLM 网关未配置/);
  });
});

describe("deprecatedAigcProxyWarning — 废弃 aigc-proxy env 告警(Req 4.2)", () => {
  it("三个废弃 env 皆未设 → 无告警(undefined)", () => {
    expect(deprecatedAigcProxyWarning({})).toBeUndefined();
  });

  it.each(DEPRECATED_AIGC_PROXY_ENV_NAMES)(
    "设置 %s(任一)→ 返回告警文案",
    (name) => {
      const warning = deprecatedAigcProxyWarning({ [name]: "x" });
      expect(warning).toBeDefined();
      expect(warning).toContain("已废弃");
      expect(warning).toContain("LLM 网关");
    },
  );

  it("告警文案不含任何凭据值(仅 env 名与去向)", () => {
    const warning = deprecatedAigcProxyWarning({
      PI_WEB_AIGC_PROXY_SECRET: "super-secret-value-should-not-leak",
    });
    expect(warning).toBeDefined();
    expect(warning).not.toContain("super-secret-value-should-not-leak");
  });

  it("空串也视为已设置(env 存在即告警)", () => {
    expect(deprecatedAigcProxyWarning({ PI_WEB_AIGC_PROXY_PUBLIC_BASE: "" })).toBeDefined();
  });
});

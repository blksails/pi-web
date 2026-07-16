/**
 * llm-gateway-config — 配置解析(三态)+ buildSandboxLlmEnv 产物的纯函数单测。
 * spec: sandbox-credentials-v2, task 3.2 (Req 2.2)
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  TOKEN_TTL_SAFETY_MARGIN_MS,
  buildSandboxLlmEnv,
  resolveLlmGatewayConfig,
} from "@/lib/app/llm-gateway-config";

describe("resolveLlmGatewayConfig", () => {
  it("returns undefined when PI_WEB_LLM_GATEWAY_PUBLIC_BASE is unset", () => {
    expect(resolveLlmGatewayConfig({})).toBeUndefined();
  });

  it("returns undefined when the value is empty/whitespace", () => {
    expect(
      resolveLlmGatewayConfig({ PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "   " }),
    ).toBeUndefined();
  });

  it("accepts a valid http URL and defaults serve=true + derived TTL", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example:3010",
      }),
    ).toEqual({
      publicBase: "http://host.example:3010",
      tokenTtlMs: DEFAULT_SANDBOX_TIMEOUT_MS + TOKEN_TTL_SAFETY_MARGIN_MS,
      serve: true,
    });
  });

  it("accepts a valid https URL with a sub-path and strips trailing slashes", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "https://example.com/sub/",
      }),
    ).toEqual({
      publicBase: "https://example.com/sub",
      tokenTtlMs: DEFAULT_SANDBOX_TIMEOUT_MS + TOKEN_TTL_SAFETY_MARGIN_MS,
      serve: true,
    });
  });

  it("throws a fix-guidance error for a malformed URL", () => {
    expect(() =>
      resolveLlmGatewayConfig({ PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "not a url" }),
    ).toThrow(/PI_WEB_LLM_GATEWAY_PUBLIC_BASE/);
  });

  it("throws a fix-guidance error for a non-http(s) protocol", () => {
    let error: Error | undefined;
    try {
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "ftp://host.example",
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("PI_WEB_LLM_GATEWAY_PUBLIC_BASE");
    expect(error!.message).toMatch(/http|https/);
    expect(error!.message).toMatch(/PI_WEB_TRANSPORT/);
  });

  it("derives TTL from PI_WEB_E2B_TIMEOUT_MS + 15min margin when set", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example",
        PI_WEB_E2B_TIMEOUT_MS: "600000",
      }),
    ).toEqual({
      publicBase: "http://host.example",
      tokenTtlMs: 600_000 + TOKEN_TTL_SAFETY_MARGIN_MS,
      serve: true,
    });
  });

  it("is overridden by PI_WEB_LLM_GATEWAY_TOKEN_TTL_MS regardless of E2B timeout", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example",
        PI_WEB_E2B_TIMEOUT_MS: "600000",
        PI_WEB_LLM_GATEWAY_TOKEN_TTL_MS: "42000",
      }),
    ).toEqual({
      publicBase: "http://host.example",
      tokenTtlMs: 42_000,
      serve: true,
    });
  });

  it("ignores an invalid TTL override and falls back to the derived value", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example",
        PI_WEB_LLM_GATEWAY_TOKEN_TTL_MS: "not-a-number",
      }),
    ).toEqual({
      publicBase: "http://host.example",
      tokenTtlMs: DEFAULT_SANDBOX_TIMEOUT_MS + TOKEN_TTL_SAFETY_MARGIN_MS,
      serve: true,
    });
  });

  it.each(["0", "false", "FALSE", "  0  "])(
    "PI_WEB_LLM_GATEWAY_SERVE=%s explicitly disables serve",
    (raw) => {
      expect(
        resolveLlmGatewayConfig({
          PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example",
          PI_WEB_LLM_GATEWAY_SERVE: raw,
        }),
      ).toMatchObject({ serve: false });
    },
  );

  it("PI_WEB_LLM_GATEWAY_SERVE=1 keeps serve enabled (explicit on == default)", () => {
    expect(
      resolveLlmGatewayConfig({
        PI_WEB_LLM_GATEWAY_PUBLIC_BASE: "http://host.example",
        PI_WEB_LLM_GATEWAY_SERVE: "1",
      }),
    ).toMatchObject({ serve: true });
  });
});

describe("buildSandboxLlmEnv", () => {
  it("produces PI_LLM_GATEWAY_BASE = <publicBase>/api/llm-gateway", () => {
    const env = buildSandboxLlmEnv({
      publicBase: "http://host.example:3010",
      tokens: {},
    });
    expect(env.PI_LLM_GATEWAY_BASE).toBe(
      "http://host.example:3010/api/llm-gateway",
    );
  });

  it("strips a trailing slash from publicBase before appending the gateway path", () => {
    const env = buildSandboxLlmEnv({
      publicBase: "http://host.example:3010/",
      tokens: {},
    });
    expect(env.PI_LLM_GATEWAY_BASE).toBe(
      "http://host.example:3010/api/llm-gateway",
    );
  });

  it("derives PI_LLM_TOKEN_<ID> per provider (uppercase, - -> _)", () => {
    const env = buildSandboxLlmEnv({
      publicBase: "http://host.example",
      tokens: {
        newapi: "tok-newapi",
        sufy: "tok-sufy",
        dashscope: "tok-dashscope",
      },
    });
    expect(env).toEqual({
      PI_LLM_GATEWAY_BASE: "http://host.example/api/llm-gateway",
      PI_LLM_TOKEN_NEWAPI: "tok-newapi",
      PI_LLM_TOKEN_SUFY: "tok-sufy",
      PI_LLM_TOKEN_DASHSCOPE: "tok-dashscope",
    });
  });

  it("derives a kebab providerId token env name with underscores", () => {
    const env = buildSandboxLlmEnv({
      publicBase: "http://host.example",
      tokens: { "google-vertex": "tok" },
    });
    expect(env.PI_LLM_TOKEN_GOOGLE_VERTEX).toBe("tok");
  });

  it("produces no PI_LLM_TOKEN_* keys when tokens is empty", () => {
    const env = buildSandboxLlmEnv({
      publicBase: "http://host.example",
      tokens: {},
    });
    expect(Object.keys(env)).toEqual(["PI_LLM_GATEWAY_BASE"]);
  });
});

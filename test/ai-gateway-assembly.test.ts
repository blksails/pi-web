/**
 * ai-gateway-assembly — pi-handler e2b 分支 ai-gateway 会话 token 注入决策的纯函数单测。
 * spec: ai-gateway-providers, design.md §2.5 (Req 1.2, 4.5)
 */
import { describe, expect, it } from "vitest";
import {
  computeAiGatewaySessionEnv,
  AI_GATEWAY_SANDBOX_BASE_ENV,
  AI_GATEWAY_SANDBOX_TOKEN_ENV,
} from "@/lib/app/ai-gateway-assembly";
import { resolveAiGatewayConfig } from "@blksails/pi-web-server";

describe("computeAiGatewaySessionEnv — 套件未启用(Req 1.2)", () => {
  it("aiGatewayConfig undefined → 零注入", () => {
    const result = computeAiGatewaySessionEnv({
      aiGatewayConfig: undefined,
      sessionId: "sess-1",
      env: {},
      publicBase: "https://sandbox-host.example",
      tokenTtlMs: 3_600_000,
    });
    expect(result.env).toEqual({});
    expect(result.passthroughKeys).toEqual([]);
    expect(result.warn).toBeUndefined();
  });
});

describe("computeAiGatewaySessionEnv — 已启用但缺 public base", () => {
  it("不注入,返回 warn", () => {
    const aiGatewayConfig = resolveAiGatewayConfig({
      AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
    });
    const result = computeAiGatewaySessionEnv({
      aiGatewayConfig,
      sessionId: "sess-1",
      env: {},
      publicBase: undefined,
      tokenTtlMs: 3_600_000,
    });
    expect(result.env).toEqual({});
    expect(result.passthroughKeys).toEqual([]);
    expect(result.warn).toContain("PI_WEB_LLM_GATEWAY_PUBLIC_BASE");
  });
});

describe("computeAiGatewaySessionEnv — 已启用 + public base 可用", () => {
  const aiGatewayConfig = resolveAiGatewayConfig({
    AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
  });

  it("注入 PI_AI_GATEWAY_BASE/PI_AI_GATEWAY_TOKEN,keys 并入 passthroughKeys", () => {
    const result = computeAiGatewaySessionEnv({
      aiGatewayConfig,
      sessionId: "sess-1",
      env: { PI_WEB_AI_GATEWAY_SECRET: "test-ai-gateway-secret" },
      publicBase: "https://sandbox-host.example/",
      tokenTtlMs: 3_600_000,
    });
    expect(result.env[AI_GATEWAY_SANDBOX_BASE_ENV]).toBe(
      "https://sandbox-host.example/api/ai-gateway",
    );
    expect(typeof result.env[AI_GATEWAY_SANDBOX_TOKEN_ENV]).toBe("string");
    expect(result.env[AI_GATEWAY_SANDBOX_TOKEN_ENV]?.length).toBeGreaterThan(0);
    expect([...result.passthroughKeys].sort()).toEqual(
      [AI_GATEWAY_SANDBOX_BASE_ENV, AI_GATEWAY_SANDBOX_TOKEN_ENV].sort(),
    );
    expect(result.warn).toBeUndefined();
  });

  it("token 可被 verifyScopedToken 以 scope='ai-gateway' 校验通过,且携带正确 sessionId", async () => {
    const { verifyScopedToken } = await import("@blksails/pi-web-server");
    const secret = "test-ai-gateway-secret";
    const result = computeAiGatewaySessionEnv({
      aiGatewayConfig,
      sessionId: "sess-abc",
      env: { PI_WEB_AI_GATEWAY_SECRET: secret },
      publicBase: "https://sandbox-host.example",
      tokenTtlMs: 3_600_000,
    });
    const token = result.env[AI_GATEWAY_SANDBOX_TOKEN_ENV] as string;
    const verified = verifyScopedToken({ token, expectedScope: "ai-gateway", secret });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.sessionId).toBe("sess-abc");
    }
  });
});

/**
 * ai-gateway · config 单测(design.md §2.1,Req 1.1/1.2/1.4)。
 */
import { describe, expect, it } from "vitest";
import {
  resolveAiGatewayConfig,
  AiGatewayConfigError,
  DEFAULT_CATALOG_TTL_MS,
  DEFAULT_TIMEOUT_MS,
} from "../../src/ai-gateway/config.js";

describe("resolveAiGatewayConfig — 缺省", () => {
  it("AI_GATEWAY_BASE_URL 未设置 → undefined", () => {
    expect(resolveAiGatewayConfig({})).toBeUndefined();
  });

  it("AI_GATEWAY_BASE_URL 空白 → undefined", () => {
    expect(resolveAiGatewayConfig({ AI_GATEWAY_BASE_URL: "   " })).toBeUndefined();
  });
});

describe("resolveAiGatewayConfig — 合法配置", () => {
  it("最小合法配置 → 默认 TTL/超时/优先级", () => {
    const config = resolveAiGatewayConfig({
      AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
    });
    expect(config).toEqual({
      baseUrl: "http://127.0.0.1:8080",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      catalogTtlMs: DEFAULT_CATALOG_TTL_MS,
      modelPrecedence: "gateway",
    });
  });

  it("剥离尾斜杠", () => {
    const config = resolveAiGatewayConfig({
      AI_GATEWAY_BASE_URL: "https://gw.example.com/",
    });
    expect(config?.baseUrl).toBe("https://gw.example.com");
  });

  it("PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE=self → 反转优先级", () => {
    const config = resolveAiGatewayConfig({
      AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
      PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE: "self",
    });
    expect(config?.modelPrecedence).toBe("self");
  });

  it("AI_GATEWAY_TIMEOUT_MS / AI_GATEWAY_CATALOG_TTL_MS 覆盖生效", () => {
    const config = resolveAiGatewayConfig({
      AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
      AI_GATEWAY_TIMEOUT_MS: "5000",
      AI_GATEWAY_CATALOG_TTL_MS: "1000",
    });
    expect(config?.timeoutMs).toBe(5000);
    expect(config?.catalogTtlMs).toBe(1000);
  });
});

describe("resolveAiGatewayConfig — 非法配置 fail-fast", () => {
  it("非法 URL → AiGatewayConfigError 含字段名", () => {
    expect(() =>
      resolveAiGatewayConfig({ AI_GATEWAY_BASE_URL: "not-a-url" }),
    ).toThrow(AiGatewayConfigError);
    try {
      resolveAiGatewayConfig({ AI_GATEWAY_BASE_URL: "not-a-url" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("AI_GATEWAY_BASE_URL");
    }
  });

  it("非 http/https 协议 → AiGatewayConfigError", () => {
    expect(() =>
      resolveAiGatewayConfig({ AI_GATEWAY_BASE_URL: "ftp://gw.example.com" }),
    ).toThrow(AiGatewayConfigError);
  });

  it("模型优先级非法枚举 → AiGatewayConfigError 含字段名", () => {
    expect(() =>
      resolveAiGatewayConfig({
        AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
        PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE: "bogus",
      }),
    ).toThrow(AiGatewayConfigError);
    try {
      resolveAiGatewayConfig({
        AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
        PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE: "bogus",
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE");
    }
  });

  it("非正整数 TTL 覆盖 → AiGatewayConfigError", () => {
    expect(() =>
      resolveAiGatewayConfig({
        AI_GATEWAY_BASE_URL: "http://127.0.0.1:8080",
        AI_GATEWAY_CATALOG_TTL_MS: "-1",
      }),
    ).toThrow(AiGatewayConfigError);
  });
});

/**
 * aigc-proxy-config — 配置解析 + TTL 计算 + 沙盒网关 env 构造的纯函数单测。
 * spec: aigc-key-proxy, task 4.1 (Req 1.4, 3.2)
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  TOKEN_TTL_SAFETY_MARGIN_MS,
  buildSandboxGatewayEnv,
  resolveAigcProxyConfig,
  resolveAigcProxyTokenTtlMs,
} from "@/lib/app/aigc-proxy-config";

describe("resolveAigcProxyConfig", () => {
  it("returns undefined when PI_WEB_AIGC_PROXY_PUBLIC_BASE is unset", () => {
    expect(resolveAigcProxyConfig({})).toBeUndefined();
  });

  it("returns undefined when the value is empty/whitespace", () => {
    expect(
      resolveAigcProxyConfig({ PI_WEB_AIGC_PROXY_PUBLIC_BASE: "   " }),
    ).toBeUndefined();
  });

  it("accepts a valid http URL", () => {
    expect(
      resolveAigcProxyConfig({
        PI_WEB_AIGC_PROXY_PUBLIC_BASE: "http://host.example:3010",
      }),
    ).toEqual({ publicBase: "http://host.example:3010" });
  });

  it("accepts a valid https URL with a sub-path", () => {
    expect(
      resolveAigcProxyConfig({
        PI_WEB_AIGC_PROXY_PUBLIC_BASE: "https://example.com/sub",
      }),
    ).toEqual({ publicBase: "https://example.com/sub" });
  });

  it("throws a fix-guidance error for a malformed URL", () => {
    expect(() =>
      resolveAigcProxyConfig({ PI_WEB_AIGC_PROXY_PUBLIC_BASE: "not a url" }),
    ).toThrow(/PI_WEB_AIGC_PROXY_PUBLIC_BASE/);
  });

  it("throws a fix-guidance error for a non-http(s) protocol", () => {
    let error: Error | undefined;
    try {
      resolveAigcProxyConfig({
        PI_WEB_AIGC_PROXY_PUBLIC_BASE: "ftp://host.example",
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("PI_WEB_AIGC_PROXY_PUBLIC_BASE");
    // 三种修复路径:改正地址 / 移除变量回兼容模式 / 切 local 传输
    expect(error!.message).toMatch(/http|https/);
    expect(error!.message).toMatch(/PI_WEB_TRANSPORT/);
  });
});

describe("resolveAigcProxyTokenTtlMs", () => {
  it("defaults to sandbox default timeout + 15min safety margin when nothing is set", () => {
    expect(resolveAigcProxyTokenTtlMs({})).toBe(
      DEFAULT_SANDBOX_TIMEOUT_MS + TOKEN_TTL_SAFETY_MARGIN_MS,
    );
  });

  it("derives from PI_WEB_E2B_TIMEOUT_MS + 15min margin when set", () => {
    expect(
      resolveAigcProxyTokenTtlMs({ PI_WEB_E2B_TIMEOUT_MS: "600000" }),
    ).toBe(600_000 + TOKEN_TTL_SAFETY_MARGIN_MS);
  });

  it("is overridden by PI_WEB_AIGC_PROXY_TOKEN_TTL_MS regardless of E2B timeout", () => {
    expect(
      resolveAigcProxyTokenTtlMs({
        PI_WEB_E2B_TIMEOUT_MS: "600000",
        PI_WEB_AIGC_PROXY_TOKEN_TTL_MS: "123456",
      }),
    ).toBe(123_456);
  });

  it("ignores an invalid PI_WEB_AIGC_PROXY_TOKEN_TTL_MS override", () => {
    expect(
      resolveAigcProxyTokenTtlMs({
        PI_WEB_E2B_TIMEOUT_MS: "600000",
        PI_WEB_AIGC_PROXY_TOKEN_TTL_MS: "not-a-number",
      }),
    ).toBe(600_000 + TOKEN_TTL_SAFETY_MARGIN_MS);
  });

  it("ignores an invalid PI_WEB_E2B_TIMEOUT_MS and falls back to the default", () => {
    expect(
      resolveAigcProxyTokenTtlMs({ PI_WEB_E2B_TIMEOUT_MS: "-5" }),
    ).toBe(DEFAULT_SANDBOX_TIMEOUT_MS + TOKEN_TTL_SAFETY_MARGIN_MS);
  });
});

describe("buildSandboxGatewayEnv", () => {
  it("produces the six gateway keys with normalized publicBase (no trailing slash)", () => {
    expect(
      buildSandboxGatewayEnv({
        publicBase: "http://host.example:3010/",
        token: "tok-abc",
      }),
    ).toEqual({
      NEWAPI_BASE_URL: "http://host.example:3010/api/aigc-proxy/newapi",
      SUFY_BASE_URL: "http://host.example:3010/api/aigc-proxy/sufy",
      DASHSCOPE_BASE_URL: "http://host.example:3010/api/aigc-proxy/dashscope",
      NEWAPI_API_KEY: "tok-abc",
      SUFY_API_KEY: "tok-abc",
      DASHSCOPE_API_KEY: "tok-abc",
    });
  });

  it("does not double up slashes when publicBase already has no trailing slash", () => {
    const result = buildSandboxGatewayEnv({
      publicBase: "https://example.com/sub",
      token: "tok-xyz",
    });
    expect(result.NEWAPI_BASE_URL).toBe(
      "https://example.com/sub/api/aigc-proxy/newapi",
    );
  });

  it("strips multiple trailing slashes", () => {
    const result = buildSandboxGatewayEnv({
      publicBase: "http://host.example///",
      token: "tok-xyz",
    });
    expect(result.NEWAPI_BASE_URL).toBe(
      "http://host.example/api/aigc-proxy/newapi",
    );
  });
});

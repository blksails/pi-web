/**
 * e2bTransportConfigFromEnv 单元测试(spec e2b-sandbox-transport,Req 3.2/3.3/7.1)。
 *
 * 纯函数:覆盖缺 apiKey/template 时的清晰失败(不静默回退)与齐全时的正确解析。
 */
import { describe, it, expect } from "vitest";
import {
  e2bTransportConfigFromEnv,
  E2B_CONFIG_MISSING_MESSAGE,
} from "../../src/rpc-channel/e2b-config.js";

describe("e2bTransportConfigFromEnv — 缺配置清晰失败 (Req 3.3)", () => {
  it("缺 E2B_API_KEY 抛出携带指引的错误", () => {
    expect(() =>
      e2bTransportConfigFromEnv({ PI_WEB_E2B_TEMPLATE: "t" }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("缺 PI_WEB_E2B_TEMPLATE 抛出携带指引的错误", () => {
    expect(() => e2bTransportConfigFromEnv({ E2B_API_KEY: "k" })).toThrow(
      E2B_CONFIG_MISSING_MESSAGE,
    );
  });

  it("空字符串/纯空白视为缺失", () => {
    expect(() =>
      e2bTransportConfigFromEnv({ E2B_API_KEY: "  ", PI_WEB_E2B_TEMPLATE: "t" }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("错误消息含变量名,便于运营者修复", () => {
    expect(E2B_CONFIG_MISSING_MESSAGE).toContain("E2B_API_KEY");
    expect(E2B_CONFIG_MISSING_MESSAGE).toContain("PI_WEB_E2B_TEMPLATE");
  });
});

describe("e2bTransportConfigFromEnv — 齐全时解析 (Req 3.2)", () => {
  it("仅必需项时返回最小配置(可选项省略)", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
    });
    expect(cfg).toEqual({ apiKey: "k", template: "tmpl" });
  });

  it("全部可选项解析:timeout/runnerCmd/cwd/envPassthrough", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
      PI_WEB_E2B_TIMEOUT_MS: "30000",
      PI_WEB_E2B_RUNNER_CMD: "pi --mode rpc",
      PI_WEB_E2B_CWD: "/work",
      PI_WEB_E2B_ENV_PASSTHROUGH: "ANTHROPIC_API_KEY, OPENAI_API_KEY ,",
    });
    expect(cfg).toEqual({
      apiKey: "k",
      template: "tmpl",
      timeoutMs: 30000,
      runnerCmd: "pi --mode rpc",
      sandboxCwd: "/work",
      envPassthrough: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    });
  });

  it("非法 timeout(非正整数)被忽略,不进入配置", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
      PI_WEB_E2B_TIMEOUT_MS: "abc",
    });
    expect(cfg).not.toHaveProperty("timeoutMs");
  });
});

describe("e2bTransportConfigFromEnv — 自托管/ACS 端点 (domain/validateApiKey)", () => {
  it("PI_WEB_E2B_DOMAIN 优先,回落 E2B_DOMAIN", () => {
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE: "t",
        E2B_DOMAIN: "fallback:10000",
      }).domain,
    ).toBe("fallback:10000");
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE: "t",
        PI_WEB_E2B_DOMAIN: "primary:10000",
        E2B_DOMAIN: "fallback:10000",
      }).domain,
    ).toBe("primary:10000");
  });

  it("PI_WEB_E2B_VALIDATE_API_KEY=false → validateApiKey:false(支持 sys-* token)", () => {
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "sys-abc",
        PI_WEB_E2B_TEMPLATE: "t",
        PI_WEB_E2B_VALIDATE_API_KEY: "false",
      }).validateApiKey,
    ).toBe(false);
  });

  it("未设 validateApiKey → 不注入该键(交 SDK 默认校验,对齐真实 e2b 云)", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "e2b_abc",
      PI_WEB_E2B_TEMPLATE: "t",
    });
    expect(cfg).not.toHaveProperty("validateApiKey");
    expect(cfg).not.toHaveProperty("domain");
  });
});

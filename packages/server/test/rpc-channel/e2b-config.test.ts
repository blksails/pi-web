/**
 * e2bTransportConfigFromEnv 单元测试(spec e2b-sandbox-transport,Req 3.2/3.3/7.1;
 * spec sandbox-baked-agent-image,Req 3.3/3.5:template 必填放宽 + 模板映射/派生配置面)。
 *
 * 纯函数:覆盖缺 apiKey 时的清晰失败(不静默回退)、template 可缺(终判移交
 * resolveSandboxTemplate)、templateMap/templateDerive 解析与齐全时的正确解析。
 */
import { describe, it, expect } from "vitest";
import {
  e2bTransportConfigFromEnv,
  e2bDataPlaneFromEnv,
  E2B_CONFIG_MISSING_MESSAGE,
} from "../../src/rpc-channel/e2b-config.js";

describe("e2bTransportConfigFromEnv — 缺配置清晰失败 (Req 3.3)", () => {
  it("缺 E2B_API_KEY 抛出携带指引的错误", () => {
    expect(() =>
      e2bTransportConfigFromEnv({ PI_WEB_E2B_TEMPLATE: "t" }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("缺 PI_WEB_E2B_TEMPLATE 不抛,template 为 undefined(终判移交 resolveSandboxTemplate)", () => {
    const cfg = e2bTransportConfigFromEnv({ E2B_API_KEY: "k" });
    expect(cfg.template).toBeUndefined();
    expect(cfg).not.toHaveProperty("template");
  });

  it("空字符串/纯空白视为缺失", () => {
    expect(() =>
      e2bTransportConfigFromEnv({ E2B_API_KEY: "  ", PI_WEB_E2B_TEMPLATE: "t" }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("错误消息含 E2B_API_KEY 变量名,且不再要求 PI_WEB_E2B_TEMPLATE(template 指引归模板解析错误)", () => {
    expect(E2B_CONFIG_MISSING_MESSAGE).toContain("E2B_API_KEY");
    expect(E2B_CONFIG_MISSING_MESSAGE).not.toContain("PI_WEB_E2B_TEMPLATE");
  });
});

describe("e2bTransportConfigFromEnv — 齐全时解析 (Req 3.2)", () => {
  it("仅必需项时返回最小配置(可选项省略,templateDerive 默认 false)", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
    });
    expect(cfg).toEqual({ apiKey: "k", template: "tmpl", templateDerive: false });
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
      templateDerive: false,
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

describe("e2bTransportConfigFromEnv — 模板映射/派生配置面 (sandbox-baked-agent-image Req 3.3)", () => {
  it("PI_WEB_E2B_TEMPLATE_MAP 合法 JSON object → 解析为 templateMap", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE_MAP:
        '{"/abs/agent-a":"piweb-agent-a.abc123","gh:org/repo":"piweb-agent-b.def456"}',
    });
    expect(cfg.templateMap).toEqual({
      "/abs/agent-a": "piweb-agent-a.abc123",
      "gh:org/repo": "piweb-agent-b.def456",
    });
  });

  it("非法 JSON → 抛携带变量名的清晰错误(禁静默忽略)", () => {
    expect(() =>
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_MAP: "{not json",
      }),
    ).toThrow(/PI_WEB_E2B_TEMPLATE_MAP/);
  });

  it("JSON 非 object(数组/字符串/数字/null)→ 抛清晰错误", () => {
    for (const raw of ['["a"]', '"str"', "42", "null"]) {
      expect(() =>
        e2bTransportConfigFromEnv({
          E2B_API_KEY: "k",
          PI_WEB_E2B_TEMPLATE_MAP: raw,
        }),
      ).toThrow(/PI_WEB_E2B_TEMPLATE_MAP/);
    }
  });

  it("object 但值非字符串 → 抛清晰错误", () => {
    expect(() =>
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_MAP: '{"src": 1}',
      }),
    ).toThrow(/PI_WEB_E2B_TEMPLATE_MAP/);
  });

  it("未设/纯空白 → 不注入 templateMap", () => {
    expect(
      e2bTransportConfigFromEnv({ E2B_API_KEY: "k" }),
    ).not.toHaveProperty("templateMap");
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_MAP: "  ",
      }),
    ).not.toHaveProperty("templateMap");
  });

  it('PI_WEB_E2B_TEMPLATE_DERIVE === "1" → templateDerive:true;其余(含 "true"/"0"/未设)→ false', () => {
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_DERIVE: "1",
      }).templateDerive,
    ).toBe(true);
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_DERIVE: "true",
      }).templateDerive,
    ).toBe(false);
    expect(
      e2bTransportConfigFromEnv({
        E2B_API_KEY: "k",
        PI_WEB_E2B_TEMPLATE_DERIVE: "0",
      }).templateDerive,
    ).toBe(false);
    expect(
      e2bTransportConfigFromEnv({ E2B_API_KEY: "k" }).templateDerive,
    ).toBe(false);
  });

  it("未配 map/derive、仅配全局模板 → 与现状一致(map 不注入、derive 关、template 原样)", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
    });
    expect(cfg).toEqual({ apiKey: "k", template: "tmpl", templateDerive: false });
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

describe("e2bDataPlaneFromEnv + ws-runner 字段", () => {
  it("PI_WEB_E2B_DATAPLANE 默认 envd,=ws-runner 时切换", () => {
    expect(e2bDataPlaneFromEnv({})).toBe("envd");
    expect(e2bDataPlaneFromEnv({ PI_WEB_E2B_DATAPLANE: "envd" })).toBe("envd");
    expect(e2bDataPlaneFromEnv({ PI_WEB_E2B_DATAPLANE: "ws-runner" })).toBe("ws-runner");
    expect(e2bDataPlaneFromEnv({ PI_WEB_E2B_DATAPLANE: "WS-RUNNER" })).toBe("ws-runner");
    expect(e2bDataPlaneFromEnv({ PI_WEB_E2B_DATAPLANE: "bogus" })).toBe("envd");
  });

  it("解析 ws-runner 专属字段 runnerPort/wsBase/reconnectMs + apiUrl", () => {
    const cfg = e2bTransportConfigFromEnv({
      E2B_API_KEY: "sys-x",
      PI_WEB_E2B_TEMPLATE: "aio",
      PI_WEB_E2B_RUNNER_PORT: "8080",
      PI_WEB_E2B_RUNNER_WS_BASE: "ws://127.0.0.1:10000",
      PI_WEB_E2B_RECONNECT_MS: "500",
      E2B_API_URL: "http://127.0.0.1:13000",
    });
    expect(cfg).toMatchObject({
      apiKey: "sys-x",
      template: "aio",
      runnerPort: 8080,
      wsBase: "ws://127.0.0.1:10000",
      reconnectDelayMs: 500,
      apiUrl: "http://127.0.0.1:13000",
    });
  });

  it("未设 ws-runner 字段 → 不注入(envd 路径零负担)", () => {
    const cfg = e2bTransportConfigFromEnv({ E2B_API_KEY: "e2b_x", PI_WEB_E2B_TEMPLATE: "t" });
    expect(cfg).not.toHaveProperty("runnerPort");
    expect(cfg).not.toHaveProperty("wsBase");
    expect(cfg).not.toHaveProperty("reconnectDelayMs");
  });
});

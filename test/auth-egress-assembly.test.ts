/**
 * desktop-cloud-login 任务 7.1 · 云端登录 egress 装配单测(Req 3.5/4.2/7.3)。
 */
import { describe, it, expect } from "vitest";
import {
  resolveCloudLoginConfig,
  computeAuthEgressSpawnEnv,
  CloudLoginConfigError,
  CLOUD_LOGIN_MIN_TIMEOUT_MS,
  RUNNER_CREDENTIAL_ENV,
  RUNNER_EGRESS_BASE_ENV,
  RUNNER_EGRESS_MODELS_ENV,
} from "@/lib/app/auth-egress-assembly";

describe("resolveCloudLoginConfig", () => {
  it("未设 base → undefined(功能关闭,Req 4.2)", () => {
    expect(resolveCloudLoginConfig({})).toBeUndefined();
    expect(resolveCloudLoginConfig({ PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "  " })).toBeUndefined();
  });

  it("设合法 base → 配置(去尾斜杠 + 默认超时下限)", () => {
    const cfg = resolveCloudLoginConfig({
      PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://egress.example/v1/",
    });
    expect(cfg).toEqual({
      egressBaseUrl: "https://egress.example/v1",
      models: [],
      timeoutMs: CLOUD_LOGIN_MIN_TIMEOUT_MS,
    });
  });

  it("解析模型清单(字符串 id 与对象混合)", () => {
    const cfg = resolveCloudLoginConfig({
      PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://egress/v1",
      PI_WEB_CLOUD_LOGIN_MODELS: JSON.stringify([
        "m1",
        { id: "m2", name: "M2", contextWindow: 200000 },
      ]),
    });
    expect(cfg?.models).toEqual([
      { id: "m1" },
      { id: "m2", name: "M2", contextWindow: 200000 },
    ]);
  });

  it("超时取不短于下限(Req 3.5)", () => {
    const low = resolveCloudLoginConfig({
      PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://egress/v1",
      PI_WEB_CLOUD_LOGIN_TIMEOUT_MS: "1000",
    });
    expect(low?.timeoutMs).toBe(CLOUD_LOGIN_MIN_TIMEOUT_MS); // 1000 < 下限 → 取下限
    const high = resolveCloudLoginConfig({
      PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://egress/v1",
      PI_WEB_CLOUD_LOGIN_TIMEOUT_MS: "600000",
    });
    expect(high?.timeoutMs).toBe(600000);
  });

  it.each([
    ["非法 URL", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "not a url" }],
    ["非 http 协议", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "ftp://egress/v1" }],
    ["模型非 JSON", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://e/v1", PI_WEB_CLOUD_LOGIN_MODELS: "{bad" }],
    ["模型非数组", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://e/v1", PI_WEB_CLOUD_LOGIN_MODELS: '{"id":"x"}' }],
    ["模型项缺 id", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://e/v1", PI_WEB_CLOUD_LOGIN_MODELS: '[{"name":"x"}]' }],
    ["超时非正整数", { PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://e/v1", PI_WEB_CLOUD_LOGIN_TIMEOUT_MS: "abc" }],
  ])("非法配置(%s)→ fail-fast 抛 CloudLoginConfigError(Req 7.3)", (_label, env) => {
    expect(() => resolveCloudLoginConfig(env)).toThrow(CloudLoginConfigError);
  });
});

describe("computeAuthEgressSpawnEnv", () => {
  const cfg = {
    egressBaseUrl: "https://egress/v1",
    models: [{ id: "m1" }],
    timeoutMs: CLOUD_LOGIN_MIN_TIMEOUT_MS,
  };

  it("未启用(config undefined)→ 空对象(Req 4.1)", () => {
    expect(computeAuthEgressSpawnEnv(undefined, "cred.sig")).toEqual({});
  });

  it("未登录(credential undefined/空)→ 空对象", () => {
    expect(computeAuthEgressSpawnEnv(cfg, undefined)).toEqual({});
    expect(computeAuthEgressSpawnEnv(cfg, "   ")).toEqual({});
  });

  it("登录且启用 → runner-facing 三件套 env", () => {
    const env = computeAuthEgressSpawnEnv(cfg, "cred.sig");
    expect(env[RUNNER_CREDENTIAL_ENV]).toBe("cred.sig");
    expect(env[RUNNER_EGRESS_BASE_ENV]).toBe("https://egress/v1");
    expect(JSON.parse(env[RUNNER_EGRESS_MODELS_ENV] ?? "null")).toEqual([{ id: "m1" }]);
  });
});

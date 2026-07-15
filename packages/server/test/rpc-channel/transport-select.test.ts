/**
 * selectTransport 单元测试(spec e2b-sandbox-transport,Req 3.1/3.2/3.3/7.3)。
 *
 * 覆盖装配层的传输后端切换决策(不真连 e2b):默认/local 走本地进程路径;e2b 且配置
 * 齐全走 e2b 路径并带回已解析配置;e2b 但缺配置在会话创建路径以清晰错误失败,不回退 local。
 * 本函数正是 `lib/app/pi-handler.ts` 的 createChannel 实际调用的决策点。
 */
import { describe, it, expect } from "vitest";
import {
  selectTransport,
  E2B_CONFIG_MISSING_MESSAGE,
} from "../../src/rpc-channel/e2b-config.js";

describe("selectTransport — 默认与 local (Req 3.1)", () => {
  it("未设置 PI_WEB_TRANSPORT → local(默认零变化)", () => {
    expect(selectTransport({})).toEqual({ mode: "local" });
  });

  it("PI_WEB_TRANSPORT=local → local", () => {
    expect(selectTransport({ PI_WEB_TRANSPORT: "local" })).toEqual({
      mode: "local",
    });
  });

  it("未知传输值 → local(不误入 e2b)", () => {
    expect(selectTransport({ PI_WEB_TRANSPORT: "ssh" })).toEqual({
      mode: "local",
    });
  });

  it("local 分支即使缺 e2b 配置也不抛(不触达 e2b 配置解析)", () => {
    expect(() => selectTransport({ PI_WEB_TRANSPORT: "local" })).not.toThrow();
  });
});

describe("selectTransport — e2b 分支 (Req 3.2/3.3)", () => {
  it("PI_WEB_TRANSPORT=e2b 且配置齐全 → e2b + 已解析配置", () => {
    const sel = selectTransport({
      PI_WEB_TRANSPORT: "e2b",
      E2B_API_KEY: "k",
      PI_WEB_E2B_TEMPLATE: "tmpl",
      PI_WEB_E2B_ENV_PASSTHROUGH: "ANTHROPIC_API_KEY",
    });
    expect(sel.mode).toBe("e2b");
    if (sel.mode !== "e2b") throw new Error("unreachable");
    expect(sel.config).toEqual({
      apiKey: "k",
      template: "tmpl",
      templateDerive: false,
      envPassthrough: ["ANTHROPIC_API_KEY"],
    });
  });

  it("dataPlane 默认 envd;=ws-runner 时切换(config 带 ws 字段)", () => {
    const envd = selectTransport({
      PI_WEB_TRANSPORT: "e2b",
      E2B_API_KEY: "e2b_k",
      PI_WEB_E2B_TEMPLATE: "t",
    });
    if (envd.mode !== "e2b") throw new Error("unreachable");
    expect(envd.dataPlane).toBe("envd");

    const ws = selectTransport({
      PI_WEB_TRANSPORT: "e2b",
      PI_WEB_E2B_DATAPLANE: "ws-runner",
      E2B_API_KEY: "sys-k",
      PI_WEB_E2B_TEMPLATE: "aio",
      PI_WEB_E2B_RUNNER_WS_BASE: "ws://127.0.0.1:10000",
      PI_WEB_E2B_VALIDATE_API_KEY: "false",
    });
    if (ws.mode !== "e2b") throw new Error("unreachable");
    expect(ws.dataPlane).toBe("ws-runner");
    expect(ws.config.wsBase).toBe("ws://127.0.0.1:10000");
  });

  it("PI_WEB_TRANSPORT=e2b 但缺 E2B_API_KEY → 清晰错误,不静默回退 local", () => {
    expect(() => selectTransport({ PI_WEB_TRANSPORT: "e2b" })).toThrow(
      E2B_CONFIG_MISSING_MESSAGE,
    );
    // 关键:失败即抛,绝不降级为 { mode: "local" }(避免「以为在沙盒里其实在本地」)。
    expect(() =>
      selectTransport({ PI_WEB_TRANSPORT: "e2b", PI_WEB_E2B_TEMPLATE: "t" }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("PI_WEB_TRANSPORT=e2b 缺 template 不抛 → e2b 分支 + template undefined(终判在 resolveSandboxTemplate)", () => {
    const sel = selectTransport({ PI_WEB_TRANSPORT: "e2b", E2B_API_KEY: "k" });
    expect(sel.mode).toBe("e2b");
    if (sel.mode !== "e2b") throw new Error("unreachable");
    expect(sel.config.template).toBeUndefined();
  });
});

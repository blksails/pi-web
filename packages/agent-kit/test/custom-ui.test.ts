import { describe, it, expect, vi } from "vitest";
import { customUi } from "../src/custom-ui.js";

describe("customUi", () => {
  it("以 (factory, options) 形态调用 ctx.ui.custom,payload 走 options.__piWebCustomUi", () => {
    const custom = vi.fn().mockResolvedValue(undefined);
    customUi({ custom }, { component: "demo-metric-card", props: { label: "x", value: 1 } });

    expect(custom).toHaveBeenCalledTimes(1);
    const call = custom.mock.calls[0]!;
    // 第 1 参为 placeholder factory 函数。
    expect(typeof call[0]).toBe("function");
    // 第 2 参 options 携带约定 key 的 payload。
    const options = call[1] as Record<string, unknown>;
    expect(options["__piWebCustomUi"]).toEqual({
      component: "demo-metric-card",
      props: { label: "x", value: 1 },
    });
  });

  it("无 props 时 payload.props 为 undefined", () => {
    const custom = vi.fn().mockResolvedValue(undefined);
    customUi({ custom }, { component: "demo-callout" });
    const options = custom.mock.calls[0]![1] as Record<string, unknown>;
    expect(options["__piWebCustomUi"]).toEqual({ component: "demo-callout", props: undefined });
  });

  it("ui 无 custom 方法(未启用桥接)→ 安全无操作", () => {
    expect(() => customUi({}, { component: "x" })).not.toThrow();
    expect(() => customUi(undefined, { component: "x" })).not.toThrow();
    expect(() => customUi({ custom: 123 }, { component: "x" })).not.toThrow();
  });
});

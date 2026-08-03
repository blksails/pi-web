/**
 * dispatchRawLine — 主进程侧按 `type` 解复用子进程原始行。
 *
 * 由 PiSession.handleRawLine 的 185 行 if-链收敛而来。本档直测分发语义;各帧类型的
 * 业务行为仍由 pi-session.* 各档覆盖(此处只保证「派发对了、该丢的丢了」)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  dispatchRawLine,
  type RawLineEntry,
  type RawLineTable,
} from "../../src/session/raw-line-router.js";

/** 恒通过的校验器,原样透出。 */
const pass = {
  safeParse: (v: unknown) => ({ success: true as const, data: v }),
};
/** 恒失败的校验器,带一个可断言的 error。 */
const fail = {
  safeParse: () => ({ success: false as const, error: { issues: ["bad"] } }),
};

function table(entries: Record<string, RawLineEntry<never>>): RawLineTable {
  return new Map(Object.entries(entries));
}

describe("dispatchRawLine — 派发", () => {
  it("命中已注册 type → 调用 handle 并返回 true", () => {
    const handle = vi.fn();
    const t = table({ foo: { schema: pass, handle } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine(JSON.stringify({ type: "foo", x: 1 }), t, true)).toBe(true);
    expect(handle).toHaveBeenCalledWith({ type: "foo", x: 1 });
  });

  it("★未注册 type → 不消费(返回 false),其它订阅者仍可处理该行", () => {
    const handle = vi.fn();
    const t = table({ foo: { schema: pass, handle } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine(JSON.stringify({ type: "other" }), t, true)).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("非 JSON 行 → false,不抛", () => {
    const t = table({});
    expect(() => dispatchRawLine("not json at all", t, true)).not.toThrow();
    expect(dispatchRawLine("not json at all", t, true)).toBe(false);
  });

  it("JSON 但非对象(null / 数组 / 标量)→ false", () => {
    const t = table({ foo: { schema: pass, handle: vi.fn() } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine("null", t, true)).toBe(false);
    expect(dispatchRawLine("123", t, true)).toBe(false);
    expect(dispatchRawLine('"str"', t, true)).toBe(false);
  });

  it("type 缺失或非字符串 → false", () => {
    const t = table({ foo: { schema: pass, handle: vi.fn() } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine(JSON.stringify({ noType: 1 }), t, true)).toBe(false);
    expect(dispatchRawLine(JSON.stringify({ type: 42 }), t, true)).toBe(false);
  });
});

describe("dispatchRawLine — 校验失败的处置", () => {
  it("★缺省静默丢弃:不调 handle、不抛(结果帧语义,超时兜底会给更准的错误)", () => {
    const handle = vi.fn();
    const t = table({ foo: { schema: fail, handle } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine(JSON.stringify({ type: "foo" }), t, true)).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("★声明了 onInvalid → 收到 error 供告警(声明帧语义:能力整个不可用,必须可见)", () => {
    const onInvalid = vi.fn();
    const handle = vi.fn();
    const t = table({
      foo: { schema: fail, onInvalid, handle } as unknown as RawLineEntry<never>,
    });
    dispatchRawLine(JSON.stringify({ type: "foo" }), t, true);
    expect(onInvalid).toHaveBeenCalledWith({ issues: ["bad"] });
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("dispatchRawLine — active 门", () => {
  it("★requireActive 未设(缺省)→ 非 active 时**仍然**处理", () => {
    // 这是原 if-链的语义要害:结果帧要在超时/收尾窗口里仍能配对在途请求,
    // 装配期声明帧要早于就绪门就被缓存。缺省不设门正是为此。
    const handle = vi.fn();
    const t = table({ foo: { schema: pass, handle } as unknown as RawLineEntry<never> });
    expect(dispatchRawLine(JSON.stringify({ type: "foo" }), t, false)).toBe(true);
    expect(handle).toHaveBeenCalled();
  });

  it("requireActive:true → 非 active 时跳过", () => {
    const handle = vi.fn();
    const t = table({
      foo: { schema: pass, handle, requireActive: true } as unknown as RawLineEntry<never>,
    });
    expect(dispatchRawLine(JSON.stringify({ type: "foo" }), t, false)).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("requireActive:true → active 时正常处理", () => {
    const handle = vi.fn();
    const t = table({
      foo: { schema: pass, handle, requireActive: true } as unknown as RawLineEntry<never>,
    });
    expect(dispatchRawLine(JSON.stringify({ type: "foo" }), t, true)).toBe(true);
    expect(handle).toHaveBeenCalled();
  });

  it("★active 门先于校验:非 active 时连 onInvalid 都不触发", () => {
    const onInvalid = vi.fn();
    const t = table({
      foo: { schema: fail, onInvalid, requireActive: true, handle: vi.fn() } as unknown as RawLineEntry<never>,
    });
    dispatchRawLine(JSON.stringify({ type: "foo" }), t, false);
    expect(onInvalid).not.toHaveBeenCalled();
  });
});

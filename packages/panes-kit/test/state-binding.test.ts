// @vitest-environment node
/**
 * 共享状态的宿主侧绑定(spec panes-only-right-panel 任务 1.2;Req 2.1/2.2/2.4)。
 *
 * ★ 本文件的重点不是「能推值」那几条平凡断言,而是**换身份重绑**:
 * 宿主访问器由 useMemo 依赖会话连接构造,就绪握手与控制流重开都会换出新实例,新实例读的是
 * **新的** store。建连那一刻的订阅挂在旧 store 上此后永不触发 —— 症状是「pane 起来了、
 * 能力也对,但值永远是空的」,极易被误判成 agent 没发数据。既有的 surface 绑定为此写了整段
 * 注释,是有前科的。
 */
import { describe, expect, it, vi } from "vitest";
import { bindPaneState, type PaneStateSource } from "../src/state-binding.js";

/** 可变的假 store:能改值、能换身份,用来复现真实的重绑场景。 */
function makeSource(initial: Record<string, unknown> = {}): PaneStateSource & {
  set(key: string, value: unknown): void;
  readonly listenerCount: () => number;
} {
  const values = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    get: <T,>(key: string) => values.get(key) as T | undefined,
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
    set(key, value) {
      values.set(key, value);
      for (const l of listeners.get(key) ?? []) l(value);
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("逐键绑定与推送(Req 2.1/2.2)", () => {
  it("★ 每个授权键先立即推一次当前值(连接可能建立在首值之后)", () => {
    const source = makeSource({ a: 1, b: 2 });
    const push = vi.fn();
    bindPaneState(source, ["a", "b"], push);
    // 只订阅不立即推的话,建连前就已存在的值永远等不到 —— 那是一类真实的静默失败。
    expect(push.mock.calls).toEqual([["a", 1], ["b", 2]]);
  });

  it("键值变化时推送新值", () => {
    const source = makeSource({ a: 1 });
    const push = vi.fn();
    bindPaneState(source, ["a"], push);
    push.mockClear();
    source.set("a", 42);
    expect(push).toHaveBeenCalledWith("a", 42);
  });

  it("★ 未授权的键既不订阅也不推送", () => {
    const source = makeSource({ a: 1, secret: "s" });
    const push = vi.fn();
    bindPaneState(source, ["a"], push);
    push.mockClear();
    source.set("secret", "changed");
    expect(push).not.toHaveBeenCalled();
  });

  it("尚未就绪(无访问器)时是无操作,清理函数可安全调用", () => {
    const push = vi.fn();
    const dispose = bindPaneState(undefined, ["a"], push);
    expect(push).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it("授权键为空时不推任何东西", () => {
    const push = vi.fn();
    bindPaneState(makeSource({ a: 1 }), [], push);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("清理(Req 2.4)", () => {
  it("清理后不再收到推送,且底层订阅确实被退掉", () => {
    const source = makeSource({ a: 1 });
    const push = vi.fn();
    const dispose = bindPaneState(source, ["a"], push);
    expect(source.listenerCount()).toBe(1);
    dispose();
    expect(source.listenerCount()).toBe(0);
    push.mockClear();
    source.set("a", 2);
    expect(push).not.toHaveBeenCalled();
  });

  it("重复清理安全(幂等)", () => {
    const dispose = bindPaneState(makeSource({ a: 1 }), ["a"], vi.fn());
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe("★★ 访问器换身份后的重绑(本任务的核心)", () => {
  it("★ 不重绑则新 store 的变化永远收不到 —— 复现「值永远是空的」那个症状", () => {
    const oldSource = makeSource({ a: "old" });
    const push = vi.fn();
    bindPaneState(oldSource, ["a"], push);
    push.mockClear();

    // 会话就绪握手 / 控制流重开 → 访问器换身份,新实例读的是新 store。
    const newSource = makeSource({ a: "new" });
    // 此时若**不**重绑:旧订阅还挂在 oldSource 上,newSource 的变化一个都收不到。
    newSource.set("a", "changed");
    expect(push).not.toHaveBeenCalled();
  });

  it("★ 重绑后立即重推新 store 的当前值(不必等下一次变化)", () => {
    const oldSource = makeSource({ a: "old" });
    const push = vi.fn();
    const disposeOld = bindPaneState(oldSource, ["a"], push);

    const newSource = makeSource({ a: "new" });
    disposeOld();
    push.mockClear();
    bindPaneState(newSource, ["a"], push);

    // 立即重推是关键:换身份往往发生在「值早就有了」之后,只订阅的话 pane 会一直空着,
    // 直到某次恰好有变化 —— 那可能永远不来。
    expect(push).toHaveBeenCalledWith("a", "new");
  });

  it("★ 重绑后新 store 的后续变化能收到,旧 store 的变化不再收到", () => {
    const oldSource = makeSource({ a: "old" });
    const push = vi.fn();
    const disposeOld = bindPaneState(oldSource, ["a"], push);

    const newSource = makeSource({ a: "new" });
    disposeOld();
    bindPaneState(newSource, ["a"], push);
    push.mockClear();

    newSource.set("a", "fresh");
    expect(push).toHaveBeenCalledWith("a", "fresh");

    push.mockClear();
    oldSource.set("a", "stale");
    // 旧 store 已退订 —— 否则会出现「两个 store 都在推,值来回跳」。
    expect(push).not.toHaveBeenCalled();
  });

  it("重绑不泄漏订阅(旧 store 的监听器数归零)", () => {
    const oldSource = makeSource({ a: 1, b: 2 });
    const dispose = bindPaneState(oldSource, ["a", "b"], vi.fn());
    expect(oldSource.listenerCount()).toBe(2);
    dispose();
    expect(oldSource.listenerCount()).toBe(0);
  });
});

/**
 * 标题持久化接线(spec auto-session-title, Req 8.1/8.2/8.3/8.6):
 * 包装 uiContext.setTitle → 原 setTitle(展示)+ persistTitle(title, 当前 session),两侧各自吞错、幂等;
 * persistTitle 收到的 session 为 bind 时的 `this`(进程内 new_session 后取新 session → 写对会话)。
 */
import { describe, expect, it, vi } from "vitest";
import { wireSessionTitlePersistence } from "../../src/runner/session-title-wiring.js";

/** 每个用例独立 class,使 prototype patch 不跨用例泄漏。 */
function makeRuntime(): {
  runtime: { session: object };
  Session: new (sm?: unknown) => { bindExtensions(b: unknown): string; sessionManager?: unknown };
  bindCalls: unknown[];
} {
  const bindCalls: unknown[] = [];
  class FakeSession {
    sessionManager?: unknown;
    constructor(sm?: unknown) {
      this.sessionManager = sm;
    }
    bindExtensions(bindings: unknown): string {
      bindCalls.push(bindings);
      return "original-result";
    }
  }
  return { runtime: { session: new FakeSession() }, Session: FakeSession, bindCalls };
}

function stderrSpy(): { stderr: { write: (s: string) => boolean }; lines: string[] } {
  const lines: string[] = [];
  return { stderr: { write: (s: string) => (lines.push(s), true) }, lines };
}

describe("wireSessionTitlePersistence", () => {
  it("绑定时包装 setTitle:调用它既触发原 setTitle 又触发 persistTitle(标题 + 当前 session)", () => {
    const { runtime, bindCalls } = makeRuntime();
    const persist = vi.fn();
    const w = wireSessionTitlePersistence(runtime, persist);
    expect(w.installed).toBe(true);

    const originalSetTitle = vi.fn();
    const ui = { setTitle: originalSetTitle };
    (runtime.session as { bindExtensions: (b: unknown) => unknown }).bindExtensions({ uiContext: ui });
    expect(bindCalls).toHaveLength(1);

    ui.setTitle("生成一张蓝天白云");
    expect(originalSetTitle).toHaveBeenCalledWith("生成一张蓝天白云");
    // persistTitle 收到 (title, 当前被绑定的 session = runtime.session)。
    expect(persist).toHaveBeenCalledWith("生成一张蓝天白云", runtime.session);
    w.restore();
  });

  it("进程内换 session(同 prototype 另一实例)→ persistTitle 收到新 session(写对会话)", () => {
    const { runtime, Session } = makeRuntime();
    const persist = vi.fn();
    const w = wireSessionTitlePersistence(runtime, persist);

    // 模拟 new_session:pi 以新 session(同 prototype)重绑新 uiContext。
    const newSession = new Session({ id: "sm-2" });
    const ui = { setTitle: vi.fn() };
    (newSession as { bindExtensions: (b: unknown) => unknown }).bindExtensions({ uiContext: ui });

    ui.setTitle("新会话标题");
    expect(persist).toHaveBeenCalledWith("新会话标题", newSession);
    // runner 据 session.sessionManager 取当前 SM。
    expect((persist.mock.calls[0]![1] as { sessionManager?: unknown }).sessionManager).toEqual({
      id: "sm-2",
    });
    w.restore();
  });

  it("原 setTitle 抛错 → persistTitle 仍被调用,且不抛出(Req 8.6)", () => {
    const { runtime } = makeRuntime();
    const persist = vi.fn();
    const { stderr, lines } = stderrSpy();
    const w = wireSessionTitlePersistence(runtime, persist, { stderr });

    const ui = {
      setTitle: () => {
        throw new Error("ui boom");
      },
    };
    (runtime.session as { bindExtensions: (b: unknown) => unknown }).bindExtensions({ uiContext: ui });

    expect(() => (ui.setTitle as (t: string) => void)("t")).not.toThrow();
    expect(persist).toHaveBeenCalledWith("t", runtime.session);
    expect(lines.join("")).toContain("original setTitle error");
    w.restore();
  });

  it("persistTitle 抛错 → 原 setTitle 仍被调用,且不抛出(Req 8.6)", () => {
    const { runtime } = makeRuntime();
    const original = vi.fn();
    const persist = vi.fn(() => {
      throw new Error("persist boom");
    });
    const { stderr, lines } = stderrSpy();
    const w = wireSessionTitlePersistence(runtime, persist, { stderr });

    const ui = { setTitle: original };
    (runtime.session as { bindExtensions: (b: unknown) => unknown }).bindExtensions({ uiContext: ui });

    expect(() => (ui.setTitle as (t: string) => void)("t")).not.toThrow();
    expect(original).toHaveBeenCalledWith("t");
    expect(lines.join("")).toContain("persist error");
    w.restore();
  });

  it("同一 uiContext 多次绑定不二次包装(幂等)", () => {
    const { runtime } = makeRuntime();
    const persist = vi.fn();
    const w = wireSessionTitlePersistence(runtime, persist);

    const ui = { setTitle: vi.fn() };
    const bind = (runtime.session as { bindExtensions: (b: unknown) => unknown }).bindExtensions;
    bind.call(runtime.session, { uiContext: ui });
    const wrappedAfterFirst = ui.setTitle;
    bind.call(runtime.session, { uiContext: ui });
    expect(ui.setTitle).toBe(wrappedAfterFirst);

    ui.setTitle("once");
    expect(persist).toHaveBeenCalledTimes(1);
    w.restore();
  });

  it("重复 wire 不重复 patch(prototype 幂等);restore 复位", () => {
    const { runtime } = makeRuntime();
    const proto = Object.getPrototypeOf(runtime.session) as { bindExtensions: unknown };
    const before = proto.bindExtensions;
    const w1 = wireSessionTitlePersistence(runtime, vi.fn());
    const patched = proto.bindExtensions;
    const w2 = wireSessionTitlePersistence(runtime, vi.fn());
    expect(proto.bindExtensions).toBe(patched);
    expect(w2.installed).toBe(true);
    w1.restore();
    expect(proto.bindExtensions).toBe(before);
    void w2;
  });

  it("session prototype 无 bindExtensions → 优雅降级 installed:false", () => {
    const runtime = { session: Object.create(null) as object };
    const { stderr, lines } = stderrSpy();
    const w = wireSessionTitlePersistence(runtime, vi.fn(), { stderr });
    expect(w.installed).toBe(false);
    expect(lines.join("")).toContain("not installed");
  });

  it("uiContext 无 setTitle 时:包装版仍持久化(原 setTitle 缺失安全跳过)", () => {
    const { runtime } = makeRuntime();
    const persist = vi.fn();
    const w = wireSessionTitlePersistence(runtime, persist);
    const ui: { setTitle?: (t: string) => void } = {};
    (runtime.session as { bindExtensions: (b: unknown) => unknown }).bindExtensions({ uiContext: ui });
    expect(typeof ui.setTitle).toBe("function");
    expect(() => ui.setTitle!("t")).not.toThrow();
    expect(persist).toHaveBeenCalledWith("t", runtime.session);
    w.restore();
  });
});

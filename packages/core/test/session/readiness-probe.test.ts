/**
 * ReadinessProbe — 就绪探针的机制(自 PiSession 提出,H1)。
 *
 * 覆盖三处此前只能经真实会话间接验的要害:竞态收敛(超时与响应只认先到者)、
 * 单一清理入口(cancel 同时管两个定时器)、settle 窗口重排。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReadinessProbe } from "../../src/session/readiness-probe.js";

function deps(over: Partial<Parameters<typeof makeDeps>[0]> = {}) {
  return makeDeps(over);
}
function makeDeps(over: {
  timeoutMs?: number;
  probe?: () => Promise<unknown>;
  canStart?: () => boolean;
  onReady?: () => void;
  onFailure?: (code: "probe-timeout" | "probe-failed", detail: string) => void;
}) {
  return {
    timeoutMs: over.timeoutMs ?? 1000,
    probe: over.probe ?? (() => new Promise<unknown>(() => {})),
    canStart: over.canStart ?? (() => true),
    onReady: over.onReady ?? vi.fn(),
    onFailure: over.onFailure ?? vi.fn(),
  };
}

describe("ReadinessProbe — 成败路径", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("探针 resolve → onReady", async () => {
    const onReady = vi.fn();
    const p = new ReadinessProbe(deps({ probe: async () => ({ ok: true }), onReady }));
    p.start();
    await vi.runAllTimersAsync();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("★探针以 error 响应 resolve 也算就绪(有响应即证明读循环已起)", async () => {
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const p = new ReadinessProbe(
      deps({ probe: async () => ({ error: "unknown command" }), onReady, onFailure }),
    );
    p.start();
    await vi.runAllTimersAsync();
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("超时未响应 → onFailure(probe-timeout)", async () => {
    const onFailure = vi.fn();
    const p = new ReadinessProbe(deps({ timeoutMs: 500, onFailure }));
    p.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(onFailure).toHaveBeenCalledWith("probe-timeout", expect.stringContaining("timed out"));
  });

  it("探针 reject → onFailure(probe-failed)", async () => {
    const onFailure = vi.fn();
    const p = new ReadinessProbe(deps({ probe: () => Promise.reject(new Error("x")), onFailure }));
    p.start();
    await vi.runAllTimersAsync();
    expect(onFailure).toHaveBeenCalledWith("probe-failed", "readiness probe rejected");
  });

  it("探针**同步**抛出 → 归一为 probe-failed(不外泄)", () => {
    const onFailure = vi.fn();
    const p = new ReadinessProbe(
      deps({
        probe: () => {
          throw new Error("boom");
        },
        onFailure,
      }),
    );
    expect(() => p.start()).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith("probe-failed", expect.stringContaining("boom"));
  });

  it("canStart 为假 → 静默跳过,不探不计时", () => {
    const probe = vi.fn(async () => ({}));
    const p = new ReadinessProbe(deps({ canStart: () => false, probe }));
    p.start();
    expect(probe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ReadinessProbe — 竞态收敛", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("★超时先到 → 随后的响应完全无副作用(不会再判一次 ready)", async () => {
    let resolveProbe: (v: unknown) => void = () => {};
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const p = new ReadinessProbe(
      deps({
        timeoutMs: 100,
        probe: () => new Promise((r) => (resolveProbe = r)),
        onReady,
        onFailure,
      }),
    );
    p.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onFailure).toHaveBeenCalledOnce();
    resolveProbe({});
    await vi.runAllTimersAsync();
    expect(onReady).not.toHaveBeenCalled(); // 若无收敛,这里会多判一次 ready
  });

  it("★响应先到 → 超时定时器被清,不会再判一次 error", async () => {
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const p = new ReadinessProbe(
      deps({ timeoutMs: 100, probe: async () => ({}), onReady, onFailure }),
    );
    p.start();
    await vi.runAllTimersAsync();
    expect(onReady).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ReadinessProbe — cancel 与 startAfter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("★cancel 同时清在途探针与待触发的 settle(单一清理入口)", async () => {
    const onFailure = vi.fn();
    const p = new ReadinessProbe(deps({ timeoutMs: 500, onFailure }));
    p.start();
    p.startAfter(300);
    // 3 = 超时定时器 + **重发定时器** + settle 定时器。
    // ★ 重发是后加的(见 READINESS_PROBE_RETRY_MS 的判别实验),这个中间计数随之从 2 变 3 ——
    //   改它是因为机制**真的多了一个定时器**,不是为了让测试变绿。
    //   本用例的判据在下一行:cancel() 后必须归 **0**。那条一个字没动,而且因为
    //   现在多守一个定时器,它比改动前更强 —— 漏清重发定时器会当场报 1。
    expect(vi.getTimerCount()).toBe(3);
    p.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("cancel 幂等", () => {
    const p = new ReadinessProbe(deps({}));
    expect(() => {
      p.cancel();
      p.cancel();
    }).not.toThrow();
  });

  it("startAfter 延迟后才探测", async () => {
    const probe = vi.fn(async () => ({}));
    const p = new ReadinessProbe(deps({ probe }));
    p.startAfter(300);
    await vi.advanceTimersByTimeAsync(299);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("★重复 startAfter → 以最后一次为准(不会探两次)", async () => {
    const probe = vi.fn(async () => ({}));
    const p = new ReadinessProbe(deps({ probe }));
    p.startAfter(300);
    p.startAfter(300);
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("startAfter 到期时 canStart 已为假 → 不探", async () => {
    const probe = vi.fn(async () => ({}));
    let active = true;
    const p = new ReadinessProbe(deps({ probe, canStart: () => active }));
    p.startAfter(300);
    active = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).not.toHaveBeenCalled();
  });
});

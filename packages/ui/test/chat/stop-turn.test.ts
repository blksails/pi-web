/**
 * 「停止本轮」决策逻辑测试(spec tool-abort-terminal-state)。
 *
 * ★ 立项来自真机对照实验(2026-07-29),同 agent 同模型,差别只有是否调用本地 stop:
 *     走 onStop → stop()            → 工具卡 Running(永久,计时器走到 1:31)
 *     直接 POST /sessions/:id/abort → 工具卡 Completed、计时器定格 16.5s、显示「已取消」
 *   会话文件两次都正确落盘了取消结果 —— 后端一直是对的,错的是前端过早切断 SSE 流,
 *   导致后端随后推送的终态帧收不到。
 *
 * 故本套件的头号断言是:**abort 成功时不得本地停止**。
 */
import { describe, it, expect, vi } from "vitest";
import { runStopTurn, STOP_TERMINAL_FRAME_TIMEOUT_MS } from "../../src/chat/stop-turn.js";

/** 手控定时器:避免真等 5 秒。 */
function fakeTimer() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    setTimeoutImpl: (fn: () => void, ms: number) => {
      pending.push({ fn, ms });
      return pending.length - 1;
    },
    clearTimeoutImpl: (h: unknown) => {
      const i = h as number;
      if (pending[i]) pending[i] = { fn: () => undefined, ms: 0 };
    },
    fireAll: () => pending.forEach((p) => p.fn()),
    scheduledMs: () => pending.map((p) => p.ms),
    count: () => pending.length,
  };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("runStopTurn — abort 成功路径(核心)", () => {
  it("★ abort 成功时**不**本地停止(否则断流丢终态帧,卡片永久 Running)", async () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    runStopTurn({
      abortTurn: async () => undefined,
      localStop,
      ...t,
    });
    await tick();
    expect(localStop, "abort 成功后不应本地停止").not.toHaveBeenCalled();
  });

  it("abort 被调用一次", async () => {
    const abortTurn = vi.fn(async () => undefined);
    const t = fakeTimer();
    runStopTurn({ abortTurn, localStop: vi.fn(), ...t });
    await tick();
    expect(abortTurn).toHaveBeenCalledTimes(1);
  });

  it("★ 终态帧迟迟不来 → 超时后兜底本地停止(不让界面无限停在运行态)", async () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    runStopTurn({ abortTurn: async () => undefined, localStop, ...t });
    await tick();
    expect(localStop).not.toHaveBeenCalled();
    expect(t.scheduledMs()).toEqual([STOP_TERMINAL_FRAME_TIMEOUT_MS]);
    t.fireAll();
    expect(localStop).toHaveBeenCalledTimes(1);
  });

  it("兜底时限可注入覆盖", async () => {
    const t = fakeTimer();
    runStopTurn({ abortTurn: async () => undefined, localStop: vi.fn(), timeoutMs: 1234, ...t });
    await tick();
    expect(t.scheduledMs()).toEqual([1234]);
  });
});

describe("runStopTurn — 兜底路径", () => {
  it("★ 无 abort 能力 → 直接本地停止(与修复前行为一致)", () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    runStopTurn({ localStop, ...t });
    expect(localStop).toHaveBeenCalledTimes(1);
    expect(t.count(), "不该安排兜底定时器").toBe(0);
  });

  it("★ abort 抛错 → 立即本地停止", async () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    runStopTurn({
      abortTurn: async () => {
        throw new Error("network down");
      },
      localStop,
      ...t,
    });
    await tick();
    expect(localStop).toHaveBeenCalledTimes(1);
    expect(t.count(), "失败路径不安排兜底定时器").toBe(0);
  });
});

describe("runStopTurn — 生命周期", () => {
  it("★ cancelFallback 后不再触发本地停止(组件卸载场景)", async () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    const h = runStopTurn({ abortTurn: async () => undefined, localStop, ...t });
    await tick();
    h.cancelFallback();
    t.fireAll();
    expect(localStop, "已取消的兜底不应再触发").not.toHaveBeenCalled();
  });

  it("★ abort 尚未 resolve 时就取消 → 不安排兜底也不停止", async () => {
    const localStop = vi.fn();
    const t = fakeTimer();
    let resolveAbort!: () => void;
    const h = runStopTurn({
      abortTurn: () => new Promise<void>((r) => (resolveAbort = r)),
      localStop,
      ...t,
    });
    h.cancelFallback(); // 先卸载
    resolveAbort();
    await tick();
    expect(t.count()).toBe(0);
    expect(localStop).not.toHaveBeenCalled();
  });

  it("cancelFallback 幂等", async () => {
    const t = fakeTimer();
    const h = runStopTurn({ abortTurn: async () => undefined, localStop: vi.fn(), ...t });
    await tick();
    h.cancelFallback();
    expect(() => h.cancelFallback()).not.toThrow();
  });
});

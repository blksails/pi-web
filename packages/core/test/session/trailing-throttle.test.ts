/**
 * TrailingThrottle — 尾沿节流器(自 PiSession 的附件事件转发提出,H1)。
 *
 * 语义要害:首条立即发、窗口内合并只留最新、窗口到期补发一次、dispose 丢弃而非补发。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrailingThrottle } from "../../src/session/trailing-throttle.js";

describe("TrailingThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("首条立即发出(无历史 → 不等窗口)", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    t.push("a");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("a");
  });

  it("★窗口内的多条合并为一条,且保留**最新**", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    t.push("a"); // 立即
    vi.setSystemTime(100);
    t.push("b");
    vi.setSystemTime(200);
    t.push("c");
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith("c"); // 不是 "b"
  });

  it("补发的延迟从**上次发出**算起,不是从最后一次 push 算起", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    t.push("a"); // t=0 发出
    vi.setSystemTime(900);
    t.push("b"); // 应在 t=1000 补发,即 100ms 后
    vi.advanceTimersByTime(99);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("超过窗口后再 push → 又是立即发出", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    t.push("a");
    vi.setSystemTime(1500);
    t.push("b");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith("b");
    expect(vi.getTimerCount()).toBe(0); // 立即发出不该留定时器
  });

  it("★dispose 丢弃挂起载荷而非补发(会话收尾时 emitter 正在拆)", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    t.push("a");
    vi.setSystemTime(100);
    t.push("b"); // 挂起
    t.dispose();
    vi.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(1); // 只有最初那条
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose 幂等,且 dispose 后仍可继续使用", () => {
    const emit = vi.fn();
    const t = new TrailingThrottle<string>(1000, emit);
    expect(() => {
      t.dispose();
      t.dispose();
    }).not.toThrow();
    vi.setSystemTime(5000);
    t.push("x");
    expect(emit).toHaveBeenCalledWith("x");
  });
});

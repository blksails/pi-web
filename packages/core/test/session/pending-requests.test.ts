/**
 * PendingRequests — 「下发请求帧 → 按 id 配对结果帧」在途表。
 *
 * 该类由 PiSession 里三张同构表(clearQueue / agent-routes / attachment-catalog)收敛而来;
 * 本档直测其语义,使三处共用的行为只需验一遍,且回归定位到这一层而非某条业务链。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PendingRequests } from "../../src/session/pending-requests.js";

describe("PendingRequests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("issue → settle:以结果 resolve,并从表中摘除", async () => {
    const p = new PendingRequests<{ v: number }>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 1000,
      onTimeout: () => new Error("timeout"),
      send: () => {},
    });
    expect(p.size).toBe(1);
    expect(p.settle("a", { v: 42 })).toBe(true);
    await expect(promise).resolves.toEqual({ v: 42 });
    expect(p.size).toBe(0);
  });

  it("★settle 未知 id → 返回 false 且不抛(结果晚于超时到达是正常情形)", () => {
    const p = new PendingRequests<number>();
    expect(p.settle("never-issued", 1)).toBe(false);
  });

  it("★settle 后再 settle 同一 id → false(一次性)", async () => {
    const p = new PendingRequests<number>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 1000,
      onTimeout: () => new Error("timeout"),
      send: () => {},
    });
    expect(p.settle("a", 1)).toBe(true);
    expect(p.settle("a", 2)).toBe(false);
    await expect(promise).resolves.toBe(1);
  });

  it("超时 → 以 onTimeout() 的错误 reject 并摘除", async () => {
    const p = new PendingRequests<number>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 500,
      onTimeout: () => new Error("clear_queue timed out"),
      send: () => {},
    });
    vi.advanceTimersByTime(500);
    await expect(promise).rejects.toThrow("clear_queue timed out");
    expect(p.size).toBe(0);
  });

  it("★onTimeout 惰性:未超时则从不调用", async () => {
    const p = new PendingRequests<number>();
    const onTimeout = vi.fn(() => new Error("x"));
    const promise = p.issue({ id: "a", timeoutMs: 500, onTimeout, send: () => {} });
    p.settle("a", 1);
    await promise;
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("★settle 后定时器被清:不会在超时点再触发任何事", async () => {
    const p = new PendingRequests<number>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 500,
      onTimeout: () => new Error("should not happen"),
      send: () => {},
    });
    p.settle("a", 7);
    await expect(promise).resolves.toBe(7);
    // 若定时器未清,这一步会触发一个无人接管的 reject(unhandled rejection)。
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("★send 抛错 → 立即 reject 并清理,不必等到超时", async () => {
    const p = new PendingRequests<number>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 10_000,
      onTimeout: () => new Error("timeout"),
      send: () => {
        throw new Error("channel closed");
      },
    });
    await expect(promise).rejects.toThrow("channel closed");
    expect(p.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("send 抛非 Error → 包装成 Error", async () => {
    const p = new PendingRequests<number>();
    const promise = p.issue({
      id: "a",
      timeoutMs: 1000,
      onTimeout: () => new Error("timeout"),
      send: () => {
        throw "plain string";
      },
    });
    await expect(promise).rejects.toThrow("plain string");
  });

  it("rejectAll → 全部 reject、清表、清定时器(会话收尾语义)", async () => {
    const p = new PendingRequests<number>();
    const a = p.issue({ id: "a", timeoutMs: 9999, onTimeout: () => new Error("t"), send: () => {} });
    const b = p.issue({ id: "b", timeoutMs: 9999, onTimeout: () => new Error("t"), send: () => {} });
    p.rejectAll(() => new Error("session stopped"));
    await expect(a).rejects.toThrow("session stopped");
    await expect(b).rejects.toThrow("session stopped");
    expect(p.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("★rejectAll 的错误逐条构造(每条各拿一个实例,便于携带各自上下文)", () => {
    const p = new PendingRequests<number>();
    void p.issue({ id: "a", timeoutMs: 9999, onTimeout: () => new Error("t"), send: () => {} }).catch(() => {});
    void p.issue({ id: "b", timeoutMs: 9999, onTimeout: () => new Error("t"), send: () => {} }).catch(() => {});
    const factory = vi.fn(() => new Error("stopped"));
    p.rejectAll(factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rejectAll 空表 → 无副作用", () => {
    const p = new PendingRequests<number>();
    expect(() => p.rejectAll(() => new Error("x"))).not.toThrow();
    expect(p.size).toBe(0);
  });
});

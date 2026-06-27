/**
 * PiSession 就绪握手单测(spec session-readiness-handshake, Task 2.6)。
 *
 * 覆盖:
 *  - 构造后初态 initializing(2.1)
 *  - 探针 resolve → ready 并广播 session-status{ready}(2.2 / 1.4)
 *  - 探针超时 → error{probe-timeout}(4.1)
 *  - 子进程就绪前退出 → error{exit-before-ready}(4.2)
 *  - 就绪后再探针/事件不回拨(幂等,1.5)
 *  - subscribe 晚于 ready 仍回放 ready(粘性,2.4 防丢帧)
 *  - restart 复位 initializing 并重探针(5.1)
 *  - readinessHandshake 关闭时完全不发 session-status 帧(6.2 零回归)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  RpcResponse,
  SseFrame,
  SessionLifecycleState,
} from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

/** 取出所有 session-status 帧承载的 state(按序)。 */
function statuses(frames: SseFrame[]): SessionLifecycleState[] {
  return frames
    .filter(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control ===
          "session-status",
    )
    .map((f) => (f as { payload: { state: SessionLifecycleState } }).payload.state);
}

function lastStatusFrame(
  frames: SseFrame[],
): { state: SessionLifecycleState; code?: string } | undefined {
  const ss = frames.filter(
    (f) =>
      f.kind === "control" &&
      (f as { payload?: { control?: string } }).payload?.control ===
        "session-status",
  );
  const last = ss[ss.length - 1];
  return last
    ? (last as { payload: { state: SessionLifecycleState; code?: string } })
        .payload
    : undefined;
}

/** 可控 getCommands 解析时机的通道(用于探针时序测试)。 */
class DeferredProbeChannel extends MockChannel {
  private resolveProbe?: (r: RpcResponse) => void;
  private rejectProbe?: (e: unknown) => void;
  /** no-op:实际子进程重生不在单测范围,仅驱动 PiSession 的重握手逻辑。 */
  requestRestart(): void {
    this.calls.push({ method: "request_restart", args: [] });
  }
  override getCommands(): Promise<RpcResponse> {
    this.calls.push({ method: "get_commands", args: [] });
    return new Promise<RpcResponse>((res, rej) => {
      this.resolveProbe = res;
      this.rejectProbe = rej;
    });
  }
  settleReady(): void {
    this.resolveProbe?.({
      type: "response",
      id: "1",
      command: "get_commands",
      success: true,
    } as RpcResponse);
  }
  settleReject(): void {
    this.rejectProbe?.(new Error("probe rejected"));
  }
}

describe("PiSession 就绪握手 (Task 2.6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("构造后初态为 initializing(2.1)", () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-init",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    expect(session.lifecycle).toBe("initializing");
  });

  it("探针 resolve → ready 并向订阅者广播 session-status{ready}(2.2/1.4)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-ready",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    // 订阅即回放当前态 initializing。
    expect(statuses(frames)).toEqual(["initializing"]);

    channel.settleReady();
    await vi.runAllTimersAsync();

    expect(session.lifecycle).toBe("ready");
    // 既有订阅者收到广播的 ready。
    expect(statuses(frames)).toContain("ready");
  });

  it("探针超时 → error{probe-timeout}(4.1)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-timeout",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readinessProbeTimeoutMs: 5_000,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await vi.advanceTimersByTimeAsync(5_001);

    expect(session.lifecycle).toBe("error");
    expect(lastStatusFrame(frames)).toMatchObject({
      state: "error",
      code: "probe-timeout",
    });
  });

  it("探针通道拒绝 → error{probe-failed}", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-reject",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    channel.settleReject();
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("error");
    expect(lastStatusFrame(frames)?.code).toBe("probe-failed");
  });

  it("子进程就绪前退出 → error{exit-before-ready}(4.2)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-exit",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    // 探针未 settle,直接早退。
    channel.emitExit({ code: 1, signal: null });
    await vi.runAllTimersAsync();
    expect(lastStatusFrame(frames)).toMatchObject({
      state: "error",
      code: "exit-before-ready",
    });
  });

  it("就绪后再 resolve/事件不回拨(幂等,1.5)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-idem",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    channel.settleReady();
    await vi.runAllTimersAsync();
    const readyCount = statuses(frames).filter((s) => s === "ready").length;
    // 再次 settle(无效)与任意事件不应产生第二帧 ready。
    channel.settleReady();
    await vi.runAllTimersAsync();
    expect(statuses(frames).filter((s) => s === "ready").length).toBe(readyCount);
    expect(session.lifecycle).toBe("ready");
  });

  it("subscribe 晚于 ready 仍立即回放 ready(粘性,2.4 防丢帧)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-sticky",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    // 先就绪,后订阅。
    channel.settleReady();
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    const late: SseFrame[] = [];
    session.subscribe((f) => late.push(f));
    expect(statuses(late)).toEqual(["ready"]);
  });

  it("restart 复位 initializing 并重探针 → 再就绪(5.1)", async () => {
    const channel = new DeferredProbeChannel();
    const session = new PiSession({
      id: "rd-restart",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    channel.settleReady();
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    await session.restartRunner();
    // 复位即广播 initializing。
    expect(session.lifecycle).toBe("initializing");
    expect(statuses(frames)).toContain("initializing");

    // settle 延迟后重探针;再次 settle → ready。
    await vi.advanceTimersByTimeAsync(600);
    channel.settleReady();
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");
  });

  it("readinessHandshake 关闭时不发任何 session-status 帧(6.2 零回归)", async () => {
    const channel = new MockChannel();
    const session = new PiSession({
      id: "rd-off",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      // readinessHandshake 缺省 = false
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    await vi.runAllTimersAsync();
    expect(statuses(frames)).toEqual([]);
    expect(session.lifecycle).toBe("initializing");
  });
});

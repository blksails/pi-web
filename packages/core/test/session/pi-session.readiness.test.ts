/**
 * PiSession 就绪判定单测(spec runner-ready-frame,T3;取代探针时代的 Task 2.6 档)。
 *
 * 覆盖:
 *  - 构造后初态 initializing;custom 模式构造**不发任何探针请求**(3.1)
 *  - 收 `runner_ready` 帧 → ready 并广播 session-status{ready}(2.3)
 *  - 看门狗超时 → error{ready-frame-missing}(4.1/4.2)
 *  - 重复/迟到帧 → 无第二次状态变更(2.4)
 *  - cli 单发:getCommands 成功 → ready 且**只发一次**;失败静默交给看门狗(6.1/6.2)
 *  - 子进程就绪前退出 → error{exit-before-ready} 不变(4.5)
 *  - subscribe 晚于 ready 仍回放 ready(粘性,7.1)
 *  - restart 复位 initializing → 新 ready 帧再就绪;无 settle 定时器(5.1/5.2/5.3)
 *  - restart 后不发帧 → 看门狗 error(5.4)
 *  - readinessHandshake 关闭:零帧,收 ready 帧亦零变更(3.4)
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

const READY_LINE = JSON.stringify({ type: "runner_ready" });

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

/** 支持 restart 的通道(重生本身不在单测范围,仅驱动 PiSession 的重握手逻辑)。 */
class RestartableChannel extends MockChannel {
  requestRestart(): void {
    this.calls.push({ method: "request_restart", args: [] });
  }
}

/** cli 单发用:getCommands 时机可控。 */
class DeferredCommandsChannel extends MockChannel {
  attempts = 0;
  private resolveCmd?: (r: RpcResponse) => void;
  private rejectCmd?: (e: unknown) => void;
  override getCommands(): Promise<RpcResponse> {
    this.calls.push({ method: "get_commands", args: [] });
    this.attempts += 1;
    return new Promise<RpcResponse>((res, rej) => {
      this.resolveCmd = res;
      this.rejectCmd = rej;
    });
  }
  settleReady(): void {
    this.resolveCmd?.({
      type: "response",
      id: "1",
      command: "get_commands",
      success: true,
    } as RpcResponse);
  }
  settleReject(): void {
    this.rejectCmd?.(new Error("channel closed"));
  }
}

/** custom(runner)模式:就绪只能来自 runner_ready 帧。 */
const customResolved = () => makeResolved({ mode: "custom" });

describe("PiSession 就绪判定 — runner_ready 帧(custom 模式)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("构造后初态 initializing,且不发任何探针请求(3.1)", () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-init",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    expect(session.lifecycle).toBe("initializing");
    // R3.1:custom 模式构造期零探针 —— 通道上没有任何 get_commands 调用。
    expect(channel.calls.filter((c) => c.method === "get_commands")).toEqual([]);
  });

  it("收 runner_ready 帧 → ready 并广播 session-status{ready}(2.3)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-ready",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    expect(statuses(frames)).toEqual(["initializing"]);

    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();

    expect(session.lifecycle).toBe("ready");
    expect(statuses(frames)).toContain("ready");
  });

  it("看门狗超时 → error{ready-frame-missing}(4.1/4.2)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-watchdog",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readyTimeoutMs: 5_000,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await vi.advanceTimersByTimeAsync(5_001);

    expect(session.lifecycle).toBe("error");
    expect(lastStatusFrame(frames)).toMatchObject({
      state: "error",
      code: "ready-frame-missing",
    });
  });

  it("重复 ready 帧 → 无第二帧(2.4 幂等)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-dup",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    const readyCount = statuses(frames).filter((s) => s === "ready").length;

    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();

    expect(statuses(frames).filter((s) => s === "ready").length).toBe(readyCount);
    expect(session.lifecycle).toBe("ready");
  });

  it("终态(error)后迟到的 ready 帧 → 忽略(2.4 单向守卫)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-late",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readyTimeoutMs: 1_000,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await vi.advanceTimersByTimeAsync(1_001);
    expect(session.lifecycle).toBe("error");

    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();

    expect(session.lifecycle).toBe("error");
    expect(statuses(frames)).not.toContain("ready");
  });

  it("ready 后看门狗被取消:超时点过后无 error(4.4)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-cancel",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readyTimeoutMs: 2_000,
    });
    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.lifecycle).toBe("ready");
  });

  it("子进程就绪前退出 → error{exit-before-ready} 不变(4.5)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-exit",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.emitExit({ code: 1, signal: null });
    await vi.runAllTimersAsync();

    expect(lastStatusFrame(frames)).toMatchObject({
      state: "error",
      code: "exit-before-ready",
    });
  });

  it("subscribe 晚于 ready 仍立即回放 ready(粘性,7.1)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-sticky",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    const late: SseFrame[] = [];
    session.subscribe((f) => late.push(f));
    expect(statuses(late)).toEqual(["ready"]);
  });

  it("restart 复位 initializing → 新 ready 帧再就绪,无 settle 等待(5.1/5.2/5.3)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-restart",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));
    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    await session.restartRunner();
    expect(session.lifecycle).toBe("initializing");
    expect(statuses(frames)).toContain("initializing");

    // 无 settle 延迟:新子进程的 ready 帧到达即就绪(5.3 收帧化下无需等窗口)。
    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");
  });

  it("restart 后不发帧 → 看门狗 error{ready-frame-missing}(5.4)", async () => {
    const channel = new RestartableChannel();
    const session = new PiSession({
      id: "rf-restart-watchdog",
      resolved: customResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readyTimeoutMs: 3_000,
    });
    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");

    await session.restartRunner();
    expect(session.lifecycle).toBe("initializing");

    await vi.advanceTimersByTimeAsync(3_001);
    expect(session.lifecycle).toBe("error");
  });
});

describe("PiSession 就绪判定 — cli 单发(6.1/6.2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("单发 getCommands 成功 → ready;且只发一次(无重发)", async () => {
    const channel = new DeferredCommandsChannel();
    const session = new PiSession({
      id: "rf-cli",
      resolved: makeResolved(), // fixtures 默认 mode: "cli"
      channel,
      idleMs: 0,
      readinessHandshake: true,
    });
    expect(channel.attempts).toBe(1);

    // 推进远超旧重发间隔(1s)的时间:仍只有 1 发 —— R6.2 无周期性重发。
    await vi.advanceTimersByTimeAsync(5_000);
    expect(channel.attempts).toBe(1);

    channel.settleReady();
    await vi.runAllTimersAsync();
    expect(session.lifecycle).toBe("ready");
  });

  it("单发失败 → 静默保持 initializing,由看门狗收口(不产生 probe-failed)", async () => {
    const channel = new DeferredCommandsChannel();
    const session = new PiSession({
      id: "rf-cli-reject",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
      readinessHandshake: true,
      readyTimeoutMs: 4_000,
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.settleReject();
    await vi.advanceTimersByTimeAsync(0); // 只冲微任务,不触发看门狗
    // 失败静默:不立即 error(交给看门狗/exit 收口)。
    expect(session.lifecycle).toBe("initializing");

    await vi.advanceTimersByTimeAsync(4_001);
    expect(session.lifecycle).toBe("error");
    const last = lastStatusFrame(frames);
    expect(last?.code).toBe("ready-frame-missing");
    // 旧错误码不再产生(3.2)。
    expect(statuses(frames)).not.toContain("probe-failed" as never);
  });
});

describe("PiSession 就绪判定 — handshake 关闭(3.4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("零帧;收 runner_ready 帧亦零状态变更", async () => {
    const channel = new MockChannel();
    const session = new PiSession({
      id: "rf-off",
      resolved: makeResolved({ mode: "custom" }),
      channel,
      idleMs: 0,
      // readinessHandshake 缺省 = false
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.emitLine(READY_LINE);
    await vi.runAllTimersAsync();

    expect(statuses(frames)).toEqual([]);
    expect(session.lifecycle).toBe("initializing");
  });
});

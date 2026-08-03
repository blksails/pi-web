/**
 * stdin-resume-gate — resume 判据 / 兜底 / 竞态收敛 / dispose(spec runner-ready-frame,T1)。
 *
 * ★ 死锁守卫(Req 8.2):本档含一条「反向用例」—— 人为破坏判据(不挂 newListener 能拦到的
 *   data 监听器)且禁用兜底路径的等价场景下,断言 resume **不会**发生。它证明本测试面的
 *   判据具有判别力(能报红),其余绿灯才可信 —— 「先证明判据能报红再信它报的绿」。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { installStdinResumeGate } from "../../src/runner/stdin-resume-gate.js";
import type { GateReadableLike } from "../../src/runner/frame-channel/stream-views.js";

/** EventEmitter 假 stdin:记录 pause/resume 调用,listenerCount 走真实 EventEmitter 语义。 */
function makeGateStdin() {
  const ee = new EventEmitter() as EventEmitter & {
    pause(): void;
    resume(): void;
  };
  let resumeCalls = 0;
  ee.pause = () => {};
  ee.resume = () => {
    resumeCalls += 1;
  };
  return {
    stdin: ee as unknown as GateReadableLike,
    ee,
    getResumeCalls: () => resumeCalls,
  };
}

function makeSink() {
  const lines: string[] = [];
  return { sink: { write: (s: string) => (lines.push(s), true) }, lines };
}

/** 冲一拍 setImmediate(判据核对落在 setImmediate 回调里)。 */
const tick = () => new Promise<void>((r) => setImmediate(() => setImmediate(r)));

afterEach(() => {
  vi.useRealTimers();
});

describe("stdin-resume-gate — 判据路径", () => {
  it("新增 data 监听器 → resume + sendReady 恰一次", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    ee.on("data", () => {}); // 模拟 pi runRpcMode 晚挂读取器
    await tick();

    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("再来一个 data 监听器:不重复触发(settled 单向)", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    ee.on("data", () => {});
    await tick();
    ee.on("data", () => {});
    await tick();

    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("非 data 事件的监听器不触发判据", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    ee.on("end", () => {});
    await tick();

    expect(getResumeCalls()).toBe(0);
    expect(ready).not.toHaveBeenCalled();
  });

  it("baseline 之前已有的 data 监听器不计入(安装时点语义)", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    ee.on("data", () => {}); // frame-channel 读取器(安装前已挂)
    const ready = vi.fn();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    await tick();
    expect(getResumeCalls()).toBe(0); // 无新增 → 不触发

    ee.on("data", () => {}); // pi 读取器
    await tick();
    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});

describe("stdin-resume-gate — 兜底路径(Req 1.4)", () => {
  it("判据永不命中 → fallbackMs 后强制 resume + sendReady + stderr 诊断", async () => {
    vi.useFakeTimers();
    const { stdin, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    const { sink, lines } = makeSink();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: sink, fallbackMs: 500 });

    await vi.advanceTimersByTimeAsync(499);
    expect(getResumeCalls()).toBe(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(lines.join("")).toContain("stdin-resume-gate fallback fired");
  });

  it("判据先命中 → 兜底到点后无第二次动作(竞态收敛)", async () => {
    vi.useFakeTimers();
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    const { sink, lines } = makeSink();
    installStdinResumeGate({ stdin, sendReady: ready, stderr: sink, fallbackMs: 500 });

    ee.on("data", () => {});
    await vi.advanceTimersByTimeAsync(1); // 冲 setImmediate(fake timers 下 advanceAsync 会跑 immediates)
    expect(getResumeCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(lines.join("")).not.toContain("fallback fired");
  });
});

describe("stdin-resume-gate — 死锁守卫(Req 8.2:先证明判据能报红)", () => {
  it("反向用例:判据无法命中且兜底未到点 → resume 必须不发生(证明绿灯有判别力)", async () => {
    vi.useFakeTimers();
    const { stdin, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    installStdinResumeGate({
      stdin,
      sendReady: ready,
      stderr: makeSink().sink,
      fallbackMs: 60_000, // 兜底推远 = 等价于禁用
    });
    // 不挂任何新 data 监听器 = 判据被破坏的场景

    await vi.advanceTimersByTimeAsync(5_000);

    // 若此断言在「判据被破坏」时仍绿,说明 gate 在无判据时也 resume 了 ——
    // 那全部判据用例的绿灯都失去判别力。此处必须是 0。
    expect(getResumeCalls()).toBe(0);
    expect(ready).not.toHaveBeenCalled();
  });
});

describe("stdin-resume-gate — dispose", () => {
  it("dispose 后判据不再触发;重复 dispose 幂等", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    const gate = installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    gate.cleanup();
    gate.cleanup(); // 幂等

    ee.on("data", () => {});
    await tick();

    expect(getResumeCalls()).toBe(0);
    expect(ready).not.toHaveBeenCalled();
  });

  it("dispose 后兜底也不触发(定时器已清)", async () => {
    vi.useFakeTimers();
    const { stdin, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    const gate = installStdinResumeGate({
      stdin,
      sendReady: ready,
      stderr: makeSink().sink,
      fallbackMs: 100,
    });

    gate.cleanup();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getResumeCalls()).toBe(0);
    expect(ready).not.toHaveBeenCalled();
  });

  it("已触发后 dispose:不撤销已发生的 resume,也不重复动作", async () => {
    const { stdin, ee, getResumeCalls } = makeGateStdin();
    const ready = vi.fn();
    const gate = installStdinResumeGate({ stdin, sendReady: ready, stderr: makeSink().sink });

    ee.on("data", () => {});
    await tick();
    expect(getResumeCalls()).toBe(1);

    gate.cleanup();
    expect(getResumeCalls()).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});

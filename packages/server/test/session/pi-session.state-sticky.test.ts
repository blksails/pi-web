/**
 * state-injection-bridge 增量 — control:"state" 帧的粘性回放(重连不丢 KV)。
 *
 * 现状(修前):handleRawLine 收到 `piweb_state` 行只广播,不登记粘性;重连订阅者拿不到
 * 已发生过的 KV 变更(与 session-status/session-state/queue 不对称)。
 * 本测试锁定:按 key 独立登记粘性(`state:${key}`)+ 新订阅者回放 + delete 帧同样可回放
 * (前端据 deleted:true 语义删键)+ 同 key 多次 set 只留最新(last-value)+ rev 单调。
 */
import { describe, expect, it } from "vitest";
import type { SseFrame } from "@blksails/pi-web-protocol";
import type { Unsubscribe } from "../../src/rpc-channel/pi-rpc-channel.js";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

/** 支持 onRestart 的测试通道(模拟 runner 子进程重生)。 */
class RestartableChannel extends MockChannel {
  private readonly restartCbs = new Set<() => void>();
  onRestart(cb: () => void): Unsubscribe {
    this.restartCbs.add(cb);
    return () => this.restartCbs.delete(cb);
  }
  emitRestart(): void {
    for (const cb of this.restartCbs) cb();
  }
}

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

function stateFrames(frames: SseFrame[]): Extract<SseFrame, { kind: "control" }>[] {
  return frames.filter(
    (f): f is Extract<SseFrame, { kind: "control" }> =>
      f.kind === "control" && f.payload.control === "state",
  );
}

describe("PiSession state control frame — sticky replay", () => {
  it("单个 key 的 set 变更登记为粘性,迟到订阅者回放得到最新值", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: 1, rev: 1 }));
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = stateFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ control: "state", key: "k", value: 1, rev: 1 });
  });

  it("同 key 多次 set 只留最新一帧(last-value,rev 单调)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "a", rev: 1 }));
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "b", rev: 2 }));
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "c", rev: 3 }));
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = stateFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ value: "c", rev: 3 });
  });

  it("多个 key 各自独立登记粘性,互不覆盖", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "a", value: 1, rev: 1 }));
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "b", value: 2, rev: 1 }));
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = stateFrames(frames);
    expect(replayed).toHaveLength(2);
    const byKey = new Map(replayed.map((f) => [(f.payload as { key: string }).key, f.payload]));
    expect(byKey.get("a")).toMatchObject({ value: 1 });
    expect(byKey.get("b")).toMatchObject({ value: 2 });
  });

  it("delete 帧同样登记为粘性(而非从表摘除),重放时携带 deleted:true 供前端删键", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: 1, rev: 1 }));
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", rev: 2, deleted: true }));
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = stateFrames(frames);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.payload).toMatchObject({ key: "k", rev: 2, deleted: true });
  });

  it("runner 重启后 rev 保持单调:新 store 低 rev 帧被抬过历史峰值(客户端不判陈旧丢弃)", () => {
    const ch = new RestartableChannel();
    const s = newSession(ch);
    // 旧 runner:rev 升到 3。
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "a", rev: 1 }));
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "b", rev: 3 }));
    // 热重载:runner 重生 → 新状态桥 store rev 归 1。
    ch.emitRestart();
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k", value: "c", rev: 1 }));

    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const replayed = stateFrames(frames);
    expect(replayed).toHaveLength(1);
    // 重启后重推的值 "c" 生效,且转发 rev > 重启前峰值(3)→ 客户端不会按 rev<=cur 丢弃。
    const payload = replayed[0]?.payload as { value: unknown; rev: number };
    expect(payload.value).toBe("c");
    expect(payload.rev).toBeGreaterThan(3);
  });

  it("畸形 piweb_state 行不广播、不登记粘性", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "piweb_state", key: "k" })); // 缺 rev
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    expect(stateFrames(frames)).toHaveLength(0);
  });
});

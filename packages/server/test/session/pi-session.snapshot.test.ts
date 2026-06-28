/**
 * session-snapshot-authority — PiSession 权威快照广播/回放(Req 1.x, 2.x, 4.1, 8.2)。
 *
 * 开关开启:agent_start/end 广播 session-state(busy true/false);订阅时回放当前快照(粘性)。
 * 开关关闭(默认):不发任何 session-state 帧(legacy 零回归)。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, SessionSnapshot, SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

const start = { type: "agent_start" } as AgentEvent;
const end = { type: "agent_end", messages: [] } as unknown as AgentEvent;
function textDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: {} },
  } as unknown as AgentEvent;
}

function sessionStateSnapshots(frames: SseFrame[]): SessionSnapshot[] {
  return frames
    .filter(
      (f): f is Extract<SseFrame, { kind: "control" }> =>
        f.kind === "control" && f.payload.control === "session-state",
    )
    .map((f) => (f.payload as { snapshot: SessionSnapshot }).snapshot);
}

function newSession(ch: MockChannel, snapshotAuthority: boolean): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs: 0,
    snapshotAuthority,
  });
}

describe("PiSession snapshot authority", () => {
  it("replays a sticky session-state snapshot to a late subscriber", () => {
    const ch = new MockChannel();
    const s = newSession(ch, true);
    ch.emitEvent(start); // 状态先变更(busy=true),再有人订阅
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    const snaps = sessionStateSnapshots(frames);
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps.at(-1)?.busy).toBe(true); // 迟到订阅者收敛到当前 busy=true
  });

  it("broadcasts busy=true on agent_start and busy=false on agent_end", () => {
    const ch = new MockChannel();
    const s = newSession(ch, true);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitEvent(start);
    ch.emitEvent(textDelta("h"));
    ch.emitEvent(end);
    const busySeq = sessionStateSnapshots(frames).map((s) => s.busy);
    // 初始回放(false) → agent_start(true) → agent_end(false);text_delta 不产生新快照帧
    expect(busySeq).toEqual([false, true, false]);
  });

  it("never sets busy true for a command-like flow with no agent_start", () => {
    const ch = new MockChannel();
    const s = newSession(ch, true);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitEvent(textDelta("x"));
    ch.emitEvent(end);
    expect(sessionStateSnapshots(frames).every((s) => s.busy === false)).toBe(true);
    expect(s.snapshot.busy).toBe(false);
  });

  it("emits busy=false session-state BEFORE the finish frame (per-prompt close must not drop it)", () => {
    // 回归锁定:browser e2e 实测 busy 卡 true —— 根因是 busy=false 帧排在 finish 之后,
    // 前端收到 finish 即关流,后续 busy=false 帧被丢。修复:快照广播先于 translate 帧。
    const ch = new MockChannel();
    const s = newSession(ch, true);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitEvent(start);
    ch.emitEvent(end);
    const finishIdx = frames.findIndex(
      (f) => f.kind === "uiMessageChunk" && f.chunk.type === "finish",
    );
    expect(finishIdx).toBeGreaterThanOrEqual(0); // agent_end 翻译出 finish 帧
    const busyFalseAtEndIdx = frames.findIndex(
      (f, i) =>
        i < finishIdx &&
        f.kind === "control" &&
        f.payload.control === "session-state" &&
        (f.payload as { snapshot: SessionSnapshot }).snapshot.busy === false,
    );
    // 存在一个 busy=false 的 session-state 帧排在 finish 之前(轮末回落先于关流)。
    expect(busyFalseAtEndIdx).toBeGreaterThanOrEqual(0);
    expect(busyFalseAtEndIdx).toBeLessThan(finishIdx);
  });

  it("resets busy=false on stop/cleanup mid-turn (crash/stop must not leave busy=true)", async () => {
    // 检阅 MED:崩溃/中途停止不经 agent_end,若不显式复位,权威快照以 busy=true 收尾,
    // 纯投影前端永久显示忙碌。cleanup 须把 busy 复位为 false。
    const ch = new MockChannel();
    const s = newSession(ch, true);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitEvent(start); // busy=true
    await s.stop();
    const seq = sessionStateSnapshots(frames).map((snap) => snap.busy);
    expect(seq).toContain(true); // 轮次曾开始
    expect(seq.at(-1)).toBe(false); // 停止后末态 busy=false(不卡死)
  });

  it("emits NO session-state frames when authority is off (legacy back-compat)", () => {
    const ch = new MockChannel();
    const s = newSession(ch, false);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitEvent(start);
    ch.emitEvent(end);
    expect(sessionStateSnapshots(frames)).toHaveLength(0);
  });
});

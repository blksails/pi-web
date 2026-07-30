/**
 * session-snapshot-authority — reduceSnapshot 纯函数单测(Req 2.1-2.4, 7.1)。
 *
 * 纯函数判定:相同输入恒等输出、无副作用、不读全局时钟(now 注入)。
 * busy 语义:agent_start→true、agent_end→false、其余不变;扩展命令(无 agent_start)busy 恒 false。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, SessionSnapshot } from "@blksails/pi-web-protocol";
import { INITIAL_SNAPSHOT, reduceSnapshot } from "../../src/session/reduce-snapshot.js";

const start: AgentEvent = { type: "agent_start" } as AgentEvent;
const end: AgentEvent = { type: "agent_end", messages: [] } as unknown as AgentEvent;
const abortEnd: AgentEvent = {
  type: "agent_end",
  messages: [{ role: "assistant", stopReason: "aborted" }],
} as unknown as AgentEvent;
const errorEnd: AgentEvent = {
  type: "agent_end",
  messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom" }],
} as unknown as AgentEvent;
const textDelta: AgentEvent = {
  type: "message_update",
  message: { role: "assistant" },
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "h", partial: {} },
} as unknown as AgentEvent;

describe("reduceSnapshot", () => {
  it("agent_start → busy true with turn.startedAt = injected now", () => {
    const next = reduceSnapshot(INITIAL_SNAPSHOT, start, 1234);
    expect(next.busy).toBe(true);
    expect(next.turn).toEqual({ startedAt: 1234 });
  });

  it("agent_end → busy false and clears turn (normal end)", () => {
    const busy = reduceSnapshot(INITIAL_SNAPSHOT, start, 1);
    const next = reduceSnapshot(busy, end, 2);
    expect(next.busy).toBe(false);
    expect(next.turn).toBeUndefined();
  });

  it("agent_end → busy false on abort and error termination", () => {
    const busy = reduceSnapshot(INITIAL_SNAPSHOT, start, 1);
    expect(reduceSnapshot(busy, abortEnd, 2).busy).toBe(false);
    expect(reduceSnapshot(busy, errorEnd, 2).busy).toBe(false);
  });

  it("extension-command-like sequence (no agent_start) keeps busy false forever", () => {
    // 模拟扩展命令:仅有 message_update / agent_end,无 agent_start。busy 恒 false。
    let snap: SessionSnapshot = INITIAL_SNAPSHOT;
    for (const ev of [textDelta, end, textDelta]) {
      snap = reduceSnapshot(snap, ev, 9);
      expect(snap.busy).toBe(false);
    }
  });

  it("unrelated events return the previous reference unchanged (pure, no churn)", () => {
    const busy = reduceSnapshot(INITIAL_SNAPSHOT, start, 1);
    const same = reduceSnapshot(busy, textDelta, 2);
    expect(same).toBe(busy); // 同一引用,无变更
  });

  it("is pure: same (prev, event, now) yields deeply equal output", () => {
    const a = reduceSnapshot(INITIAL_SNAPSHOT, start, 42);
    const b = reduceSnapshot(INITIAL_SNAPSHOT, start, 42);
    expect(a).toEqual(b);
    expect(INITIAL_SNAPSHOT.busy).toBe(false); // 不修改入参
  });
});

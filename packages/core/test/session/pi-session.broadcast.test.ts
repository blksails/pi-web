/**
 * 广播:多订阅者同序一致 + 取消独立 + 回调异常隔离(Req 3.x, 10.2)。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function textDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: { role: "assistant" } as never,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta,
      partial: { role: "assistant" } as never,
    },
  };
}

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

describe("PiSession broadcast", () => {
  it("delivers the same frame sequence to all subscribers in order", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const a: string[] = [];
    const b: string[] = [];
    s.subscribe((f) => a.push(chunkType(f)));
    s.subscribe((f) => b.push(chunkType(f)));
    ch.emitEvent(textDelta("h"));
    ch.emitEvent(textDelta("i"));
    // each text_delta with no prior start auto-opens once → [text-start, text-delta, text-delta]
    expect(a).toEqual(["text-start", "text-delta", "text-delta"]);
    expect(b).toEqual(a);
  });

  it("unsubscribe stops that subscriber without affecting others", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const a: string[] = [];
    const b: string[] = [];
    const handleA = s.subscribe((f) => a.push(chunkType(f)));
    s.subscribe((f) => b.push(chunkType(f)));
    ch.emitEvent(textDelta("h"));
    handleA.unsubscribe();
    ch.emitEvent(textDelta("i"));
    expect(a).toEqual(["text-start", "text-delta"]);
    expect(b).toEqual(["text-start", "text-delta", "text-delta"]);
  });

  it("isolates a throwing subscriber callback (others still receive)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const good: string[] = [];
    s.subscribe(() => {
      throw new Error("boom");
    });
    s.subscribe((f) => good.push(chunkType(f)));
    expect(() => ch.emitEvent(textDelta("h"))).not.toThrow();
    expect(good).toEqual(["text-start", "text-delta"]);
  });
});

function chunkType(f: SseFrame): string {
  return f.kind === "uiMessageChunk" ? f.chunk.type : `control:${f.payload.control}`;
}

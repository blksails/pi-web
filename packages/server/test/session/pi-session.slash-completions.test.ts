/**
 * agent-slash-completion task 2.2:PiSession 接收并按会话缓存 slash_completions 帧。
 * 覆盖 Req 1.2(装配帧缓存、按会话隔离)、Req 4.1(无声明为空 → gating)。
 *
 * 帧识别置于 handleRawLine 的 active-gate 之前(装配期早于就绪);非法帧被忽略。
 */
import { describe, expect, it } from "vitest";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

describe("PiSession slash_completions", () => {
  it("默认无候选(未收帧 → gating 为空)", () => {
    const s = newSession(new MockChannel());
    expect(s.getSlashCompletions()).toEqual([]);
  });

  it("装配期 slash_completions 帧 → 按会话缓存", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(
      JSON.stringify({
        type: "slash_completions",
        items: [{ name: "img-gen", insertText: "/img-gen " }, { name: "img-edit" }],
      }),
    );
    expect(s.getSlashCompletions()).toEqual([
      { name: "img-gen", insertText: "/img-gen " },
      { name: "img-edit" },
    ]);
  });

  it("非法 slash_completions 帧被忽略,缓存不变", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(
      JSON.stringify({ type: "slash_completions", items: [{ bad: true }] }),
    );
    expect(s.getSlashCompletions()).toEqual([]);
  });

  it("后到帧覆盖前值", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(JSON.stringify({ type: "slash_completions", items: [{ name: "a" }] }));
    ch.emitLine(JSON.stringify({ type: "slash_completions", items: [{ name: "b" }] }));
    expect(s.getSlashCompletions()).toEqual([{ name: "b" }]);
  });
});

/**
 * 单元:PiSession 命令-turn watcher(R11 扩展命令消息流一致性)。
 *
 * 斜杠命令 prompt 后,窗口内无 agent_start(纯命令)→ 合成 finish 帧让前端 per-prompt 流收尾;
 * 有 agent_start(真 turn)→ 不合成(由真 finish 收尾);普通(非斜杠)消息不武装 watcher。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent, SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

function isFinishChunk(f: SseFrame): boolean {
  return (
    f.kind === "uiMessageChunk" &&
    (f as { chunk?: { type?: string } }).chunk?.type === "finish"
  );
}

const agentStart = { type: "agent_start" } as unknown as AgentEvent;

describe("PiSession 命令-turn watcher (R11)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("斜杠命令窗口内无 agent_start → 窗口后合成 finish 帧收尾", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));

    void s.prompt("/review");
    expect(frames.some(isFinishChunk)).toBe(false); // 窗口未到,尚未合成

    vi.advanceTimersByTime(1500);
    expect(frames.some(isFinishChunk)).toBe(true); // 合成 finish 收尾
  });

  it("窗口内收到 agent_start(真 turn)→ 取消 watcher,不合成 finish", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));

    void s.prompt("/review");
    ch.emitEvent(agentStart); // 真 turn 开始 → 取消 watcher
    const finishBefore = frames.filter(isFinishChunk).length;

    vi.advanceTimersByTime(1500);
    // watcher 已取消:窗口后不再额外合成 finish(真 finish 由 agent_end 产出,此处不触发)。
    expect(frames.filter(isFinishChunk).length).toBe(finishBefore);
  });

  it("普通(非斜杠)消息不武装 watcher → 不合成 finish", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));

    void s.prompt("hello world");
    vi.advanceTimersByTime(1500);
    expect(frames.some(isFinishChunk)).toBe(false);
  });
});

/**
 * PiSession — 致命 provider 错误 fail-fast + abort 联动。
 *
 * 场景:pi SDK 的重试分类器把 OpenRouter 402(余额不足)误判为可重试 502(错误消息里 `afford 5021`
 * 的 502 子串命中),发 `auto_retry_start` 想重试。PiSession 须在该入口立即以 error+finish 收尾 UI,
 * 并 abort 中止 agent 的后台重试循环;真正的 5xx/429 transient 不受影响(照常重试、不 abort)。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

const FATAL_402 =
  '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 228422 tokens, but can only afford 5021. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402}';

function fatalRetry(errorMessage: string): AgentEvent {
  return { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 8000, errorMessage };
}

function setup(): { channel: MockChannel; session: PiSession; frames: SseFrame[] } {
  const channel = new MockChannel();
  const session = new PiSession({ id: "fatal-ff", resolved: makeResolved(), channel, idleMs: 0 });
  const frames: SseFrame[] = [];
  session.subscribe((f) => frames.push(f));
  return { channel, session, frames };
}

function chunkTypes(frames: SseFrame[]): string[] {
  return frames.flatMap((f) => (f.kind === "uiMessageChunk" ? [f.chunk.type] : []));
}

function abortCalls(channel: MockChannel): number {
  return channel.calls.filter((c) => c.method === "abort").length;
}

describe("PiSession — 致命 provider 错误 fail-fast", () => {
  it("致命 auto_retry_start → 广播 error+finish 且 abort agent(仅一次)", async () => {
    const { channel, session, frames } = setup();
    channel.emitEvent({ type: "agent_start" });
    channel.emitEvent(fatalRetry(FATAL_402));
    await Promise.resolve();

    const types = chunkTypes(frames);
    expect(types).toContain("error");
    expect(types).toContain("finish");
    expect(abortCalls(channel)).toBe(1);

    // 幂等:同轮后续事件被抑制,不重复 abort、不再产终止帧。
    const before = frames.length;
    channel.emitEvent({ type: "agent_end", messages: [], willRetry: false });
    await Promise.resolve();
    expect(abortCalls(channel)).toBe(1);
    expect(frames.length).toBe(before);

    await session.stop("shutdown");
  });

  it("非致命 transient auto_retry_start → data-pi-auto-retry,不 abort", async () => {
    const { channel, session, frames } = setup();
    channel.emitEvent({ type: "agent_start" });
    channel.emitEvent(fatalRetry("503 Service Unavailable"));
    await Promise.resolve();

    expect(chunkTypes(frames)).toContain("data-pi-auto-retry");
    expect(abortCalls(channel)).toBe(0);

    await session.stop("shutdown");
  });
});

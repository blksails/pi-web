/**
 * 命令转发 + 状态缓存刷新 + 已停止拒绝(Req 2.x, 6.x, 10.2)。
 */
import { describe, expect, it } from "vitest";
import type { RpcResponse } from "@pi-web/protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { SessionStoppedError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

describe("PiSession command forwarding", () => {
  it("forwards prompt to the channel and returns its result unchanged", async () => {
    const ch = new MockChannel();
    const res: RpcResponse = {
      type: "response",
      id: "1",
      command: "prompt",
      success: true,
    };
    ch.responseFor = () => res;
    const s = newSession(ch);
    const out = await s.prompt("hello", { streamingBehavior: "steer" });
    expect(out).toBe(res);
    expect(ch.calls[0]).toMatchObject({ method: "prompt" });
    expect(ch.calls[0]?.args[0]).toBe("hello");
  });

  it("forwards the full aligned command set", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.steer("a");
    await s.followUp("b");
    await s.abort();
    await s.setModel("anthropic", "m");
    await s.cycleModel();
    await s.getAvailableModels();
    await s.setThinkingLevel("high");
    await s.getMessages();
    await s.getCommands();
    await s.fork("entry-1");
    await s.getForkMessages();
    const methods = ch.calls.map((c) => c.method);
    expect(methods).toEqual([
      "steer",
      "follow_up",
      "abort",
      "set_model",
      "cycle_model",
      "get_available_models",
      "set_thinking_level",
      "get_messages",
      "get_commands",
      "fork",
      "get_fork_messages",
    ]);
  });

  it("forwards fork(entryId) to the channel with its entryId and returns the result unchanged", async () => {
    const ch = new MockChannel();
    const res: RpcResponse = {
      type: "response",
      id: "1",
      command: "fork",
      success: true,
      data: { text: "branched", cancelled: false },
    } as RpcResponse;
    ch.responseFor = () => res;
    const s = newSession(ch);
    const out = await s.fork("entry-42");
    expect(out).toBe(res);
    expect(ch.calls[0]).toMatchObject({ method: "fork" });
    expect(ch.calls[0]?.args[0]).toBe("entry-42");
  });

  it("forwards getForkMessages() to the channel and returns the result unchanged", async () => {
    const ch = new MockChannel();
    const res: RpcResponse = {
      type: "response",
      id: "1",
      command: "get_fork_messages",
      success: true,
      data: { messages: [{ entryId: "e1", text: "t1" }] },
    } as RpcResponse;
    ch.responseFor = () => res;
    const s = newSession(ch);
    const out = await s.getForkMessages();
    expect(out).toBe(res);
    expect(ch.calls[0]).toMatchObject({ method: "get_fork_messages" });
  });

  it("rejects fork / getForkMessages on a stopped session (Req 2.4)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop();
    await expect(s.fork("e")).rejects.toBeInstanceOf(SessionStoppedError);
    await expect(s.getForkMessages()).rejects.toBeInstanceOf(SessionStoppedError);
    expect(ch.calls).toHaveLength(0);
  });

  it("refreshes cache from get_state / get_session_stats responses", async () => {
    const ch = new MockChannel();
    ch.responseFor = (method) => {
      if (method === "get_state") {
        return {
          type: "response",
          id: "1",
          command: "get_state",
          success: true,
          data: {
            thinkingLevel: "high",
            isStreaming: false,
            isCompacting: false,
            steeringMode: "all",
            followUpMode: "all",
            sessionId: "x",
            autoCompactionEnabled: true,
            messageCount: 1,
            pendingMessageCount: 0,
          },
        } as RpcResponse;
      }
      if (method === "get_session_stats") {
        return {
          type: "response",
          id: "1",
          command: "get_session_stats",
          success: true,
          data: {
            sessionId: "x",
            userMessages: 1,
            assistantMessages: 1,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 2,
            tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
            cost: 0.01,
          },
        } as RpcResponse;
      }
      return { type: "response", id: "1", command: method, success: true } as RpcResponse;
    };
    const s = newSession(ch);
    expect(s.getCachedState()).toBeUndefined(); // no observation yet (Req 6.3)
    await s.getState();
    expect(s.getCachedState()?.state).toMatchObject({ thinkingLevel: "high" });
    await s.getSessionStats();
    expect(s.getCachedState()?.stats).toMatchObject({ cost: 0.01 });
  });

  it("getCachedState does not send a command", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    s.getCachedState();
    expect(ch.calls).toHaveLength(0);
  });

  it("rejects commands on a stopped session with SessionStoppedError (Req 2.4)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop();
    await expect(s.prompt("hi")).rejects.toBeInstanceOf(SessionStoppedError);
    // no command reached the (closed) channel
    expect(ch.calls).toHaveLength(0);
  });
});

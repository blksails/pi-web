/**
 * message-queue-ui「取回」:PiSession.clearQueue 请求/响应关联(reqId 配对 / 超时 / 迟到丢弃 / 收尾拒绝)。
 */
import { describe, expect, it } from "vitest";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

/** 取出最近一条 piweb_clear_queue 请求行的关联 id。 */
function lastClearQueueId(ch: MockChannel): string {
  const line = [...ch.sent].reverse().find((l) => l.includes("piweb_clear_queue"));
  expect(line).toBeDefined();
  return (JSON.parse(line as string) as { id: string }).id;
}

describe("PiSession.clearQueue", () => {
  it("下发请求行并按 id 配对结果行 resolve 被清文本", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.clearQueue();
    const id = lastClearQueueId(ch);
    expect(JSON.parse(ch.sent[0] as string)).toMatchObject({
      type: "piweb_clear_queue",
    });
    ch.emitLine(
      JSON.stringify({
        type: "piweb_clear_queue_result",
        id,
        steering: ["a", "b"],
        followUp: ["c"],
      }),
    );
    await expect(p).resolves.toEqual({ steering: ["a", "b"], followUp: ["c"] });
  });

  it("无结果行时按超时 reject", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await expect(s.clearQueue(20)).rejects.toThrow(/timed out/);
  });

  it("忽略未知 id 的结果行(迟到/超时后安全丢弃)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.clearQueue();
    const id = lastClearQueueId(ch);
    // 先投递一条未知 id → 不应 resolve 也不抛
    ch.emitLine(
      JSON.stringify({
        type: "piweb_clear_queue_result",
        id: "other",
        steering: ["x"],
        followUp: [],
      }),
    );
    // 正确 id 才 resolve
    ch.emitLine(
      JSON.stringify({
        type: "piweb_clear_queue_result",
        id,
        steering: [],
        followUp: [],
      }),
    );
    await expect(p).resolves.toEqual({ steering: [], followUp: [] });
  });

  it("会话已停时 reject(不下发请求)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop("idle");
    await expect(s.clearQueue()).rejects.toBeInstanceOf(Error);
  });
});

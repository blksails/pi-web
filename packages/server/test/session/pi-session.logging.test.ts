/**
 * PiSession 日志管道集成测试（任务 3.1）。
 *
 * 覆盖：
 *  - stderr sentinel 行 → ring buffer（带 id）→ control:"logs" 帧
 *  - getLogs() 委托 ring buffer（含过滤）
 *  - 非 sentinel 行忽略（不产帧）
 *  - 既有帧回归：logs 帧与 event 帧互不干扰
 */
import { describe, it, expect } from "vitest";
import { LOG_SENTINEL } from "@pi-web/logger";
import type { SseFrame, LogEntry } from "@pi-web/protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function makeLogLine(entry: Omit<LogEntry, "id">): string {
  return LOG_SENTINEL + JSON.stringify(entry);
}

function makeSession(): { session: PiSession; channel: MockChannel } {
  const channel = new MockChannel();
  const session = new PiSession({
    id: "log-test",
    resolved: makeResolved(),
    channel,
    idleMs: 0,
  });
  return { session, channel };
}

describe("PiSession logging pipeline", () => {
  it("sentinel stderr line produces a control:logs frame with an id-bearing entry", () => {
    const { session, channel } = makeSession();
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    const entry = { level: "info" as const, ns: "agent:test", msg: "hello", ts: 1000 };
    channel.emitStderr(makeLogLine(entry) + "\n");

    const logsFrames = frames.filter(
      (f) => f.kind === "control" && (f as { payload?: { control?: string } }).payload?.control === "logs",
    );
    expect(logsFrames.length).toBeGreaterThanOrEqual(1);

    const payload = (logsFrames[0] as { payload: { entries: LogEntry[] } }).payload;
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.id).toBeDefined();
    expect(payload.entries[0]!.msg).toBe("hello");
    expect(payload.entries[0]!.ns).toBe("agent:test");
  });

  it("non-sentinel stderr line does not produce a logs frame", () => {
    const { session, channel } = makeSession();
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.emitStderr("plain stdout noise\n");
    channel.emitStderr("{\"type\":\"event\"}\n");

    const logsFrames = frames.filter(
      (f) => f.kind === "control" && (f as { payload?: { control?: string } }).payload?.control === "logs",
    );
    expect(logsFrames).toHaveLength(0);
  });

  it("getLogs returns ring buffer entries", () => {
    const { session, channel } = makeSession();

    channel.emitStderr(makeLogLine({ level: "info", ns: "a", msg: "m1", ts: 100 }) + "\n");
    channel.emitStderr(makeLogLine({ level: "warn", ns: "b", msg: "m2", ts: 200 }) + "\n");

    const all = session.getLogs({});
    expect(all).toHaveLength(2);
    expect(all[0]!.msg).toBe("m1");
    expect(all[1]!.msg).toBe("m2");
    // All entries must have string ids.
    for (const e of all) {
      expect(typeof e.id).toBe("string");
    }
  });

  it("getLogs respects level filter", () => {
    const { session, channel } = makeSession();

    channel.emitStderr(makeLogLine({ level: "debug", ns: "x", msg: "d", ts: 1 }) + "\n");
    channel.emitStderr(makeLogLine({ level: "warn", ns: "x", msg: "w", ts: 2 }) + "\n");

    const warnOnly = session.getLogs({ level: "warn" });
    expect(warnOnly).toHaveLength(1);
    expect(warnOnly[0]!.level).toBe("warn");
  });

  it("getLogs respects limit filter (most recent N)", () => {
    const { session, channel } = makeSession();
    for (let i = 1; i <= 5; i++) {
      channel.emitStderr(makeLogLine({ level: "info", ns: "x", msg: `m${i}`, ts: i }) + "\n");
    }
    const limited = session.getLogs({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[limited.length - 1]!.msg).toBe("m5");
  });

  it("logs frames do not interfere with event-driven frames (regression 9.1)", () => {
    const { session, channel } = makeSession();
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Emit a text delta event.
    channel.emitEvent({
      type: "message_update",
      message: { role: "assistant" } as never,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "hi",
        partial: { role: "assistant" } as never,
      },
    });

    // Emit a log.
    channel.emitStderr(makeLogLine({ level: "info", ns: "t", msg: "test", ts: 1 }) + "\n");

    // Text delta frames should still be present.
    const textFrames = frames.filter((f) => f.kind === "uiMessageChunk");
    expect(textFrames.length).toBeGreaterThanOrEqual(1);

    // Logs frame should also be present and be separate.
    const logsFrames = frames.filter(
      (f) => f.kind === "control" && (f as { payload?: { control?: string } }).payload?.control === "logs",
    );
    expect(logsFrames.length).toBeGreaterThanOrEqual(1);
  });
});

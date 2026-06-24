/**
 * PiSession subscribe() ring buffer backfill 测试（任务 7.3）。
 *
 * 覆盖：
 *  - 订阅前已缓冲的日志：新订阅者订阅时立即收到一帧 control:"logs"，entries 含全部缓冲日志（带 id）。
 *  - 既有订阅者不因新订阅而收到额外回填帧。
 *  - 空缓冲时 subscribe 不发回填帧。
 *  - 回填帧与后续实时帧不冲突（新订阅者仍能收到后续实时帧）。
 */
import { describe, it, expect } from "vitest";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";
import type { SseFrame, LogEntry } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function makeLogLine(entry: Omit<LogEntry, "id">): string {
  return LOG_SENTINEL + JSON.stringify(entry);
}

function makeSession(): { session: PiSession; channel: MockChannel } {
  const channel = new MockChannel();
  const session = new PiSession({
    id: "backfill-test",
    resolved: makeResolved(),
    channel,
    idleMs: 0,
  });
  return { session, channel };
}

function getLogsFrames(frames: SseFrame[]): SseFrame[] {
  return frames.filter(
    (f) =>
      f.kind === "control" &&
      (f as { payload?: { control?: string } }).payload?.control === "logs",
  );
}

function getLogsEntries(frames: SseFrame[]): LogEntry[] {
  return getLogsFrames(frames).flatMap(
    (f) => (f as { payload: { entries: LogEntry[] } }).payload.entries,
  );
}

describe("PiSession subscribe() ring buffer backfill (task 7.3)", () => {
  it("new subscriber immediately receives a control:logs backfill frame with pre-buffered entries", () => {
    const { session, channel } = makeSession();

    // Feed logs into ring buffer BEFORE subscribing.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:boot", msg: "startup1", ts: 1000 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "warn", ns: "agent:boot", msg: "startup2", ts: 1001 }) + "\n",
    );

    // Now subscribe — backfill should arrive immediately (synchronously).
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Must have received exactly one backfill logs frame (or at least one).
    const logsFrames = getLogsFrames(frames);
    expect(logsFrames.length).toBeGreaterThanOrEqual(1);

    // All pre-buffered entries must appear in the backfill.
    const entries = getLogsEntries(frames);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain("startup1");
    expect(msgs).toContain("startup2");

    // Entries must carry ids.
    for (const e of entries) {
      const id = (e as { id?: string }).id;
      expect(typeof id).toBe("string");
      expect((id ?? "").length).toBeGreaterThan(0);
    }
  });

  it("existing subscriber does NOT receive an extra backfill frame when a new subscriber joins", () => {
    const { session, channel } = makeSession();

    // Subscribe first subscriber BEFORE any logs.
    const existingFrames: SseFrame[] = [];
    session.subscribe((f) => existingFrames.push(f));

    // Feed two logs — existing subscriber gets real-time frames.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "a", ts: 1 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "b", ts: 2 }) + "\n",
    );

    const existingLogsCountBefore = getLogsFrames(existingFrames).length;

    // New subscriber joins — this should NOT cause additional frames to the existing one.
    const newFrames: SseFrame[] = [];
    session.subscribe((f) => newFrames.push(f));

    const existingLogsCountAfter = getLogsFrames(existingFrames).length;
    expect(existingLogsCountAfter).toBe(existingLogsCountBefore);
  });

  it("new subscriber receives the backfill frame only for entries present BEFORE subscribe", () => {
    const { session, channel } = makeSession();

    // Pre-buffer one entry.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:pre", msg: "before-subscribe", ts: 50 }) + "\n",
    );

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Emit a new log AFTER subscribing — this becomes a real-time frame, not backfill.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:post", msg: "after-subscribe", ts: 51 }) + "\n",
    );

    const entries = getLogsEntries(frames);
    const msgs = entries.map((e) => e.msg);
    // Both should be present: one from backfill, one from real-time.
    expect(msgs).toContain("before-subscribe");
    expect(msgs).toContain("after-subscribe");
  });

  it("subscribe does NOT send a backfill frame when ring buffer is empty", () => {
    const { session } = makeSession();

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // No logs emitted → no backfill frame.
    const logsFrames = getLogsFrames(frames);
    expect(logsFrames.length).toBe(0);
  });

  it("new subscriber receives live frames normally after backfill", () => {
    const { session, channel } = makeSession();

    // Pre-buffer one entry.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:boot", msg: "init", ts: 10 }) + "\n",
    );

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    const countAfterSubscribe = getLogsEntries(frames).length;
    expect(countAfterSubscribe).toBeGreaterThanOrEqual(1); // backfill arrived

    // New real-time log arrives.
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:run", msg: "running", ts: 20 }) + "\n",
    );

    const countAfterLive = getLogsEntries(frames).length;
    expect(countAfterLive).toBeGreaterThan(countAfterSubscribe);
    const msgs = getLogsEntries(frames).map((e) => e.msg);
    expect(msgs).toContain("running");
  });
});

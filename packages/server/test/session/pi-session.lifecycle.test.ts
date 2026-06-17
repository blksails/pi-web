/**
 * 生命周期:idle 回收 + 崩溃清理 + stop 幂等 + onClosed 触发一次(Req 7.x, 5.4, 10.3)。
 * 使用假计时器 + mock channel + spy onClosed。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEndReason, SessionId } from "../../src/session/session.types.js";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

interface ClosedRec {
  id: SessionId;
  reason: SessionEndReason;
}

function newSession(
  ch: MockChannel,
  idleMs: number,
  closed: ClosedRec[],
): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs,
    onClosed: (id, reason) => closed.push({ id, reason }),
  });
}

describe("PiSession lifecycle", () => {
  it("idle timeout stops the session and fires onClosed once with 'idle'", async () => {
    const ch = new MockChannel();
    const closed: ClosedRec[] = [];
    const s = newSession(ch, 1000, closed);
    const ends: SessionEndReason[] = [];
    s.subscribe(
      () => undefined,
      (r) => ends.push(r),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.status).toBe("stopped");
    expect(closed).toEqual([{ id: "s1", reason: "idle" }]);
    expect(ends).toEqual(["idle"]);
    expect(ch.closed).toBe(true);
  });

  it("activity resets the idle timer (not reaped early)", async () => {
    const ch = new MockChannel();
    const closed: ClosedRec[] = [];
    const s = newSession(ch, 1000, closed);
    await vi.advanceTimersByTimeAsync(800);
    // activity: a command resets idle
    await s.abort();
    await vi.advanceTimersByTimeAsync(800);
    expect(s.status).toBe("active");
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(s.status).toBe("stopped");
    expect(closed).toEqual([{ id: "s1", reason: "idle" }]);
  });

  it("crash (non-zero exit) cleans up, broadcasts error frame + end, onClosed('crashed')", async () => {
    const ch = new MockChannel();
    const closed: ClosedRec[] = [];
    const s = newSession(ch, 0, closed);
    const frames: string[] = [];
    const ends: SessionEndReason[] = [];
    s.subscribe(
      (f) => frames.push(f.kind === "control" ? `control:${f.payload.control}` : f.chunk.type),
      (r) => ends.push(r),
    );
    ch.emitExit({ code: 1, signal: null });
    await vi.runAllTimersAsync();
    expect(frames).toContain("control:error");
    expect(ends).toEqual(["crashed"]);
    expect(closed).toEqual([{ id: "s1", reason: "crashed" }]);
    expect(s.status).toBe("stopped");
    expect(s.listPendingExtensionUI()).toEqual([]);
    expect(s.getCachedState()).toBeUndefined();
  });

  it("clean exit (code 0) ends with 'stopped' reason, no error frame", async () => {
    const ch = new MockChannel();
    const closed: ClosedRec[] = [];
    const s = newSession(ch, 0, closed);
    const frames: string[] = [];
    s.subscribe((f) =>
      frames.push(f.kind === "control" ? `control:${f.payload.control}` : f.chunk.type),
    );
    ch.emitExit({ code: 0, signal: null });
    await vi.runAllTimersAsync();
    expect(frames).not.toContain("control:error");
    expect(closed).toEqual([{ id: "s1", reason: "stopped" }]);
  });

  it("stop() is idempotent: onClosed fires exactly once", async () => {
    const ch = new MockChannel();
    const closed: ClosedRec[] = [];
    const s = newSession(ch, 0, closed);
    await s.stop();
    await s.stop();
    await s.stop("shutdown");
    expect(closed).toEqual([{ id: "s1", reason: "stopped" }]);
    expect(s.status).toBe("stopped");
  });

  it("rejects subscribe after stop (Req 7.6)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch, 0, []);
    await s.stop();
    expect(() => s.subscribe(() => undefined)).toThrow();
  });
});

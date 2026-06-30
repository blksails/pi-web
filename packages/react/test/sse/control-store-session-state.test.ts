/**
 * session-snapshot-authority — ControlStore 吸收 session-state(Req 3.2, 5.1)。
 *
 * project 纯投影:apply session-state → busy/session/stats 同步;无关帧不改引用。
 */
import { describe, it, expect } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type { ControlPayload, SessionSnapshot } from "@blksails/pi-web-protocol";

function sessionState(snapshot: SessionSnapshot): ControlPayload {
  return { control: "session-state", snapshot };
}

describe("ControlStore — session-state authority", () => {
  it("absorbs the snapshot into busy/session and projects authoritatively", () => {
    const store = new ControlStore();
    expect(store.getSnapshot().busy).toBe(false); // 失败安全初值
    expect(store.getSnapshot().session).toBeUndefined();

    store.applyControlFrame(
      sessionState({ lifecycle: "ready", busy: true, turn: { startedAt: 5 } }),
    );
    const s = store.getSnapshot();
    expect(s.busy).toBe(true);
    expect(s.session).toEqual({ lifecycle: "ready", busy: true, turn: { startedAt: 5 } });
  });

  it("syncs stats from the snapshot as the single source", () => {
    const store = new ControlStore();
    const stats = { tokens: 12, cost: 0.01 } as unknown as Record<string, unknown>;
    store.applyControlFrame(
      sessionState({ lifecycle: "ready", busy: false, stats }),
    );
    expect(store.getSnapshot().stats).toEqual(stats);
  });

  it("does not clobber existing stats when a later snapshot omits stats", () => {
    const store = new ControlStore();
    const stats = { tokens: 7 } as unknown as Record<string, unknown>;
    store.applyControlFrame(sessionState({ lifecycle: "ready", busy: true, stats }));
    store.applyControlFrame(sessionState({ lifecycle: "ready", busy: false })); // 无 stats
    expect(store.getSnapshot().stats).toEqual(stats); // 保留上次
    expect(store.getSnapshot().busy).toBe(false);
  });

  it("falls back to busy=false and undefined session before any session-state frame", () => {
    const store = new ControlStore();
    // 一个无关帧不应引入 busy/session
    store.applyControlFrame({ control: "queue", steering: [], followUp: [] });
    expect(store.getSnapshot().busy).toBe(false);
    expect(store.getSnapshot().session).toBeUndefined();
  });
});

/**
 * session-snapshot-authority — StickyFrameRegistry 单测(Req 4.1-4.4)。
 *
 * last-value 语义:set 覆盖、replayInto 按插入序重放、多键并存、同键仅留最新。
 */
import { describe, expect, it } from "vitest";
import { makeControlFrame, type SseFrame } from "@blksails/pi-web-protocol";
import { StickyFrameRegistry } from "../../src/session/sticky-registry.js";

function lifecycleFrame(state: "initializing" | "ready"): SseFrame {
  return makeControlFrame({ control: "session-status", state });
}
function snapshotFrame(busy: boolean): SseFrame {
  return makeControlFrame({
    control: "session-state",
    snapshot: { lifecycle: "ready", busy },
  });
}

describe("StickyFrameRegistry", () => {
  it("stores and returns the last value per key", () => {
    const r = new StickyFrameRegistry();
    const f = lifecycleFrame("ready");
    r.set("session-status", f);
    expect(r.get("session-status")).toBe(f);
    expect(r.get("absent")).toBeUndefined();
  });

  it("keeps only the latest frame when the same key is written repeatedly", () => {
    const r = new StickyFrameRegistry();
    r.set("session-state", snapshotFrame(true));
    const latest = snapshotFrame(false);
    r.set("session-state", latest);
    expect(r.get("session-state")).toBe(latest);
    const replayed: SseFrame[] = [];
    r.replayInto((f) => replayed.push(f));
    expect(replayed).toEqual([latest]); // 仅最新,不重复
  });

  it("replays all keys in insertion order", () => {
    const r = new StickyFrameRegistry();
    const a = lifecycleFrame("ready");
    const b = snapshotFrame(true);
    r.set("session-status", a);
    r.set("session-state", b);
    const replayed: SseFrame[] = [];
    r.replayInto((f) => replayed.push(f));
    expect(replayed).toEqual([a, b]);
    expect(r.keys()).toEqual(["session-status", "session-state"]);
  });

  it("replays nothing when empty (legacy: no sticky state registered)", () => {
    const r = new StickyFrameRegistry();
    const replayed: SseFrame[] = [];
    r.replayInto((f) => replayed.push(f));
    expect(replayed).toEqual([]);
  });
});

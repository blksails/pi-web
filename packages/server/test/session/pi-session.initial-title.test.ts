/**
 * 冷恢复标题回填(方案A):PiSession 构造期 `initialTitle` seed 一帧粘性 `setTitle` extension-ui 帧,
 * 使**构造后**才附着的订阅者也能回放到标题(补冷恢复无 agent 侧 setTitle 帧的缺口)。
 * 不传 initialTitle 时零帧、零回归;setTitle 是推送类,不入 pendingExtensionUI。
 */
import { describe, expect, it } from "vitest";
import type { SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function setTitleFrames(frames: SseFrame[]): { title?: string; count: number } {
  let title: string | undefined;
  let count = 0;
  for (const f of frames) {
    if (f.kind !== "control" || f.payload.control !== "extension-ui") continue;
    const req = (f.payload as { request?: { method?: string; title?: string } }).request;
    if (req?.method === "setTitle") {
      count += 1;
      title = req.title;
    }
  }
  return { title, count };
}

describe("PiSession initialTitle (cold-resume title backfill)", () => {
  it("replays a sticky setTitle frame to a late subscriber", () => {
    const ch = new MockChannel();
    const s = new PiSession({
      id: "s1",
      resolved: makeResolved(),
      channel: ch,
      idleMs: 0,
      initialTitle: "恢复后的会话标题",
    });

    // 订阅在构造之后才附着(模拟冷恢复后前端连上):仍应回放到 setTitle 帧。
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));

    const { title, count } = setTitleFrames(frames);
    expect(count).toBe(1);
    expect(title).toBe("恢复后的会话标题");
    // 推送类 setTitle 不进挂起表(无需回包)。
    expect(s.listPendingExtensionUI()).toEqual([]);
  });

  it("emits no setTitle frame when initialTitle is absent (zero regression)", () => {
    const ch = new MockChannel();
    const s = new PiSession({ id: "s2", resolved: makeResolved(), channel: ch, idleMs: 0 });
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    expect(setTitleFrames(frames).count).toBe(0);
  });

  it("ignores an empty initialTitle", () => {
    const ch = new MockChannel();
    const s = new PiSession({
      id: "s3",
      resolved: makeResolved(),
      channel: ch,
      idleMs: 0,
      initialTitle: "",
    });
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    expect(setTitleFrames(frames).count).toBe(0);
  });
});

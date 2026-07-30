/**
 * Extension UI:挂起登记 + 广播 control 帧 + 回复往返 + 未知 ID 拒绝 + 停止清空(Req 5.x, 10.2)。
 */
import { describe, expect, it } from "vitest";
import type { RpcExtensionUIRequest, SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { UnknownExtensionUIError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

const REQ: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "u1",
  method: "confirm",
  title: "Proceed?",
  message: "Run command?",
};

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

describe("PiSession extension UI", () => {
  it("registers pending and broadcasts a control:extension-ui frame", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitExtensionUIRequest(REQ);
    expect(s.listPendingExtensionUI()).toEqual(["u1"]);
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f?.kind).toBe("control");
    if (f?.kind === "control") {
      expect(f.payload.control).toBe("extension-ui");
    }
  });

  it("respondExtensionUI writes back via channel and removes from pending", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitExtensionUIRequest(REQ);
    s.respondExtensionUI("u1", {
      type: "extension_ui_response",
      id: "u1",
      confirmed: true,
    });
    expect(ch.responded).toHaveLength(1);
    expect(ch.responded[0]).toMatchObject({ id: "u1" });
    expect(s.listPendingExtensionUI()).toEqual([]);
  });

  it("rejects unknown / already-responded id with UnknownExtensionUIError", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitExtensionUIRequest(REQ);
    s.respondExtensionUI("u1", {
      type: "extension_ui_response",
      id: "u1",
      confirmed: true,
    });
    expect(() =>
      s.respondExtensionUI("u1", {
        type: "extension_ui_response",
        id: "u1",
        confirmed: false,
      }),
    ).toThrow(UnknownExtensionUIError);
    expect(() =>
      s.respondExtensionUI("nope", {
        type: "extension_ui_response",
        id: "nope",
        cancelled: true,
      }),
    ).toThrow(UnknownExtensionUIError);
    // only the first valid response reached the channel
    expect(ch.responded).toHaveLength(1);
  });

  it("clears pending table on stop (Req 5.4)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitExtensionUIRequest(REQ);
    await s.stop();
    expect(s.listPendingExtensionUI()).toEqual([]);
  });
});

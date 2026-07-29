/**
 * Tier3 UI↔agent RPC 上行/下行(Req 4.1)。
 * uiRpc 发原始 `ui_rpc` 行;agent 的 `ui_rpc_response` 行被翻译为 control:ui-rpc 帧广播。
 */
import { describe, expect, it } from "vitest";
import type { SseFrame } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { SessionStoppedError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel): PiSession {
  return new PiSession({ id: "s1", resolved: makeResolved(), channel: ch, idleMs: 0 });
}

describe("PiSession ui-rpc", () => {
  it("uiRpc 发送 ui_rpc 原始行(含 request)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    s.uiRpc({
      correlationId: "c1",
      point: "slash",
      action: "list",
      payload: { prefix: "/" },
      protocolVersion: "0.1.0",
    });
    expect(ch.sent).toHaveLength(1);
    const sent = JSON.parse(ch.sent[0] as string);
    expect(sent.type).toBe("ui_rpc");
    expect(sent.request.correlationId).toBe("c1");
  });

  it("agent 的 ui_rpc_response 行 → control:ui-rpc 帧广播", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitLine(
      JSON.stringify({
        type: "ui_rpc_response",
        response: { correlationId: "c1", ok: true, result: ["a", "b"] },
      }),
    );
    const ctrl = frames.find(
      (f) => f.kind === "control" && f.payload.control === "ui-rpc",
    );
    expect(ctrl).toBeDefined();
    if (ctrl && ctrl.kind === "control" && ctrl.payload.control === "ui-rpc") {
      expect(ctrl.payload.response.correlationId).toBe("c1");
      expect(ctrl.payload.response.result).toEqual(["a", "b"]);
    }
  });

  it("非法 ui_rpc_response 行被丢弃(不广播)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const frames: SseFrame[] = [];
    s.subscribe((f) => frames.push(f));
    ch.emitLine(JSON.stringify({ type: "ui_rpc_response", response: { bad: true } }));
    ch.emitLine("not json at all");
    expect(frames).toHaveLength(0);
  });

  it("已停止会话 uiRpc 抛 SessionStoppedError", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop("shutdown");
    expect(() => s.uiRpc({
      correlationId: "c1",
      point: "slash",
      action: "list",
      payload: {},
      protocolVersion: "0.1.0",
    })).toThrow(SessionStoppedError);
  });
});

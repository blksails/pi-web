/**
 * sse-encoder 单测:两类帧→event-stream 文本、id: 行单调、心跳注释帧、protocolVersion
 * (Req 5.2,5.4,6.1,7.1,10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  makeControlFrame,
  makeUiMessageChunkFrame,
  protocolVersion,
} from "@blksails/pi-web-protocol";
import {
  encodeFrame,
  encodeHeartbeat,
} from "../../src/http/sse-encoder.js";

describe("encodeFrame", () => {
  it("encodes a uiMessageChunk frame with event/id/data lines", () => {
    const frame = makeUiMessageChunkFrame({ type: "text-delta", id: "t1", delta: "hi" });
    const text = encodeFrame(frame, 0);
    expect(text).toContain("event: uiMessageChunk\n");
    expect(text).toContain("id: 0\n");
    expect(text).toContain("data: ");
    expect(text.endsWith("\n\n")).toBe(true);
    const dataLine = text
      .split("\n")
      .find((l) => l.startsWith("data: "));
    const parsed = JSON.parse(dataLine!.slice("data: ".length));
    expect(parsed.protocolVersion).toBe(protocolVersion);
    expect(parsed.kind).toBe("uiMessageChunk");
  });

  it("encodes a control frame", () => {
    const frame = makeControlFrame({ control: "error", message: "boom" });
    const text = encodeFrame(frame, 5);
    expect(text).toContain("event: control\n");
    expect(text).toContain("id: 5\n");
  });

  it("assigns monotonic ids across frames", () => {
    const a = encodeFrame(makeControlFrame({ control: "error", message: "1" }), 0);
    const b = encodeFrame(makeControlFrame({ control: "error", message: "2" }), 1);
    expect(a).toContain("id: 0");
    expect(b).toContain("id: 1");
  });

  it("keeps JSON payload on a single data: line (no literal newlines)", () => {
    // JSON.stringify escapes newlines, so the encoded data stays one line —
    // the multi-line data: splitting is a safety net for raw text payloads.
    const frame = makeControlFrame({ control: "error", message: "line1\nline2" });
    const text = encodeFrame(frame, 0);
    const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines).toHaveLength(1);
    // round-trips the embedded newline through escaping.
    const parsed = JSON.parse(dataLines[0]!.slice("data: ".length));
    expect(parsed.payload.message).toBe("line1\nline2");
  });

  it("heartbeat is an SSE comment frame", () => {
    expect(encodeHeartbeat()).toBe(": keep-alive\n\n");
  });
});

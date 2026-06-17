import { describe, expect, it } from "vitest";
import {
  SseFrameSchema,
  makeControlFrame,
  makeUiMessageChunkFrame,
} from "../../src/transport/sse-frame.js";
import { protocolVersion } from "../../src/version.js";

describe("SseFrameSchema", () => {
  it("parses a uiMessageChunk frame and exposes its kind", () => {
    const frame = makeUiMessageChunkFrame({
      type: "text-delta",
      id: "1",
      delta: "hi",
    });
    const parsed = SseFrameSchema.parse(frame);
    expect(parsed.kind).toBe("uiMessageChunk");
    expect(parsed.protocolVersion).toBe(protocolVersion);
  });

  it("parses a uiMessageChunk frame carrying a lifecycle chunk", () => {
    expect(
      SseFrameSchema.parse(makeUiMessageChunkFrame({ type: "start" })).kind,
    ).toBe("uiMessageChunk");
    expect(
      SseFrameSchema.parse(makeUiMessageChunkFrame({ type: "finish" })).kind,
    ).toBe("uiMessageChunk");
    expect(
      SseFrameSchema.parse(
        makeUiMessageChunkFrame({ type: "error", errorText: "boom" }),
      ).kind,
    ).toBe("uiMessageChunk");
  });

  it("parses each control payload kind", () => {
    const queue = makeControlFrame({
      control: "queue",
      steering: [],
      followUp: ["q"],
    });
    expect(SseFrameSchema.parse(queue).kind).toBe("control");
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "error", message: "boom" }),
      ).kind,
    ).toBe("control");
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "extension-ui", request: { id: "u1" } }),
      ).kind,
    ).toBe("control");
    expect(
      SseFrameSchema.parse(makeControlFrame({ control: "stats", stats: { cost: 1 } }))
        .kind,
    ).toBe("control");
  });

  it("carries a protocolVersion field on every frame", () => {
    const frame = makeControlFrame({ control: "error", message: "x" });
    expect(frame).toHaveProperty("protocolVersion");
  });

  it("rejects a frame with missing kind", () => {
    expect(
      SseFrameSchema.safeParse({ protocolVersion, chunk: {} }).success,
    ).toBe(false);
  });

  it("rejects a frame whose payload does not match its kind", () => {
    // kind=control but payload is a uiMessageChunk-shaped object
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion,
      payload: { type: "text-delta", id: "1", delta: "x" },
    });
    expect(res.success).toBe(false);
  });

  it("rejects an unknown control sub-kind", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion,
      payload: { control: "telepathy" },
    });
    expect(res.success).toBe(false);
  });
});

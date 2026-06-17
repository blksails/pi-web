import { describe, expect, it } from "vitest";
import { UiMessageChunkSchema } from "../../src/transport/ui-message-chunk.js";

describe("UiMessageChunkSchema", () => {
  it("parses text/reasoning/tool/data-part payloads", () => {
    expect(
      UiMessageChunkSchema.parse({ type: "text-delta", id: "1", delta: "hi" }),
    ).toMatchObject({ type: "text-delta" });
    expect(
      UiMessageChunkSchema.parse({ type: "reasoning-start", id: "r1" }),
    ).toMatchObject({ type: "reasoning-start" });
    expect(
      UiMessageChunkSchema.parse({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "bash",
        input: { command: "ls" },
      }),
    ).toMatchObject({ type: "tool-input-available" });
    expect(
      UiMessageChunkSchema.parse({
        type: "data-pi-queue",
        data: { steering: [], followUp: [] },
      }),
    ).toMatchObject({ type: "data-pi-queue" });
  });

  it("parses AI SDK v5 lifecycle chunks", () => {
    expect(UiMessageChunkSchema.parse({ type: "start" })).toMatchObject({
      type: "start",
    });
    expect(
      UiMessageChunkSchema.parse({ type: "start", messageId: "m1" }),
    ).toMatchObject({ type: "start", messageId: "m1" });
    expect(UiMessageChunkSchema.parse({ type: "start-step" })).toMatchObject({
      type: "start-step",
    });
    expect(UiMessageChunkSchema.parse({ type: "finish-step" })).toMatchObject({
      type: "finish-step",
    });
    expect(UiMessageChunkSchema.parse({ type: "finish" })).toMatchObject({
      type: "finish",
    });
    expect(UiMessageChunkSchema.parse({ type: "abort" })).toMatchObject({
      type: "abort",
    });
    expect(
      UiMessageChunkSchema.parse({ type: "error", errorText: "boom" }),
    ).toMatchObject({ type: "error", errorText: "boom" });
  });

  it("parses additional tool chunks (input-start/delta, output-error)", () => {
    expect(
      UiMessageChunkSchema.parse({
        type: "tool-input-start",
        toolCallId: "t1",
        toolName: "bash",
      }),
    ).toMatchObject({ type: "tool-input-start" });
    expect(
      UiMessageChunkSchema.parse({
        type: "tool-input-delta",
        toolCallId: "t1",
        inputTextDelta: "{",
      }),
    ).toMatchObject({ type: "tool-input-delta", inputTextDelta: "{" });
    expect(
      UiMessageChunkSchema.parse({
        type: "tool-output-error",
        toolCallId: "t1",
        errorText: "nope",
      }),
    ).toMatchObject({ type: "tool-output-error", errorText: "nope" });
  });

  it("rejects an unknown chunk type", () => {
    expect(UiMessageChunkSchema.safeParse({ type: "text-explode", id: "1" }).success).toBe(
      false,
    );
  });

  it("rejects a text-delta missing delta", () => {
    expect(
      UiMessageChunkSchema.safeParse({ type: "text-delta", id: "1" }).success,
    ).toBe(false);
  });

  it("rejects an error chunk missing errorText", () => {
    expect(UiMessageChunkSchema.safeParse({ type: "error" }).success).toBe(
      false,
    );
  });

  it("rejects a tool-output-error missing errorText", () => {
    expect(
      UiMessageChunkSchema.safeParse({
        type: "tool-output-error",
        toolCallId: "t1",
      }).success,
    ).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { decodeUiMessageChunk } from "../../src/sse/decode-chunk.js";
import type { UiMessageChunk } from "@pi-web/protocol";

describe("decodeUiMessageChunk", () => {
  it("maps text chunks (start/delta/end)", () => {
    expect(decodeUiMessageChunk({ type: "text-start", id: "t1" })).toEqual({
      type: "text-start",
      id: "t1",
    });
    expect(
      decodeUiMessageChunk({ type: "text-delta", id: "t1", delta: "ab" }),
    ).toEqual({ type: "text-delta", id: "t1", delta: "ab" });
    expect(decodeUiMessageChunk({ type: "text-end", id: "t1" })).toEqual({
      type: "text-end",
      id: "t1",
    });
  });

  it("maps reasoning chunks (start/delta/end)", () => {
    expect(
      decodeUiMessageChunk({ type: "reasoning-start", id: "r1" }),
    ).toEqual({ type: "reasoning-start", id: "r1" });
    expect(
      decodeUiMessageChunk({ type: "reasoning-delta", id: "r1", delta: "x" }),
    ).toEqual({ type: "reasoning-delta", id: "r1", delta: "x" });
    expect(decodeUiMessageChunk({ type: "reasoning-end", id: "r1" })).toEqual({
      type: "reasoning-end",
      id: "r1",
    });
  });

  it("maps tool chunks (input-available / output-available)", () => {
    expect(
      decodeUiMessageChunk({
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "bash",
        input: { cmd: "ls" },
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "bash",
      input: { cmd: "ls" },
    });
    expect(
      decodeUiMessageChunk({
        type: "tool-output-available",
        toolCallId: "c1",
        output: "done",
      }),
    ).toEqual({
      type: "tool-output-available",
      toolCallId: "c1",
      output: "done",
    });
  });

  it("maps data-pi-* data parts", () => {
    const queue: UiMessageChunk = {
      type: "data-pi-queue",
      data: { steering: ["a"], followUp: ["b"] },
    };
    expect(decodeUiMessageChunk(queue)).toEqual({
      type: "data-pi-queue",
      data: { steering: ["a"], followUp: ["b"] },
    });

    const toolPartial: UiMessageChunk = {
      type: "data-pi-tool-partial",
      data: { toolCallId: "c1", toolName: "bash", partialResult: "..." },
    };
    expect(decodeUiMessageChunk(toolPartial)).toEqual({
      type: "data-pi-tool-partial",
      data: { toolCallId: "c1", toolName: "bash", partialResult: "..." },
    });
  });

  it("maps lifecycle chunks (start/finish)", () => {
    expect(
      decodeUiMessageChunk({ type: "start", messageId: "m1" }),
    ).toEqual({ type: "start", messageId: "m1" });
    expect(decodeUiMessageChunk({ type: "finish" })).toEqual({
      type: "finish",
    });
  });
});

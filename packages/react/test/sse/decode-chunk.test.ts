import { describe, it, expect } from "vitest";
import { decodeUiMessageChunk } from "../../src/sse/decode-chunk.js";
import type { UiMessageChunk } from "@blksails/pi-web-protocol";

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
    // preliminary(累积中间产出)透传,前端据此渲染 update/Streaming 态。
    expect(
      decodeUiMessageChunk({
        type: "tool-output-available",
        toolCallId: "c1",
        output: { lines: 3 },
        preliminary: true,
      }),
    ).toEqual({
      type: "tool-output-available",
      toolCallId: "c1",
      output: { lines: 3 },
      preliminary: true,
    });
  });

  it("tool-output-available isError → tool-output-error (sandbox/tool fail visible)", () => {
    expect(
      decodeUiMessageChunk({
        type: "tool-output-available",
        toolCallId: "c1",
        output: {
          content: [{ type: "text", text: 'Sandbox: read access denied for "/Users"' }],
        },
        isError: true,
      }),
    ).toEqual({
      type: "tool-output-error",
      toolCallId: "c1",
      errorText: 'Sandbox: read access denied for "/Users"',
    });

    expect(
      decodeUiMessageChunk({
        type: "tool-output-available",
        toolCallId: "c2",
        output: "ls: /Users: Operation not permitted",
        isError: true,
      }),
    ).toEqual({
      type: "tool-output-error",
      toolCallId: "c2",
      errorText: "ls: /Users: Operation not permitted",
    });
  });

  it("maps tool-output-error passthrough", () => {
    expect(
      decodeUiMessageChunk({
        type: "tool-output-error",
        toolCallId: "c1",
        errorText: "blocked",
      }),
    ).toEqual({
      type: "tool-output-error",
      toolCallId: "c1",
      errorText: "blocked",
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

    const ui: UiMessageChunk = {
      type: "data-pi-ui",
      data: { kind: "builtin", component: "metric", props: { label: "x", value: "1" } },
    };
    expect(decodeUiMessageChunk(ui)).toEqual({
      type: "data-pi-ui",
      data: { kind: "builtin", component: "metric", props: { label: "x", value: "1" } },
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

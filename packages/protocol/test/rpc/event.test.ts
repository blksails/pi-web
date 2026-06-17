import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AssistantMessageEventSchema,
} from "../../src/rpc/event.js";

const partial = {
  role: "assistant",
  content: [{ type: "text", text: "" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

describe("AssistantMessageEventSchema", () => {
  it("parses text/thinking sub-events", () => {
    expect(
      AssistantMessageEventSchema.parse({
        type: "text_delta",
        contentIndex: 0,
        delta: "hi",
        partial,
      }).type,
    ).toBe("text_delta");
    expect(
      AssistantMessageEventSchema.parse({
        type: "thinking_start",
        contentIndex: 0,
        partial,
      }).type,
    ).toBe("thinking_start");
  });

  it("rejects unknown sub-event type", () => {
    expect(
      AssistantMessageEventSchema.safeParse({ type: "nope", partial }).success,
    ).toBe(false);
  });
});

describe("AgentEventSchema", () => {
  it("parses agent_start / agent_end", () => {
    expect(AgentEventSchema.parse({ type: "agent_start" }).type).toBe("agent_start");
    expect(
      AgentEventSchema.parse({
        type: "agent_end",
        messages: [],
        willRetry: false,
      }).type,
    ).toBe("agent_end");
  });

  it("parses message_update with embedded assistantMessageEvent", () => {
    const ev = {
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial },
    };
    expect(AgentEventSchema.parse(ev)).toMatchObject({ type: "message_update" });
  });

  it("parses the tool execution lifecycle", () => {
    expect(
      AgentEventSchema.parse({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "bash",
        args: { command: "ls" },
      }).type,
    ).toBe("tool_execution_start");
    expect(
      AgentEventSchema.parse({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "bash",
        args: {},
        partialResult: "partial output",
      }).type,
    ).toBe("tool_execution_update");
    expect(
      AgentEventSchema.parse({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "bash",
        result: "done",
        isError: false,
      }).type,
    ).toBe("tool_execution_end");
  });

  it("parses queue/compaction/auto-retry session events", () => {
    expect(
      AgentEventSchema.parse({ type: "queue_update", steering: [], followUp: ["q"] }).type,
    ).toBe("queue_update");
    expect(
      AgentEventSchema.parse({ type: "compaction_start", reason: "threshold" }).type,
    ).toBe("compaction_start");
    expect(
      AgentEventSchema.parse({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1000,
        errorMessage: "rate limited",
      }).type,
    ).toBe("auto_retry_start");
  });

  it("parses extension_ui_request (folded into the event stream)", () => {
    expect(
      AgentEventSchema.parse({
        type: "extension_ui_request",
        id: "u1",
        method: "confirm",
        title: "ok?",
        message: "do it?",
      }),
    ).toMatchObject({ type: "extension_ui_request", method: "confirm" });
  });

  it("rejects unknown event type", () => {
    expect(AgentEventSchema.safeParse({ type: "bogus" }).success).toBe(false);
  });

  it("rejects tool_execution_end missing isError with a field path", () => {
    const res = AgentEventSchema.safeParse({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "bash",
      result: "done",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(JSON.stringify(res.error.issues)).toContain("isError");
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  AssistantMessageSchema,
  ModelSchema,
  ToolResultMessageSchema,
  UserMessageSchema,
} from "../../src/rpc/model.js";

const validModel = {
  id: "claude-x",
  name: "Claude X",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

const validAssistant = {
  role: "assistant",
  content: [{ type: "text", text: "hello" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

describe("ModelSchema", () => {
  it("parses a valid model", () => {
    expect(ModelSchema.parse(validModel)).toMatchObject({ id: "claude-x" });
  });
  it("rejects model missing required field", () => {
    const { id, ...rest } = validModel;
    void id;
    const res = ModelSchema.safeParse(rest);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("id"))).toBe(true);
    }
  });
});

describe("AgentMessageSchema", () => {
  it("parses user / assistant / toolResult messages", () => {
    expect(
      UserMessageSchema.parse({ role: "user", content: "hi", timestamp: 1 }).role,
    ).toBe("user");
    expect(AssistantMessageSchema.parse(validAssistant).role).toBe("assistant");
    expect(
      ToolResultMessageSchema.parse({
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: 1,
      }).role,
    ).toBe("toolResult");
    expect(AgentMessageSchema.parse(validAssistant)).toMatchObject({
      role: "assistant",
    });
  });

  it("accepts custom (passthrough) agent messages with a role", () => {
    const custom = { role: "pi-notification", text: "compacted" };
    expect(AgentMessageSchema.parse(custom)).toMatchObject({
      role: "pi-notification",
    });
  });

  it("rejects an object without role", () => {
    const res = AgentMessageSchema.safeParse({ foo: "bar" });
    expect(res.success).toBe(false);
  });
});

export { validModel, validAssistant };

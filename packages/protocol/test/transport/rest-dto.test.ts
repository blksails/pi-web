import { describe, expect, it } from "vitest";
import {
  CreateSessionRequestSchema,
  GetStateResponseSchema,
  PromptRequestSchema,
  SetModelRequestSchema,
  SetThinkingRequestSchema,
  UiResponseRequestSchema,
} from "../../src/transport/rest-dto.js";

describe("CreateSessionRequestSchema", () => {
  it("parses with only source", () => {
    expect(CreateSessionRequestSchema.parse({ source: "./agent" }).source).toBe(
      "./agent",
    );
  });
  it("parses with all optional fields", () => {
    const dto = {
      source: "git:https://x/y",
      cwd: "/work",
      model: "anthropic/claude-x",
      env: { ANTHROPIC_API_KEY: "sk" },
    };
    expect(CreateSessionRequestSchema.parse(dto)).toEqual(dto);
  });
  it("rejects when source is missing (field path)", () => {
    const res = CreateSessionRequestSchema.safeParse({ cwd: "/work" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("source"))).toBe(true);
    }
  });
});

describe("command request/response DTOs", () => {
  it("parses prompt/steer/model/thinking requests", () => {
    expect(PromptRequestSchema.parse({ message: "hi" }).message).toBe("hi");
    expect(
      SetModelRequestSchema.parse({ provider: "anthropic", modelId: "x" }).provider,
    ).toBe("anthropic");
    expect(SetThinkingRequestSchema.parse({ level: "high" }).level).toBe("high");
  });

  it("parses GetStateResponse", () => {
    const r = {
      state: {
        thinkingLevel: "low",
        isStreaming: false,
        isCompacting: false,
        steeringMode: "all",
        followUpMode: "all",
        sessionId: "s1",
        autoCompactionEnabled: false,
        messageCount: 0,
        pendingMessageCount: 0,
      },
    };
    expect(GetStateResponseSchema.parse(r).state.sessionId).toBe("s1");
  });

  it("parses ui-response request (= RpcExtensionUIResponse)", () => {
    expect(
      UiResponseRequestSchema.parse({
        type: "extension_ui_response",
        id: "1",
        confirmed: true,
      }),
    ).toMatchObject({ confirmed: true });
  });

  it("rejects bad thinking level and missing prompt message", () => {
    expect(SetThinkingRequestSchema.safeParse({ level: "ultra" }).success).toBe(false);
    expect(PromptRequestSchema.safeParse({}).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  CreateSessionRequestSchema,
  DeleteSessionRequestSchema,
  ForkRequestSchema,
  ForkResponseSchema,
  GetAvailableModelsResponseSchema,
  GetForkMessagesResponseSchema,
  GetStateResponseSchema,
  ListSessionFavoritesResponseSchema,
  ListSessionsResponseSchema,
  PromptRequestSchema,
  RenameSessionRequestSchema,
  RenameSessionResponseSchema,
  SESSION_NAME_MAX_LENGTH,
  SessionListItemSchema,
  SetModelRequestSchema,
  SetSessionFavoritesRequestSchema,
  SetThinkingRequestSchema,
  UiResponseRequestSchema,
} from "../../src/transport/rest-dto.js";

/** 合法 Model 负载(对齐 ModelSchema 必填字段),供可用模型响应单测复用。 */
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

describe("GetAvailableModelsResponseSchema (对齐 get_available_models)", () => {
  it("parses { models: Model[] }", () => {
    const r = GetAvailableModelsResponseSchema.parse({ models: [validModel] });
    expect(r.models).toHaveLength(1);
    expect(r.models[0]?.provider).toBe("anthropic");
  });
  it("parses empty models list", () => {
    expect(GetAvailableModelsResponseSchema.parse({ models: [] }).models).toEqual([]);
  });
  it("rejects when models is missing", () => {
    expect(GetAvailableModelsResponseSchema.safeParse({}).success).toBe(false);
  });
  it("rejects when a model entry is invalid (field path)", () => {
    const res = GetAvailableModelsResponseSchema.safeParse({
      models: [{ id: "x" }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("models"))).toBe(true);
    }
  });
});

describe("ForkRequestSchema (对齐 fork command)", () => {
  it("parses { entryId }", () => {
    expect(ForkRequestSchema.parse({ entryId: "e1" }).entryId).toBe("e1");
  });
  it("rejects when entryId is missing", () => {
    const res = ForkRequestSchema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("entryId"))).toBe(true);
    }
  });
  it("rejects when entryId is not a string", () => {
    expect(ForkRequestSchema.safeParse({ entryId: 123 }).success).toBe(false);
  });
});

describe("ForkResponseSchema (对齐 fork response)", () => {
  it("parses { text, cancelled }", () => {
    expect(ForkResponseSchema.parse({ text: "branch", cancelled: false })).toEqual({
      text: "branch",
      cancelled: false,
    });
  });
  it("parses empty object (both optional)", () => {
    expect(ForkResponseSchema.parse({})).toEqual({});
  });
  it("rejects when cancelled is not a boolean", () => {
    expect(ForkResponseSchema.safeParse({ cancelled: "no" }).success).toBe(false);
  });
});

describe("GetForkMessagesResponseSchema (对齐 get_fork_messages)", () => {
  it("parses { messages: { entryId, text }[] }", () => {
    const r = GetForkMessagesResponseSchema.parse({
      messages: [{ entryId: "e1", text: "hello" }],
    });
    expect(r.messages[0]).toEqual({ entryId: "e1", text: "hello" });
  });
  it("parses empty messages list", () => {
    expect(
      GetForkMessagesResponseSchema.parse({ messages: [] }).messages,
    ).toEqual([]);
  });
  it("rejects when a message entry lacks text (field path)", () => {
    const res = GetForkMessagesResponseSchema.safeParse({
      messages: [{ entryId: "e1" }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("text"))).toBe(true);
    }
  });
});

describe("SessionListItemSchema (session-source-protocol)", () => {
  const base = { sessionId: "s1", cwd: "/w", createdAt: "2026-01-01T00:00:00Z" };
  it("保留 source(含 source 的项经 parse 不被 strip)", () => {
    const parsed = SessionListItemSchema.parse({ ...base, source: "git:acme/agent" });
    expect(parsed.source).toBe("git:acme/agent");
  });
  it("无 source 解析通过(向后兼容,source 缺省)", () => {
    const parsed = SessionListItemSchema.parse({ ...base });
    expect(parsed.source).toBeUndefined();
  });
  it("ListSessionsResponseSchema 数组项保留 source(修 client 侧 strip 根因)", () => {
    const res = ListSessionsResponseSchema.parse({
      sessions: [{ ...base, source: "builtin:default-agent" }, { ...base, sessionId: "s2" }],
      scope: "cwd",
      globalEnabled: false,
    });
    expect(res.sessions[0]?.source).toBe("builtin:default-agent");
    expect(res.sessions[1]?.source).toBeUndefined();
  });
});

describe("DeleteSessionRequestSchema (session-list-item-actions)", () => {
  it("parses { sessionId }", () => {
    expect(DeleteSessionRequestSchema.parse({ sessionId: "s1" }).sessionId).toBe(
      "s1",
    );
  });
  it("rejects empty / missing sessionId", () => {
    expect(DeleteSessionRequestSchema.safeParse({ sessionId: "" }).success).toBe(
      false,
    );
    expect(DeleteSessionRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("RenameSessionRequestSchema (session-list-item-actions)", () => {
  it("parses { sessionId, name }", () => {
    expect(
      RenameSessionRequestSchema.parse({ sessionId: "s1", name: "My Chat" }),
    ).toEqual({ sessionId: "s1", name: "My Chat" });
  });
  it("rejects blank (whitespace-only) name", () => {
    const res = RenameSessionRequestSchema.safeParse({
      sessionId: "s1",
      name: "   ",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("name"))).toBe(true);
    }
  });
  it("rejects empty name and missing sessionId", () => {
    expect(
      RenameSessionRequestSchema.safeParse({ sessionId: "s1", name: "" }).success,
    ).toBe(false);
    expect(
      RenameSessionRequestSchema.safeParse({ name: "x" }).success,
    ).toBe(false);
  });
  it("rejects name exceeding max length", () => {
    const res = RenameSessionRequestSchema.safeParse({
      sessionId: "s1",
      name: "a".repeat(SESSION_NAME_MAX_LENGTH + 1),
    });
    expect(res.success).toBe(false);
  });
  it("accepts name at exactly max length", () => {
    expect(
      RenameSessionRequestSchema.safeParse({
        sessionId: "s1",
        name: "a".repeat(SESSION_NAME_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });
});

describe("RenameSessionResponseSchema (session-list-item-actions)", () => {
  it("parses { sessionId, name }", () => {
    expect(
      RenameSessionResponseSchema.parse({ sessionId: "s1", name: "n" }),
    ).toEqual({ sessionId: "s1", name: "n" });
  });
});

describe("session favorites DTOs (session-list-item-actions)", () => {
  it("parses ListSessionFavoritesResponse { sessionIds }", () => {
    expect(
      ListSessionFavoritesResponseSchema.parse({ sessionIds: ["a", "b"] })
        .sessionIds,
    ).toEqual(["a", "b"]);
  });
  it("parses empty sessionIds list", () => {
    expect(
      ListSessionFavoritesResponseSchema.parse({ sessionIds: [] }).sessionIds,
    ).toEqual([]);
  });
  it("parses SetSessionFavoritesRequest { sessionIds }", () => {
    expect(
      SetSessionFavoritesRequestSchema.parse({ sessionIds: ["x"] }).sessionIds,
    ).toEqual(["x"]);
  });
  it("rejects when sessionIds is not an array of strings", () => {
    expect(
      SetSessionFavoritesRequestSchema.safeParse({ sessionIds: [1, 2] }).success,
    ).toBe(false);
    expect(
      SetSessionFavoritesRequestSchema.safeParse({ sessionIds: "a" }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  BashResultSchema,
  CompactionResultSchema,
  RpcSessionStateSchema,
  RpcSlashCommandSchema,
  SessionStatsSchema,
} from "../../src/rpc/session-state.js";

const validState = {
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "one-at-a-time",
  sessionId: "s1",
  autoCompactionEnabled: true,
  messageCount: 3,
  pendingMessageCount: 0,
};

describe("RpcSessionStateSchema", () => {
  it("parses a valid state (model optional)", () => {
    expect(RpcSessionStateSchema.parse(validState).sessionId).toBe("s1");
  });
  it("rejects state missing sessionId", () => {
    const { sessionId, ...rest } = validState;
    void sessionId;
    const res = RpcSessionStateSchema.safeParse(rest);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("sessionId"))).toBe(true);
    }
  });
  it("rejects bad thinkingLevel", () => {
    expect(
      RpcSessionStateSchema.safeParse({ ...validState, thinkingLevel: "ultra" }).success,
    ).toBe(false);
  });
});

describe("SessionStats / CompactionResult / BashResult / RpcSlashCommand", () => {
  it("parses SessionStats", () => {
    expect(
      SessionStatsSchema.parse({
        sessionId: "s1",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        cost: 0.01,
      }).sessionId,
    ).toBe("s1");
  });
  it("parses CompactionResult", () => {
    expect(
      CompactionResultSchema.parse({
        summary: "s",
        firstKeptEntryId: "e1",
        tokensBefore: 100,
      }).summary,
    ).toBe("s");
  });
  it("parses BashResult", () => {
    expect(
      BashResultSchema.parse({
        output: "ok",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      }).output,
    ).toBe("ok");
  });
  it("parses RpcSlashCommand and rejects bad source", () => {
    expect(
      RpcSlashCommandSchema.parse({
        name: "compact",
        source: "extension",
        sourceInfo: { path: "/x", source: "pkg", scope: "user", origin: "package" },
      }).name,
    ).toBe("compact");
    expect(
      RpcSlashCommandSchema.safeParse({
        name: "x",
        source: "wat",
        sourceInfo: { path: "/x", source: "pkg", scope: "user", origin: "package" },
      }).success,
    ).toBe(false);
  });
});

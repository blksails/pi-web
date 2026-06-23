/**
 * TDD tests for task 2.1: logs control frame extension + REST DTO additions.
 *
 * RED phase: these tests are written BEFORE the implementation exists.
 * They capture the expected behaviour as per requirements 3.1, 3.3, 4.1, 9.1.
 */
import { describe, expect, it } from "vitest";
import { SseFrameSchema, makeControlFrame } from "../../src/transport/sse-frame.js";
import {
  GetLogsResponseSchema,
  GetLogsQuerySchema,
} from "../../src/transport/rest-dto.js";

// ────────────────────────────────────────────────────────────────────────────
// Shared fixture — a minimal valid LogEntry
// ────────────────────────────────────────────────────────────────────────────
const validEntry = {
  level: "info" as const,
  ns: "agent:test",
  msg: "hello",
  ts: Date.now(),
};

// ────────────────────────────────────────────────────────────────────────────
// control:logs SSE frame
// ────────────────────────────────────────────────────────────────────────────
describe("control:logs SSE frame", () => {
  it("constructs and parses a logs frame with valid entries", () => {
    const frame = makeControlFrame({
      control: "logs",
      entries: [validEntry],
    });
    const parsed = SseFrameSchema.parse(frame);
    expect(parsed.kind).toBe("control");
    if (parsed.kind === "control") {
      expect(parsed.payload.control).toBe("logs");
      if (parsed.payload.control === "logs") {
        expect(parsed.payload.entries).toHaveLength(1);
        expect(parsed.payload.entries[0]?.ns).toBe("agent:test");
      }
    }
  });

  it("parses a logs frame with an empty entries array", () => {
    const frame = makeControlFrame({ control: "logs", entries: [] });
    const parsed = SseFrameSchema.parse(frame);
    expect(parsed.kind).toBe("control");
  });

  it("parses a logs frame with optional id field present", () => {
    const frame = makeControlFrame({
      control: "logs",
      entries: [{ ...validEntry, id: "seq-42" }],
    });
    const parsed = SseFrameSchema.parse(frame);
    expect(parsed.kind).toBe("control");
  });

  it("rejects a logs frame when an entry has an invalid level", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "1.0.0",
      payload: {
        control: "logs",
        entries: [{ ...validEntry, level: "CRITICAL" }],
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects a logs frame when an entry is missing required fields", () => {
    // missing `ts`
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "1.0.0",
      payload: {
        control: "logs",
        entries: [{ level: "info", ns: "x", msg: "y" }],
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects a logs frame when entries field is missing", () => {
    const res = SseFrameSchema.safeParse({
      kind: "control",
      protocolVersion: "1.0.0",
      payload: { control: "logs" },
    });
    expect(res.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Regression: existing control frame branches still parse (Req 9.1)
// ────────────────────────────────────────────────────────────────────────────
describe("existing control frame branches regression (9.1)", () => {
  it("still parses control:extension-ui", () => {
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "extension-ui", request: { id: "u1" } }),
      ).kind,
    ).toBe("control");
  });

  it("still parses control:queue", () => {
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "queue", steering: [], followUp: ["q"] }),
      ).kind,
    ).toBe("control");
  });

  it("still parses control:stats", () => {
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "stats", stats: { cost: 1 } }),
      ).kind,
    ).toBe("control");
  });

  it("still parses control:error", () => {
    expect(
      SseFrameSchema.parse(
        makeControlFrame({ control: "error", message: "boom" }),
      ).kind,
    ).toBe("control");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GetLogsResponseSchema (REST DTO)
// ────────────────────────────────────────────────────────────────────────────
describe("GetLogsResponseSchema", () => {
  it("parses { entries: LogEntry[] }", () => {
    const r = GetLogsResponseSchema.parse({ entries: [validEntry] });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.msg).toBe("hello");
  });

  it("parses empty entries array", () => {
    expect(GetLogsResponseSchema.parse({ entries: [] }).entries).toEqual([]);
  });

  it("rejects when entries is missing", () => {
    expect(GetLogsResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects when an entry has invalid level", () => {
    const res = GetLogsResponseSchema.safeParse({
      entries: [{ ...validEntry, level: "trace" }],
    });
    expect(res.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GetLogsQuerySchema (log query parameters)
// ────────────────────────────────────────────────────────────────────────────
describe("GetLogsQuerySchema", () => {
  it("parses an empty query (all fields optional)", () => {
    expect(GetLogsQuerySchema.parse({})).toEqual({});
  });

  it("parses level filter", () => {
    expect(GetLogsQuerySchema.parse({ level: "warn" }).level).toBe("warn");
  });

  it("parses limit", () => {
    expect(GetLogsQuerySchema.parse({ limit: 50 }).limit).toBe(50);
  });

  it("parses since (epoch ms)", () => {
    const now = Date.now();
    expect(GetLogsQuerySchema.parse({ since: now }).since).toBe(now);
  });

  it("parses all fields together", () => {
    const q = { level: "error" as const, limit: 100, since: 1700000000000 };
    expect(GetLogsQuerySchema.parse(q)).toEqual(q);
  });

  it("rejects invalid level", () => {
    expect(GetLogsQuerySchema.safeParse({ level: "verbose" }).success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    expect(GetLogsQuerySchema.safeParse({ limit: "many" }).success).toBe(false);
  });

  it("rejects non-number since", () => {
    expect(GetLogsQuerySchema.safeParse({ since: "yesterday" }).success).toBe(false);
  });
});

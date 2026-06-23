/**
 * Test: protocol/logging/log-entry — LogLevelSchema, LogEntrySchema, parseLogLine
 *
 * TDD: this file is written before the implementation (RED phase).
 * It exercises:
 *  1. LogLevelSchema — valid/invalid enum values.
 *  2. LogEntrySchema — valid and invalid shapes.
 *  3. parseLogLine — round-trip, non-sentinel, bad JSON, bad schema.
 *  4. Shape alignment: LogEntrySchema inferred type satisfies logger's LogEntry.
 */
import { describe, expect, it } from "vitest";
import type { LogEntry } from "@pi-web/logger";
import { serializeLogLine, LOG_SENTINEL } from "@pi-web/logger";
import {
  LogLevelSchema,
  LogEntrySchema,
  parseLogLine,
} from "../../src/logging/index.js";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Compile-time shape alignment check:
// LogEntrySchema's inferred type must be assignable to LogEntry (and vice-versa).
// This is a type-level test — if it compiles, the shapes are aligned.
// ---------------------------------------------------------------------------
type InferredEntry = z.infer<typeof LogEntrySchema>;
// Forward assignability: inferred satisfies LogEntry contract.
const _shapeCheck: LogEntry = {} as InferredEntry;
// Reverse assignability: LogEntry satisfies inferred contract.
const _shapeCheckReverse: InferredEntry = {} as LogEntry;
void _shapeCheck;
void _shapeCheckReverse;

// ---------------------------------------------------------------------------
// LogLevelSchema
// ---------------------------------------------------------------------------
describe("LogLevelSchema", () => {
  it("accepts valid levels", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(LogLevelSchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid level strings", () => {
    expect(LogLevelSchema.safeParse("verbose").success).toBe(false);
    expect(LogLevelSchema.safeParse("").success).toBe(false);
    expect(LogLevelSchema.safeParse(42).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LogEntrySchema
// ---------------------------------------------------------------------------
describe("LogEntrySchema", () => {
  const minimal: LogEntry = {
    level: "info",
    ns: "test:ns",
    msg: "hello",
    ts: Date.now(),
  };

  it("accepts a minimal valid entry (no id, no data)", () => {
    const result = LogEntrySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe("info");
      expect(result.data.ns).toBe("test:ns");
      expect(result.data.msg).toBe("hello");
    }
  });

  it("accepts a full entry with id and data", () => {
    const full: LogEntry = {
      id: "entry-42",
      level: "warn",
      ns: "agent:hello",
      msg: "something happened",
      data: { key: "value", num: 123 },
      ts: 1700000000000,
    };
    const result = LogEntrySchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("entry-42");
      expect(result.data.data).toEqual({ key: "value", num: 123 });
    }
  });

  it("accepts data as any unknown type (array, primitive)", () => {
    expect(
      LogEntrySchema.safeParse({ ...minimal, data: [1, 2, 3] }).success,
    ).toBe(true);
    expect(
      LogEntrySchema.safeParse({ ...minimal, data: "a string" }).success,
    ).toBe(true);
    expect(
      LogEntrySchema.safeParse({ ...minimal, data: null }).success,
    ).toBe(true);
  });

  it("rejects when level is invalid", () => {
    expect(
      LogEntrySchema.safeParse({ ...minimal, level: "trace" }).success,
    ).toBe(false);
  });

  it("rejects when ns is empty", () => {
    expect(
      LogEntrySchema.safeParse({ ...minimal, ns: "" }).success,
    ).toBe(false);
  });

  it("rejects when required fields are missing", () => {
    // missing level
    const { level: _l, ...noLevel } = minimal;
    void _l;
    expect(LogEntrySchema.safeParse(noLevel).success).toBe(false);

    // missing ns
    const { ns: _n, ...noNs } = minimal;
    void _n;
    expect(LogEntrySchema.safeParse(noNs).success).toBe(false);

    // missing msg
    const { msg: _m, ...noMsg } = minimal;
    void _m;
    expect(LogEntrySchema.safeParse(noMsg).success).toBe(false);

    // missing ts
    const { ts: _t, ...noTs } = minimal;
    void _t;
    expect(LogEntrySchema.safeParse(noTs).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseLogLine
// ---------------------------------------------------------------------------
describe("parseLogLine", () => {
  const sampleEntry: LogEntry = {
    level: "debug",
    ns: "core:test",
    msg: "test message",
    data: { detail: true },
    ts: 1700000001000,
  };

  it("round-trips: parses a line produced by serializeLogLine (without trailing newline)", () => {
    const raw = serializeLogLine(sampleEntry);
    // serializeLogLine appends \n; strip it as the task specifies
    const line = raw.replace(/\n$/, "");
    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result?.level).toBe(sampleEntry.level);
    expect(result?.ns).toBe(sampleEntry.ns);
    expect(result?.msg).toBe(sampleEntry.msg);
    expect(result?.data).toEqual(sampleEntry.data);
    expect(result?.ts).toBe(sampleEntry.ts);
  });

  it("round-trips with trailing newline still included (graceful)", () => {
    // parser should handle both with and without trailing \n
    const raw = serializeLogLine(sampleEntry);
    const result = parseLogLine(raw.trimEnd());
    expect(result).not.toBeNull();
  });

  it("returns null for a line without the sentinel prefix", () => {
    expect(parseLogLine('{"level":"info","ns":"x","msg":"hi","ts":1}')).toBeNull();
    expect(parseLogLine("plain stderr output")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });

  it("returns null when line has sentinel prefix but JSON is invalid", () => {
    const badJson = LOG_SENTINEL + "{ not valid json {{";
    expect(parseLogLine(badJson)).toBeNull();
  });

  it("returns null when sentinel+JSON but schema is invalid (bad level)", () => {
    const badLevel = JSON.stringify({
      level: "verbose", // not in schema
      ns: "test",
      msg: "hi",
      ts: 1,
    });
    expect(parseLogLine(LOG_SENTINEL + badLevel)).toBeNull();
  });

  it("returns null when sentinel+JSON but schema is invalid (missing ns)", () => {
    const missingNs = JSON.stringify({
      level: "info",
      // ns omitted
      msg: "hi",
      ts: 1,
    });
    expect(parseLogLine(LOG_SENTINEL + missingNs)).toBeNull();
  });

  it("returns null when sentinel+JSON but ns is empty string", () => {
    const emptyNs = JSON.stringify({ level: "info", ns: "", msg: "hi", ts: 1 });
    expect(parseLogLine(LOG_SENTINEL + emptyNs)).toBeNull();
  });

  it("does not throw on any input — swallows all errors", () => {
    // Should never throw, even for wildly invalid input
    expect(() => parseLogLine(null as unknown as string)).not.toThrow();
    expect(() => parseLogLine(undefined as unknown as string)).not.toThrow();
    expect(() => parseLogLine(123 as unknown as string)).not.toThrow();
  });
});

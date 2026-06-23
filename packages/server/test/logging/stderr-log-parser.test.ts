/**
 * Unit tests for StderrLogParser (packages/server/src/logging/stderr-log-parser.ts)
 *
 * Covers:
 *  - Sentinel lines are parsed into LogEntry objects (original ns preserved)
 *  - Non-sentinel / plain text stderr lines are wrapped as proc:stderr entries (Req 4.3)
 *  - Empty / whitespace-only lines produce no output (noise suppression)
 *  - Multiple lines in one chunk produce multiple LogEntry results
 *  - Cross-chunk boundary: half-line buffered and completed on next chunk
 *  - Mixed sentinel + plain text lines: each goes to the correct ns, in order
 *
 * Requirements: 2.5, 4.3
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StderrLogParser } from "../../src/logging/stderr-log-parser.js";
import { LOG_SENTINEL } from "@pi-web/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build a valid sentinel line (mirrors what the Node sink produces)
// ──────────────────────────────────────────────────────────────────────────────

function makeSentinelLine(
  level: "debug" | "info" | "warn" | "error" = "info",
  msg = "hello",
  ns = "test:ns",
  ts = 1_700_000_000_000,
): string {
  const entry = { level, ns, msg, ts };
  return `${LOG_SENTINEL}${JSON.stringify(entry)}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("StderrLogParser", () => {
  let parser: StderrLogParser;

  beforeEach(() => {
    parser = new StderrLogParser();
  });

  // ── basic sentinel parsing ────────────────────────────────────────────────

  describe("sentinel line parsing", () => {
    it("parses a single sentinel line into one LogEntry", () => {
      const line = makeSentinelLine("info", "hello world", "agent:hello");
      const results = parser.ingestChunk(line + "\n");
      expect(results).toHaveLength(1);
      expect(results[0]!.level).toBe("info");
      expect(results[0]!.msg).toBe("hello world");
      expect(results[0]!.ns).toBe("agent:hello");
    });

    it("parses warn and error levels correctly", () => {
      const warnLine = makeSentinelLine("warn", "a warning");
      const errorLine = makeSentinelLine("error", "an error");
      const results = parser.ingestChunk(warnLine + "\n" + errorLine + "\n");
      expect(results).toHaveLength(2);
      expect(results[0]!.level).toBe("warn");
      expect(results[1]!.level).toBe("error");
    });

    it("parses entry with data field", () => {
      const entry = {
        level: "debug",
        ns: "ext:probe",
        msg: "structured",
        data: { count: 42 },
        ts: 1_700_000_000_000,
      };
      const line = `${LOG_SENTINEL}${JSON.stringify(entry)}\n`;
      const results = parser.ingestChunk(line);
      expect(results).toHaveLength(1);
      expect((results[0]!.data as { count: number }).count).toBe(42);
    });
  });

  // ── non-sentinel lines wrapped as proc:stderr (Req 4.3) ──────────────────

  describe("non-sentinel line wrapping (Req 4.3)", () => {
    it("wraps a plain text stderr line as proc:stderr entry", () => {
      const results = parser.ingestChunk("some debug text from node\n");
      expect(results).toHaveLength(1);
      expect(results[0]!.ns).toBe("proc:stderr");
      expect(results[0]!.level).toBe("warn");
      expect(results[0]!.msg).toBe("some debug text from node");
      expect(typeof results[0]!.ts).toBe("number");
    });

    it("wraps a valid JSON line (no sentinel) as proc:stderr entry", () => {
      const jsonLine = JSON.stringify({ level: "info", ns: "x", msg: "y", ts: 1 }) + "\n";
      const results = parser.ingestChunk(jsonLine);
      expect(results).toHaveLength(1);
      expect(results[0]!.ns).toBe("proc:stderr");
      // The raw JSON text becomes the msg (not parsed as structured)
      expect(results[0]!.msg).toContain('"msg":"y"');
    });

    it("wraps an RPC-like JSONL line (no sentinel) as proc:stderr entry", () => {
      const rpcLine = JSON.stringify({ type: "response", id: "abc", result: {} }) + "\n";
      const results = parser.ingestChunk(rpcLine);
      expect(results).toHaveLength(1);
      expect(results[0]!.ns).toBe("proc:stderr");
    });

    it("ignores an invalid JSON line with sentinel prefix (malformed sentinel → dropped)", () => {
      const badLine = `${LOG_SENTINEL}not-valid-json\n`;
      expect(parser.ingestChunk(badLine)).toHaveLength(0);
    });

    it("ignores a sentinel line with invalid schema (missing required fields → dropped)", () => {
      const badEntry = JSON.stringify({ level: "info" }); // missing ns, msg, ts
      const line = `${LOG_SENTINEL}${badEntry}\n`;
      expect(parser.ingestChunk(line)).toHaveLength(0);
    });

    it("ignores empty lines (no proc:stderr noise)", () => {
      const results = parser.ingestChunk("\n\n\n");
      expect(results).toHaveLength(0);
    });

    it("ignores whitespace-only lines (no proc:stderr noise)", () => {
      const results = parser.ingestChunk("   \n\t\n");
      expect(results).toHaveLength(0);
    });

    it("mixed chunk: sentinel lines → original ns, plain lines → proc:stderr, order preserved", () => {
      const chunk = [
        "plain stderr text\n",
        makeSentinelLine("info", "picked up") + "\n",
        JSON.stringify({ type: "event", payload: {} }) + "\n",
        makeSentinelLine("warn", "also picked up") + "\n",
        "another plain line\n",
      ].join("");

      const results = parser.ingestChunk(chunk);
      // 5 lines: plain | sentinel | rpc-json | sentinel | plain → 5 entries
      // (all non-empty non-sentinel lines become proc:stderr)
      expect(results).toHaveLength(5);
      expect(results[0]!.ns).toBe("proc:stderr");
      expect(results[0]!.msg).toBe("plain stderr text");
      expect(results[1]!.ns).toBe("test:ns");   // sentinel preserves ns
      expect(results[1]!.msg).toBe("picked up");
      expect(results[2]!.ns).toBe("proc:stderr"); // rpc JSON line → proc:stderr
      expect(results[3]!.ns).toBe("test:ns");   // sentinel preserves ns
      expect(results[3]!.msg).toBe("also picked up");
      expect(results[4]!.ns).toBe("proc:stderr");
      expect(results[4]!.msg).toBe("another plain line");
    });
  });

  // ── multiple lines in one chunk ───────────────────────────────────────────

  describe("multiple sentinel lines in one chunk", () => {
    it("returns all sentinel entries when multiple complete lines arrive at once", () => {
      const lines = [
        makeSentinelLine("debug", "d"),
        makeSentinelLine("info", "i"),
        makeSentinelLine("warn", "w"),
        makeSentinelLine("error", "e"),
      ]
        .map((l) => l + "\n")
        .join("");

      const results = parser.ingestChunk(lines);
      expect(results).toHaveLength(4);
      expect(results.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
    });
  });

  // ── cross-chunk boundary (half-line buffering) ────────────────────────────

  describe("cross-chunk boundary", () => {
    it("buffers an incomplete line and completes it when the rest arrives", () => {
      const full = makeSentinelLine("info", "split message");
      // Split at an arbitrary point in the middle
      const halfway = Math.floor(full.length / 2);
      const part1 = full.slice(0, halfway);
      const part2 = full.slice(halfway) + "\n";

      const firstResult = parser.ingestChunk(part1);
      expect(firstResult).toHaveLength(0); // no complete line yet

      const secondResult = parser.ingestChunk(part2);
      expect(secondResult).toHaveLength(1);
      expect(secondResult[0]!.msg).toBe("split message");
    });

    it("handles chunk that ends without newline and next chunk has newline mid-way", () => {
      const line1 = makeSentinelLine("info", "line-one");
      const line2 = makeSentinelLine("warn", "line-two");

      // Chunk boundary falls between the two lines
      const chunk1 = line1; // no trailing newline
      const chunk2 = "\n" + line2 + "\n";

      const r1 = parser.ingestChunk(chunk1);
      expect(r1).toHaveLength(0);

      const r2 = parser.ingestChunk(chunk2);
      expect(r2).toHaveLength(2);
      expect(r2[0]!.msg).toBe("line-one");
      expect(r2[1]!.msg).toBe("line-two");
    });

    it("handles chunk split exactly at newline boundary", () => {
      const line = makeSentinelLine("error", "boundary");

      // First chunk = complete line including newline
      const r1 = parser.ingestChunk(line + "\n");
      expect(r1).toHaveLength(1);

      // Second chunk = another complete line
      const line2 = makeSentinelLine("info", "next");
      const r2 = parser.ingestChunk(line2 + "\n");
      expect(r2).toHaveLength(1);
      expect(r2[0]!.msg).toBe("next");
    });

    it("correctly handles rapid small chunks (one character at a time)", () => {
      const line = makeSentinelLine("info", "char-by-char") + "\n";
      let allResults: { level: string; msg: string }[] = [];

      for (const char of line) {
        const res = parser.ingestChunk(char);
        allResults = allResults.concat(res);
      }

      expect(allResults).toHaveLength(1);
      expect(allResults[0]!.msg).toBe("char-by-char");
    });
  });

  // ── multiple sequential calls ─────────────────────────────────────────────

  describe("stateful sequential parsing", () => {
    it("accumulates entries across many independent chunks", () => {
      const lines = Array.from({ length: 5 }, (_, i) =>
        makeSentinelLine("info", `msg-${i}`) + "\n",
      );

      const allResults = lines.flatMap((l) => parser.ingestChunk(l));
      expect(allResults).toHaveLength(5);
      expect(allResults.map((e) => e.msg)).toEqual([
        "msg-0",
        "msg-1",
        "msg-2",
        "msg-3",
        "msg-4",
      ]);
    });

    it("does not cross-contaminate parsers: two independent parsers are isolated", () => {
      const p1 = new StderrLogParser();
      const p2 = new StderrLogParser();

      const half = makeSentinelLine("info", "from-p1");
      p1.ingestChunk(half); // no newline yet → buffered in p1

      // p2 produces a proc:stderr entry for the plain line, but no sentinel entry
      const p2Results = p2.ingestChunk("irrelevant\n");
      expect(p2Results).toHaveLength(1);
      expect(p2Results[0]!.ns).toBe("proc:stderr");

      // Complete p1's line
      const r1 = p1.ingestChunk("\n");
      expect(r1).toHaveLength(1);
      expect(r1[0]!.msg).toBe("from-p1");
    });
  });
});

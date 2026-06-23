/**
 * Unit tests for LogRingBuffer (packages/server/src/logging/log-ring-buffer.ts)
 *
 * Covers:
 *  - ingest assigns monotonically increasing string ids
 *  - buffer evicts oldest entries when at capacity
 *  - getLogs: level filter (≥ selected), limit (most recent N), since (ts ≥ since)
 *
 * Requirements: 4.1, 4.3, 4.4, 9.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LogRingBuffer } from "../../src/logging/log-ring-buffer.js";
import type { LogLevel } from "@pi-web/protocol";

// ──────────────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────────────

function makeEntry(
  level: LogLevel,
  ts: number,
  msg = "test",
  ns = "test:ns",
) {
  return { level, ns, msg, ts };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("LogRingBuffer", () => {
  let buf: LogRingBuffer;

  beforeEach(() => {
    buf = new LogRingBuffer(10);
  });

  // ── id assignment ─────────────────────────────────────────────────────────

  describe("ingest — id assignment", () => {
    it("assigns a string id to every ingested entry", () => {
      const result = buf.ingest(makeEntry("info", 1000));
      expect(typeof result.id).toBe("string");
      expect(result.id!.length).toBeGreaterThan(0);
    });

    it("assigns monotonically increasing ids across successive ingest calls", () => {
      const ids = [
        buf.ingest(makeEntry("info", 1000)).id!,
        buf.ingest(makeEntry("info", 1001)).id!,
        buf.ingest(makeEntry("info", 1002)).id!,
      ];
      // Numeric ordering
      expect(Number(ids[1])).toBeGreaterThan(Number(ids[0]));
      expect(Number(ids[2])).toBeGreaterThan(Number(ids[1]));
    });

    it("returned entry preserves original fields alongside the new id", () => {
      const entry = makeEntry("warn", 9999, "hello", "agent:foo");
      const result = buf.ingest(entry);
      expect(result.level).toBe("warn");
      expect(result.ns).toBe("agent:foo");
      expect(result.msg).toBe("hello");
      expect(result.ts).toBe(9999);
    });
  });

  // ── capacity eviction ─────────────────────────────────────────────────────

  describe("capacity eviction", () => {
    it("evicts oldest entries when buffer is full (capacity=3, insert 5)", () => {
      const smallBuf = new LogRingBuffer(3);
      const inserted = [];
      for (let i = 0; i < 5; i++) {
        inserted.push(smallBuf.ingest(makeEntry("info", 1000 + i, `msg-${i}`)));
      }
      const all = smallBuf.getLogs({});
      expect(all).toHaveLength(3);
      // Oldest two should have been evicted; last three (indices 2,3,4) remain
      const msgs = all.map((e) => e.msg);
      expect(msgs).not.toContain("msg-0");
      expect(msgs).not.toContain("msg-1");
      expect(msgs).toContain("msg-2");
      expect(msgs).toContain("msg-3");
      expect(msgs).toContain("msg-4");
    });

    it("retains ids of surviving entries (ids are contiguous from eviction point)", () => {
      const smallBuf = new LogRingBuffer(3);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(smallBuf.ingest(makeEntry("info", 1000 + i)).id!);
      }
      const all = smallBuf.getLogs({});
      const remainingIds = all.map((e) => e.id!);
      // ids[2], ids[3], ids[4] should be present
      expect(remainingIds).toContain(ids[2]);
      expect(remainingIds).toContain(ids[3]);
      expect(remainingIds).toContain(ids[4]);
      // ids[0], ids[1] should be gone
      expect(remainingIds).not.toContain(ids[0]);
      expect(remainingIds).not.toContain(ids[1]);
    });

    it("never exceeds capacity (insert many more than capacity)", () => {
      const cap = 5;
      const bigBuf = new LogRingBuffer(cap);
      for (let i = 0; i < 50; i++) {
        bigBuf.ingest(makeEntry("debug", i));
      }
      expect(bigBuf.getLogs({}).length).toBeLessThanOrEqual(cap);
    });
  });

  // ── getLogs: level filter ─────────────────────────────────────────────────

  describe("getLogs — level filter", () => {
    beforeEach(() => {
      buf.ingest(makeEntry("debug", 1));
      buf.ingest(makeEntry("info", 2));
      buf.ingest(makeEntry("warn", 3));
      buf.ingest(makeEntry("error", 4));
    });

    it("no filter returns all entries", () => {
      expect(buf.getLogs({})).toHaveLength(4);
    });

    it("level=debug returns all four levels", () => {
      expect(buf.getLogs({ level: "debug" })).toHaveLength(4);
    });

    it("level=info returns info/warn/error, excludes debug", () => {
      const results = buf.getLogs({ level: "info" });
      expect(results).toHaveLength(3);
      expect(results.map((e) => e.level)).not.toContain("debug");
    });

    it("level=warn returns only warn and error", () => {
      const results = buf.getLogs({ level: "warn" });
      expect(results).toHaveLength(2);
      const levels = results.map((e) => e.level);
      expect(levels).toContain("warn");
      expect(levels).toContain("error");
      expect(levels).not.toContain("info");
      expect(levels).not.toContain("debug");
    });

    it("level=error returns only error entries", () => {
      const results = buf.getLogs({ level: "error" });
      expect(results).toHaveLength(1);
      expect(results[0]!.level).toBe("error");
    });
  });

  // ── getLogs: limit ────────────────────────────────────────────────────────

  describe("getLogs — limit (most recent N)", () => {
    it("limit=2 returns the 2 most recently ingested entries", () => {
      for (let i = 0; i < 8; i++) {
        buf.ingest(makeEntry("info", 1000 + i, `msg-${i}`));
      }
      const results = buf.getLogs({ limit: 2 });
      expect(results).toHaveLength(2);
      // Most recent are msg-6 and msg-7
      const msgs = results.map((e) => e.msg);
      expect(msgs).toContain("msg-6");
      expect(msgs).toContain("msg-7");
    });

    it("limit larger than buffer size returns all entries", () => {
      buf.ingest(makeEntry("info", 1));
      buf.ingest(makeEntry("info", 2));
      const results = buf.getLogs({ limit: 100 });
      expect(results).toHaveLength(2);
    });

    it("limit=0 returns empty array", () => {
      buf.ingest(makeEntry("info", 1));
      expect(buf.getLogs({ limit: 0 })).toHaveLength(0);
    });
  });

  // ── getLogs: since filter ─────────────────────────────────────────────────

  describe("getLogs — since filter (ts ≥ since)", () => {
    it("since filters entries with ts < since", () => {
      buf.ingest(makeEntry("info", 100));
      buf.ingest(makeEntry("info", 200));
      buf.ingest(makeEntry("info", 300));
      buf.ingest(makeEntry("info", 400));

      const results = buf.getLogs({ since: 250 });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.ts >= 250)).toBe(true);
    });

    it("since=0 returns all entries", () => {
      buf.ingest(makeEntry("info", 100));
      buf.ingest(makeEntry("info", 200));
      expect(buf.getLogs({ since: 0 })).toHaveLength(2);
    });
  });

  // ── getLogs: combined filters ─────────────────────────────────────────────

  describe("getLogs — combined filters", () => {
    it("level + limit combined: level=warn, limit=1 returns most recent warn/error", () => {
      buf.ingest(makeEntry("debug", 1));
      buf.ingest(makeEntry("warn", 2, "warn-a"));
      buf.ingest(makeEntry("error", 3, "error-b"));

      const results = buf.getLogs({ level: "warn", limit: 1 });
      expect(results).toHaveLength(1);
      expect(results[0]!.msg).toBe("error-b");
    });

    it("since + limit combined: since filters first, then limit trims to most recent", () => {
      for (let i = 0; i < 5; i++) {
        buf.ingest(makeEntry("info", 100 * (i + 1), `msg-${i}`));
      }
      // ts: 100, 200, 300, 400, 500; since=250 → 300,400,500; limit=2 → 400,500
      const results = buf.getLogs({ since: 250, limit: 2 });
      expect(results).toHaveLength(2);
      const tss = results.map((e) => e.ts);
      expect(tss).toContain(400);
      expect(tss).toContain(500);
    });
  });

  // ── empty buffer ──────────────────────────────────────────────────────────

  describe("empty buffer", () => {
    it("getLogs on empty buffer returns empty array", () => {
      expect(buf.getLogs({})).toHaveLength(0);
    });
  });

  // ── default capacity ──────────────────────────────────────────────────────

  describe("default capacity", () => {
    it("constructs without arguments (uses default capacity)", () => {
      const defaultBuf = new LogRingBuffer();
      const entry = defaultBuf.ingest(makeEntry("info", 1));
      expect(entry.id).toBeDefined();
      expect(defaultBuf.getLogs({})).toHaveLength(1);
    });
  });
});

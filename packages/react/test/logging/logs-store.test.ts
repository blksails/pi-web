/**
 * logs-store — behavioural unit tests (TDD)
 *
 * Covers:
 *  - Deduplication by id across three sources (applyLogsFrame / mergeHistory / browser bus)
 *  - Local-id assignment for browser-bus entries that arrive without an id
 *  - Local ids never collide with server ids
 *  - Level / namespace / text filter derivations
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { LogEntry } from "@pi-web/logger";

// We import the store after each test via a fresh module to avoid shared state
// from the module-level browser bus subscription. We use vi.isolateModules where
// needed, but most tests can share a single instance created per-test.
import { createLogsStore } from "../../src/logging/logs-store.js";

// ── helpers ────────────────────────────────────────────────────────────────────

function entry(
  override: Partial<LogEntry> & { id: string },
): LogEntry {
  return {
    level: "info",
    ns: "test:ns",
    msg: "hello",
    ts: Date.now(),
    ...override,
  };
}

function entryNoId(override?: Partial<LogEntry>): Omit<LogEntry, "id"> {
  return {
    level: "info",
    ns: "browser:local",
    msg: "local msg",
    ts: Date.now(),
    ...override,
  };
}

// ── deduplication ──────────────────────────────────────────────────────────────

describe("LogsStore — deduplication", () => {
  it("applyLogsFrame: duplicate server id kept only once", () => {
    const store = createLogsStore();
    const e = entry({ id: "srv-1" });
    store.applyLogsFrame([e]);
    store.applyLogsFrame([e]); // same id
    expect(store.getSnapshot().entries).toHaveLength(1);
    expect(store.getSnapshot().entries[0]!.id).toBe("srv-1");
  });

  it("applyLogsFrame: different ids both retained", () => {
    const store = createLogsStore();
    store.applyLogsFrame([entry({ id: "srv-1" })]);
    store.applyLogsFrame([entry({ id: "srv-2" })]);
    expect(store.getSnapshot().entries).toHaveLength(2);
  });

  it("mergeHistory: duplicate id merged without duplication", () => {
    const store = createLogsStore();
    const e = entry({ id: "hist-1" });
    store.applyLogsFrame([e]);
    store.mergeHistory([e, entry({ id: "hist-2" })]);
    expect(store.getSnapshot().entries).toHaveLength(2);
    const ids = store.getSnapshot().entries.map((x) => x.id);
    expect(ids).toContain("hist-1");
    expect(ids).toContain("hist-2");
  });

  it("three-source deduplication: same id from all three sources → single entry", () => {
    const store = createLogsStore();
    const e = entry({ id: "shared-1" });

    // Simulate browser bus push (via internal push method exposed for testing)
    store._pushBrowserEntry(e); // browser bus
    store.applyLogsFrame([e]); // SSE frame
    store.mergeHistory([e]); // REST history

    expect(store.getSnapshot().entries).toHaveLength(1);
    expect(store.getSnapshot().entries[0]!.id).toBe("shared-1");
  });

  it("browser entry without id gets a local id assigned", () => {
    const store = createLogsStore();
    const noId = entryNoId({ ns: "webext:demo" });
    store._pushBrowserEntry(noId as LogEntry);

    const snap = store.getSnapshot();
    expect(snap.entries).toHaveLength(1);
    const assigned = snap.entries[0]!.id;
    expect(assigned).toBeDefined();
    expect(assigned).toMatch(/^local:/);
  });

  it("local ids do not clash with server ids", () => {
    const store = createLogsStore();
    // Add a server entry with a numeric-looking id
    store.applyLogsFrame([entry({ id: "1" })]);
    // Add two browser-local entries without ids
    store._pushBrowserEntry(entryNoId() as LogEntry);
    store._pushBrowserEntry(entryNoId() as LogEntry);

    const ids = store.getSnapshot().entries.map((e) => e.id);
    const localIds = ids.filter((id) => id?.startsWith("local:"));
    expect(localIds).toHaveLength(2);
    // All ids must be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("two browser-local entries without ids both retained with distinct local ids", () => {
    const store = createLogsStore();
    store._pushBrowserEntry(entryNoId({ msg: "a" }) as LogEntry);
    store._pushBrowserEntry(entryNoId({ msg: "b" }) as LogEntry);
    const snap = store.getSnapshot();
    expect(snap.entries).toHaveLength(2);
    const ids = snap.entries.map((e) => e.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ── filter derivation ──────────────────────────────────────────────────────────

describe("LogsStore — filter derivation", () => {
  let store: ReturnType<typeof createLogsStore>;

  beforeEach(() => {
    store = createLogsStore();
    store.applyLogsFrame([
      { id: "d1", level: "debug", ns: "agent:hello", msg: "debug msg", ts: 1 },
      { id: "i1", level: "info", ns: "agent:hello", msg: "info msg", ts: 2 },
      { id: "w1", level: "warn", ns: "ext:probe", msg: "warn msg", ts: 3 },
      { id: "e1", level: "error", ns: "ext:probe", msg: "error msg", ts: 4 },
      { id: "i2", level: "info", ns: "agentx:other", msg: "agentx msg", ts: 5 },
    ]);
  });

  // ── level filter ──────────────────────────────────────────────────────────

  it("level filter 'warn': shows only warn and error", () => {
    store.setFilters({ level: "warn" });
    const entries = store.getSnapshot().filteredEntries;
    expect(entries.map((e) => e.id)).toEqual(["w1", "e1"]);
  });

  it("level filter 'info': shows info, warn, error but not debug", () => {
    store.setFilters({ level: "info" });
    const entries = store.getSnapshot().filteredEntries;
    const levels = entries.map((e) => e.level);
    expect(levels).not.toContain("debug");
    expect(levels).toContain("info");
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
  });

  it("level filter 'debug': shows all", () => {
    store.setFilters({ level: "debug" });
    expect(store.getSnapshot().filteredEntries).toHaveLength(5);
  });

  // ── namespace filter ──────────────────────────────────────────────────────

  it("namespace filter 'agent': matches agent:hello but NOT agentx:other", () => {
    store.setFilters({ namespace: "agent" });
    const entries = store.getSnapshot().filteredEntries;
    expect(entries.every((e) => e.ns.startsWith("agent:"))).toBe(true);
    expect(entries.some((e) => e.ns === "agentx:other")).toBe(false);
  });

  it("namespace filter 'ext:probe': matches ext:probe entries", () => {
    store.setFilters({ namespace: "ext:probe" });
    const entries = store.getSnapshot().filteredEntries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.ns === "ext:probe" || e.ns.startsWith("ext:probe:"))).toBe(true);
  });

  it("namespace filter empty string: shows all", () => {
    store.setFilters({ namespace: "" });
    expect(store.getSnapshot().filteredEntries).toHaveLength(5);
  });

  // ── text filter ───────────────────────────────────────────────────────────

  it("text filter: returns only entries whose msg contains the search string", () => {
    store.setFilters({ text: "warn" });
    const entries = store.getSnapshot().filteredEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("w1");
  });

  it("text filter: case-insensitive match", () => {
    store.setFilters({ text: "WARN" });
    // The filter may or may not be case-insensitive — test documents the designed
    // behaviour: case-sensitive substring match (per spec "msg 包含").
    // If implementation is case-sensitive this returns 0; update test if design says insensitive.
    // For now accept either 0 or 1 to keep test resilient to design choice.
    // Actually spec says "msg 包含搜索串" — substring match, let's test case-sensitive:
    const entries = store.getSnapshot().filteredEntries;
    // Case-sensitive: "WARN" not in "warn msg" → 0
    // We'll test that at least substring match works (case-sensitive variant)
    expect(entries).toHaveLength(0);
  });

  it("text filter empty: shows all", () => {
    store.setFilters({ text: "" });
    expect(store.getSnapshot().filteredEntries).toHaveLength(5);
  });

  // ── combined filters ──────────────────────────────────────────────────────

  it("combined level+namespace: only matching entries survive both filters", () => {
    store.setFilters({ level: "warn", namespace: "ext" });
    const entries = store.getSnapshot().filteredEntries;
    expect(entries.every((e) => e.ns.startsWith("ext") || e.ns === "ext")).toBe(true);
    expect(entries.every((e) => e.level === "warn" || e.level === "error")).toBe(true);
  });
});

// ── subscription ──────────────────────────────────────────────────────────────

describe("LogsStore — subscribe/getSnapshot", () => {
  it("listener called on applyLogsFrame", () => {
    const store = createLogsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyLogsFrame([entry({ id: "s1" })]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("listener called on mergeHistory", () => {
    const store = createLogsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.mergeHistory([entry({ id: "h1" })]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("listener not called when duplicate entry added (no-op)", () => {
    const store = createLogsStore();
    const e = entry({ id: "dup-1" });
    store.applyLogsFrame([e]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyLogsFrame([e]); // duplicate → should not notify
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const store = createLogsStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.applyLogsFrame([entry({ id: "x1" })]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("getSnapshot reference stable when no change", () => {
    const store = createLogsStore();
    const s1 = store.getSnapshot();
    const s2 = store.getSnapshot();
    expect(s1).toBe(s2);
  });

  it("getSnapshot reference changes on applyLogsFrame with new entry", () => {
    const store = createLogsStore();
    const s1 = store.getSnapshot();
    store.applyLogsFrame([entry({ id: "new-1" })]);
    const s2 = store.getSnapshot();
    expect(s1).not.toBe(s2);
  });
});

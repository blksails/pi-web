/**
 * use-logs — behavioural unit tests (TDD)
 *
 * Covers:
 *  - setFilters changes the returned entries
 *  - fetchHistory calls the injected fetcher and merges results
 *  - autoscroll state toggle
 *  - entries reflect underlying store
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { LogEntry } from "@pi-web/logger";
import { createLogsStore } from "../../src/logging/logs-store.js";
import { useLogs } from "../../src/hooks/use-logs.js";

// ── helpers ────────────────────────────────────────────────────────────────────

function entry(id: string, overrides?: Partial<LogEntry>): LogEntry {
  return {
    id,
    level: "info",
    ns: "test:ns",
    msg: `msg-${id}`,
    ts: Date.now(),
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("useLogs", () => {
  it("initially returns all entries from the store", () => {
    const store = createLogsStore();
    store.applyLogsFrame([entry("a"), entry("b")]);
    const { result } = renderHook(() => useLogs({ store }));
    expect(result.current.entries).toHaveLength(2);
  });

  it("setFilters changes returned entries (level filter)", () => {
    const store = createLogsStore();
    store.applyLogsFrame([
      entry("d1", { level: "debug" }),
      entry("w1", { level: "warn" }),
      entry("e1", { level: "error" }),
    ]);
    const { result } = renderHook(() => useLogs({ store }));
    act(() => {
      result.current.setFilters({ level: "warn" });
    });
    expect(result.current.entries.every((e) => e.level === "warn" || e.level === "error")).toBe(true);
    expect(result.current.entries.some((e) => e.level === "debug")).toBe(false);
  });

  it("setFilters reflects in filters state", () => {
    const store = createLogsStore();
    const { result } = renderHook(() => useLogs({ store }));
    act(() => {
      result.current.setFilters({ level: "error" });
    });
    expect(result.current.filters.level).toBe("error");
  });

  it("fetchHistory calls injected fetcher and merges entries", async () => {
    const store = createLogsStore();
    store.applyLogsFrame([entry("live-1")]);

    const histEntries = [entry("hist-1"), entry("hist-2")];
    const fetcher = vi.fn().mockResolvedValue(histEntries);

    const { result } = renderHook(() => useLogs({ store, fetcher }));

    await act(async () => {
      await result.current.fetchHistory({});
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const ids = result.current.entries.map((e) => e.id);
    expect(ids).toContain("live-1");
    expect(ids).toContain("hist-1");
    expect(ids).toContain("hist-2");
  });

  it("fetchHistory deduplicates: entry already in store not duplicated", async () => {
    const store = createLogsStore();
    const existing = entry("shared-1");
    store.applyLogsFrame([existing]);

    const fetcher = vi.fn().mockResolvedValue([existing, entry("new-1")]);
    const { result } = renderHook(() => useLogs({ store, fetcher }));

    await act(async () => {
      await result.current.fetchHistory({});
    });

    const ids = result.current.entries.map((e) => e.id);
    expect(ids.filter((id) => id === "shared-1")).toHaveLength(1);
    expect(ids).toContain("new-1");
  });

  it("autoscroll defaults to true", () => {
    const store = createLogsStore();
    const { result } = renderHook(() => useLogs({ store }));
    expect(result.current.autoscroll).toBe(true);
  });

  it("setAutoscroll toggles the autoscroll state", () => {
    const store = createLogsStore();
    const { result } = renderHook(() => useLogs({ store }));
    act(() => {
      result.current.setAutoscroll(false);
    });
    expect(result.current.autoscroll).toBe(false);
  });

  it("entries update reactively when store receives new frame", () => {
    const store = createLogsStore();
    const { result } = renderHook(() => useLogs({ store }));

    expect(result.current.entries).toHaveLength(0);

    act(() => {
      store.applyLogsFrame([entry("live-new")]);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]!.id).toBe("live-new");
  });
});

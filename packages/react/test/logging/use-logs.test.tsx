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

    // Auto-fetch fires on mount; manual call is additional — total ≥ 1 call.
    await act(async () => {
      await result.current.fetchHistory({});
    });

    // Auto-fetch (mount) + manual call = 2 total calls. The fetcher is called.
    expect(fetcher).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith({});
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

  // ── Auto-fetch on mount (task 7.2) ────────────────────────────────────────────

  it("auto-fetches history on mount when fetcher is provided", async () => {
    const store = createLogsStore();
    const histEntries = [entry("hist-auto-1"), entry("hist-auto-2")];
    const fetcher = vi.fn().mockResolvedValue(histEntries);

    await act(async () => {
      renderHook(() => useLogs({ store, fetcher }));
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith({});
    const snap = store.getSnapshot();
    const ids = snap.entries.map((e) => e.id);
    expect(ids).toContain("hist-auto-1");
    expect(ids).toContain("hist-auto-2");
  });

  it("does not auto-fetch when no fetcher is provided", async () => {
    const store = createLogsStore();

    await act(async () => {
      renderHook(() => useLogs({ store }));
    });

    // No fetcher — store should remain empty; no error thrown.
    expect(store.getSnapshot().entries).toHaveLength(0);
  });

  it("re-fetches history when fetcher reference changes (new session)", async () => {
    const store = createLogsStore();

    const fetcher1 = vi.fn().mockResolvedValue([entry("sess1-hist")]);
    const fetcher2 = vi.fn().mockResolvedValue([entry("sess2-hist")]);

    let currentFetcher = fetcher1;

    const { rerender } = renderHook(() => useLogs({ store, fetcher: currentFetcher }));

    await act(async () => {});

    expect(fetcher1).toHaveBeenCalledOnce();

    // Simulate new session: swap fetcher reference.
    currentFetcher = fetcher2;
    await act(async () => {
      rerender();
    });

    expect(fetcher2).toHaveBeenCalledOnce();
    const ids = store.getSnapshot().entries.map((e) => e.id);
    expect(ids).toContain("sess1-hist");
    expect(ids).toContain("sess2-hist");
  });

  it("auto-fetch deduplicates: live entries already in store not duplicated", async () => {
    const store = createLogsStore();
    // Pre-load a live entry.
    store.applyLogsFrame([entry("live-dup")]);

    // Fetcher returns the same entry plus a new one.
    const fetcher = vi.fn().mockResolvedValue([entry("live-dup"), entry("hist-only")]);

    await act(async () => {
      renderHook(() => useLogs({ store, fetcher }));
    });

    const ids = store.getSnapshot().entries.map((e) => e.id);
    expect(ids.filter((id) => id === "live-dup")).toHaveLength(1);
    expect(ids).toContain("hist-only");
  });

  it("auto-fetch swallows errors without crashing", async () => {
    const store = createLogsStore();
    const fetcher = vi.fn().mockRejectedValue(new Error("network error"));

    await act(async () => {
      renderHook(() => useLogs({ store, fetcher }));
    });

    // Hook should still render without throwing; store unchanged.
    expect(store.getSnapshot().entries).toHaveLength(0);
  });
});

/**
 * useLogs — React hook for the logs store.
 *
 * Subscribes to a LogsStore instance via useSyncExternalStore and exposes:
 *  - entries: filtered log entries (derived from current filters)
 *  - filters: current filter state
 *  - setFilters: partial filter update
 *  - fetchHistory: pull REST history via an injected fetcher, then mergeHistory
 *  - autoscroll: boolean state flag (DOM scroll behaviour is in LogsPanel, task 2.5)
 *  - setAutoscroll: toggle autoscroll
 *
 * The `store` parameter is the source of truth for entries; the hook holds no
 * entry state of its own — it only holds UI-layer state (autoscroll).
 *
 * Requirements: 5.3–5.5 (filter derivation), 4.5 (history merge), 5.6 (autoscroll flag)
 */

import { useSyncExternalStore, useState, useCallback, useEffect } from "react";
import type { LogsStore, LogFilters } from "../logging/logs-store.js";
import type { LogEntry } from "@blksails/pi-web-logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HistoryQuery = Partial<{
  level: string;
  limit: number;
  since: number;
}>;

/**
 * Fetcher injected by the caller (real REST client wired in task 3.2).
 * Receives a query object and returns a promise of log entries.
 */
export type LogHistoryFetcher = (query: HistoryQuery) => Promise<LogEntry[]>;

export interface UseLogsOptions {
  /** The logs store to subscribe to. */
  store: LogsStore;
  /**
   * Optional fetcher for REST history (task 3.2 wires this up).
   * If omitted, fetchHistory is a no-op.
   */
  fetcher?: LogHistoryFetcher;
}

export interface UseLogsResult {
  /** Filtered log entries. */
  readonly entries: readonly LogEntry[];
  /** Current filter state. */
  readonly filters: LogFilters;
  /** Partial filter update — triggers re-render via store. */
  setFilters: (partial: Partial<LogFilters>) => void;
  /**
   * Pull REST history via the injected fetcher and merge into the store.
   * If no fetcher was provided, this is a no-op.
   */
  fetchHistory: (query: HistoryQuery) => Promise<void>;
  /** Whether the panel should auto-scroll to the latest entry. */
  readonly autoscroll: boolean;
  setAutoscroll: (v: boolean) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLogs({ store, fetcher }: UseLogsOptions): UseLogsResult {
  // Subscribe to store via useSyncExternalStore for tear-free reads.
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // UI-layer state: autoscroll (does not live in the store).
  const [autoscroll, setAutoscroll] = useState(true);

  const setFilters = useCallback(
    (partial: Partial<LogFilters>) => {
      store.setFilters(partial);
    },
    [store],
  );

  const fetchHistory = useCallback(
    async (query: HistoryQuery): Promise<void> => {
      if (!fetcher) return;
      const entries = await fetcher(query);
      store.mergeHistory(entries);
    },
    [store, fetcher],
  );

  // Auto-fetch history on mount and whenever the fetcher changes (new session).
  // Errors are swallowed to avoid crashing the panel if the REST endpoint is
  // temporarily unavailable.
  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    fetcher({})
      .then((entries) => {
        if (!cancelled) store.mergeHistory(entries);
      })
      .catch(() => {
        // Silently ignore history fetch errors.
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, store]);

  return {
    entries: snapshot.filteredEntries,
    filters: snapshot.filters,
    setFilters,
    fetchHistory,
    autoscroll,
    setAutoscroll,
  };
}

/**
 * logsStore — framework-agnostic, subscribable log entry store.
 *
 * Aggregates three sources of log entries:
 *  1. Browser bus (webext / in-browser createLogger calls) via subscribeBrowserLogs.
 *  2. Real-time Node logs pushed as `control:"logs"` SSE frames (via applyLogsFrame).
 *  3. REST history pulled on demand (via mergeHistory).
 *
 * All three sources are deduplicated by `id`. Server-assigned ids are stable; browser-local
 * entries that arrive without an id receive a `local:<seq>` id that never collides with
 * server ids (which are numeric strings or UUIDs without a "local:" prefix).
 *
 * Exposes getSnapshot() + subscribe() for useSyncExternalStore integration (React 18+).
 *
 * Design aligns with ControlStore in packages/react/src/sse/control-store.ts:
 *  - Immutable snapshot on every change.
 *  - Listeners notified only on actual state change (duplicates are no-ops).
 *  - No React or framework dependencies in this file.
 *
 * Requirements: 3.2, 3.4, 4.5, 5.3–5.5
 */

import { subscribeBrowserLogs, isLevelEnabled } from "@pi-web/logger";
import type { LogEntry, LogLevel } from "@pi-web/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogFilters {
  /** Minimum severity level (inclusive). Default: "debug" (show all). */
  level: LogLevel;
  /**
   * Namespace prefix filter. Empty string or undefined means "show all".
   * Matching follows colon-segment prefix rules: "agent" matches "agent:hello"
   * and "agent:hello:tool" but NOT "agentx:other" (inline prefix match: ns === filter
   * or ns startsWith filter + ":").
   */
  namespace: string;
  /** Substring text filter on msg. Case-sensitive. Empty string means "show all". */
  text: string;
}

export interface LogsSnapshot {
  /** All stored entries, ordered by insertion time (oldest first). */
  readonly entries: readonly LogEntry[];
  /** Entries after applying the current filters. */
  readonly filteredEntries: readonly LogEntry[];
  /** Current filter state. */
  readonly filters: LogFilters;
}

type Listener = () => void;

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEFAULT_FILTERS: LogFilters = {
  level: "debug",
  namespace: "",
  text: "",
};

/** Local id sequence for browser-local entries that arrive without an id. */
let _localSeq = 0;

function nextLocalId(): string {
  _localSeq += 1;
  return `local:${_localSeq}`;
}

/**
 * Apply all three filter conditions to a list of entries.
 * Returns only entries that pass every active filter.
 */
function applyFilters(
  entries: readonly LogEntry[],
  filters: LogFilters,
): readonly LogEntry[] {
  return entries.filter((e) => {
    // Level: entry must meet or exceed the filter level.
    if (!isLevelEnabled(e.level, filters.level)) return false;

    // Namespace: if a non-empty filter is set, use prefix-segment matching.
    if (filters.namespace !== "") {
      // Build a synthetic namespaces map where only the filter prefix is enabled.
      // We want: ns matches if ns === filter OR ns.startsWith(filter + ":").
      const ns = filters.namespace;
      if (e.ns !== ns && !e.ns.startsWith(ns + ":")) return false;
    }

    // Text: case-sensitive substring match on msg.
    if (filters.text !== "" && !e.msg.includes(filters.text)) return false;

    return true;
  });
}

// ── LogsStore ─────────────────────────────────────────────────────────────────

export interface LogsStore {
  /** Subscribe to snapshot changes (useSyncExternalStore compatible). Returns unsubscribe fn. */
  subscribe(listener: Listener): () => void;
  /** Return the current immutable snapshot (stable reference when nothing changed). */
  getSnapshot(): LogsSnapshot;
  /**
   * Ingest entries from a `control:"logs"` SSE frame (real-time Node logs).
   * Deduplicates by id — entries with already-known ids are silently ignored.
   */
  applyLogsFrame(entries: LogEntry[]): void;
  /**
   * Merge REST history entries into the store.
   * Deduplicates by id.
   */
  mergeHistory(entries: LogEntry[]): void;
  /**
   * Update active filters and re-derive filteredEntries.
   * Partial update: only provided keys are overwritten.
   */
  setFilters(partial: Partial<LogFilters>): void;
  /**
   * Internal: push a single entry from the browser bus.
   * If the entry has no id, a local id is assigned.
   * Exposed as `_pushBrowserEntry` for tests; in production it's wired via
   * subscribeBrowserLogs inside createLogsStore.
   */
  _pushBrowserEntry(entry: LogEntry): void;
}

/**
 * Factory: creates a new LogsStore instance and subscribes it to the browser
 * log bus. Returns the store.
 *
 * Callers must not share a single store across sessions; each session should
 * create its own store.
 */
export function createLogsStore(): LogsStore {
  // Mutable internal state
  const _seenIds = new Set<string>();
  let _entries: LogEntry[] = [];
  let _filters: LogFilters = { ...DEFAULT_FILTERS };
  let _snapshot: LogsSnapshot = buildSnapshot(_entries, _filters);
  const _listeners = new Set<Listener>();

  function buildSnapshot(
    entries: readonly LogEntry[],
    filters: LogFilters,
  ): LogsSnapshot {
    return {
      entries: entries,
      filteredEntries: applyFilters(entries, filters),
      filters: { ...filters },
    };
  }

  function emit(): void {
    _snapshot = buildSnapshot(_entries, _filters);
    for (const listener of _listeners) listener();
  }

  /**
   * Attempt to add an entry. Returns true if the entry was new (added), false
   * if it was a duplicate (ignored). Assigns a local id if none is present.
   */
  function addEntry(raw: LogEntry): boolean {
    // Assign local id if missing (browser-local entries).
    const e: LogEntry = raw.id !== undefined ? raw : { ...raw, id: nextLocalId() };

    if (_seenIds.has(e.id!)) return false; // duplicate

    _seenIds.add(e.id!);
    _entries = [..._entries, e];
    return true;
  }

  const store: LogsStore = {
    subscribe(listener: Listener): () => void {
      _listeners.add(listener);
      return () => {
        _listeners.delete(listener);
      };
    },

    getSnapshot(): LogsSnapshot {
      return _snapshot;
    },

    applyLogsFrame(entries: LogEntry[]): void {
      let changed = false;
      for (const e of entries) {
        if (addEntry(e)) changed = true;
      }
      if (changed) emit();
    },

    mergeHistory(entries: LogEntry[]): void {
      let changed = false;
      for (const e of entries) {
        if (addEntry(e)) changed = true;
      }
      if (changed) emit();
    },

    setFilters(partial: Partial<LogFilters>): void {
      _filters = { ..._filters, ...partial };
      emit();
    },

    _pushBrowserEntry(raw: LogEntry): void {
      if (addEntry(raw)) emit();
    },
  };

  // Wire up browser bus subscription (fire-and-forget; store owns the subscription).
  subscribeBrowserLogs((entry) => {
    store._pushBrowserEntry(entry);
  });

  return store;
}

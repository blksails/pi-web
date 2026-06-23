/**
 * @pi-web/server — logging/log-ring-buffer
 *
 * Per-session fixed-capacity ring buffer for log entries.
 *
 * Design decisions:
 *  - Uses a simple array with a head-pointer rather than an actual circular
 *    structure; this keeps `getLogs` O(n) without extra complexity.
 *  - Monotonically increasing ids are plain string-coerced integers (e.g. "1",
 *    "2", …). They are unique per-buffer and compare correctly with Number().
 *  - `getLogs` applies filters in order: level → since → limit (most recent N).
 *    "most recent" means highest-insertion-order within the surviving entries.
 *
 * Requirements: 4.1, 4.3, 4.4, 9.2
 */

import { LogEntrySchema, type LogLevel } from "@pi-web/protocol";
import type { z } from "zod";

/** Inferred wire-level LogEntry type from the protocol schema. */
type LogEntry = z.infer<typeof LogEntrySchema>;

/** Numeric severity ordering (lower index = lower severity). */
const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function levelRank(level: LogLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export class LogRingBuffer {
  /** Fixed capacity; oldest entry is evicted when full. */
  private readonly capacity: number;

  /** Circular storage array; slots may be empty when count < capacity. */
  private readonly ring: ((LogEntry & { id: string }) | undefined)[];

  /** Write-head pointer (next write position). */
  private head = 0;

  /** Total number of entries ever ingested (≥ ring.length). */
  private count = 0;

  /** Monotonically increasing id counter. */
  private nextId = 1;

  constructor(capacity = 2000) {
    if (capacity <= 0) throw new RangeError("capacity must be > 0");
    this.capacity = capacity;
    this.ring = new Array(capacity);
  }

  /**
   * Ingest a log entry into the buffer.
   *
   * - Assigns a monotonically increasing string id.
   * - Stores in the ring (evicting oldest if full).
   * - Returns the stored entry (with id attached).
   */
  ingest(entry: Omit<LogEntry, "id"> & { id?: string }): LogEntry & { id: string } {
    const stored: LogEntry & { id: string } = {
      ...entry,
      id: String(this.nextId++),
    };

    this.ring[this.head] = stored;
    this.head = (this.head + 1) % this.capacity;
    this.count++;

    return stored;
  }

  /**
   * Query the buffer with optional filters.
   *
   * Filters applied in order:
   *  1. level  — entry.level severity ≥ query.level
   *  2. since  — entry.ts ≥ query.since
   *  3. limit  — return the most recent `limit` entries from the remaining set
   *
   * Returns entries in insertion order (oldest first among the surviving set).
   */
  getLogs(query: {
    level?: LogLevel;
    limit?: number;
    since?: number;
  }): (LogEntry & { id: string })[] {
    const { level, limit, since } = query;

    // Reconstruct insertion-ordered entries from the ring.
    const size = Math.min(this.count, this.capacity);
    const ordered: (LogEntry & { id: string })[] = [];

    if (size === 0) return ordered;

    // When the buffer is full the oldest entry is at `head`; when not yet full
    // the oldest is at index 0. We iterate from oldest to newest.
    if (this.count <= this.capacity) {
      // Buffer not yet full — entries occupy [0, count) in insertion order.
      for (let i = 0; i < this.count; i++) {
        const entry = this.ring[i];
        if (entry !== undefined) ordered.push(entry);
      }
    } else {
      // Buffer full — `head` points to the oldest entry (about to be overwritten).
      for (let i = 0; i < this.capacity; i++) {
        const entry = this.ring[(this.head + i) % this.capacity];
        if (entry !== undefined) ordered.push(entry);
      }
    }

    // Apply level filter (severity ≥ selected level).
    let filtered = level !== undefined
      ? ordered.filter((e) => levelRank(e.level) >= levelRank(level))
      : ordered;

    // Apply since filter (ts ≥ since).
    if (since !== undefined) {
      filtered = filtered.filter((e) => e.ts >= since);
    }

    // Apply limit: take the most recent N entries.
    if (limit !== undefined) {
      if (limit <= 0) return [];
      if (filtered.length > limit) {
        filtered = filtered.slice(filtered.length - limit);
      }
    }

    return filtered;
  }
}

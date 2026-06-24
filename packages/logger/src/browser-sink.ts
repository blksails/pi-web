/**
 * @blksails/pi-web-logger — Browser in-memory ring-buffer bus
 *
 * Provides a module-level, fixed-capacity ring buffer for log entries in the
 * browser environment. Subscribers (e.g. logsStore) are notified on every push.
 * When the buffer is full, the oldest entry is evicted before the new one is
 * appended — maintaining O(1) bounded memory usage (Requirement 1.5 / 3.4).
 *
 * Zero Node-specific imports. No `process`, no `fs`, no `node:*`.
 */

import type { LogEntry, Sink } from "./types.js";

/** Maximum number of log entries retained in the in-browser ring buffer. */
export const BROWSER_LOG_CAPACITY = 2000;

// ── Module-level state ────────────────────────────────────────────────────────

/** Bounded ring buffer holding the most recent log entries. */
const _buffer: LogEntry[] = [];

/** Registered subscriber callbacks. */
const _subscribers: Array<(entry: LogEntry) => void> = [];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a callback that is invoked synchronously on every new log entry.
 * Returns an unsubscribe function.
 */
export function subscribeBrowserLogs(
  cb: (entry: LogEntry) => void,
): () => void {
  _subscribers.push(cb);
  return () => {
    const idx = _subscribers.indexOf(cb);
    if (idx !== -1) _subscribers.splice(idx, 1);
  };
}

/**
 * Return a snapshot of the current buffer contents (oldest → newest).
 * The array is a shallow copy — mutations do not affect the internal buffer.
 */
export function getBrowserLogs(): LogEntry[] {
  return [..._buffer];
}

/**
 * Browser sink: push a log entry into the ring buffer and notify subscribers.
 * If the buffer is at capacity, the oldest entry is evicted first.
 */
export const browserSink: Sink = (entry: LogEntry): void => {
  // Evict oldest when at capacity
  if (_buffer.length >= BROWSER_LOG_CAPACITY) {
    _buffer.shift();
  }

  _buffer.push(entry);

  // Notify all subscribers synchronously
  for (const cb of _subscribers) {
    try {
      cb(entry);
    } catch {
      // Subscriber errors must not prevent other subscribers from being notified.
    }
  }
};

/**
 * @pi-web/logger — Node stderr sink
 *
 * Writes structured log entries to process stderr using a sentinel prefix so
 * the main process can reliably distinguish log lines from RPC protocol output.
 *
 * IMPORTANT: This module MUST NOT use any static `import ... from "node:..."` imports.
 * All Node-specific API access is guarded via `globalThis.process` to preserve
 * isomorphic purity and prevent browser bundle pollution (Requirement 1.6).
 */

import type { LogEntry, Sink } from "./types.js";

/**
 * LOG_SENTINEL is a rare, invisible-in-normal-text prefix prepended to every
 * serialized log line written to stderr. It allows the main process to
 * distinguish log lines from other stderr output (e.g. native Node diagnostics).
 *
 * Chosen to be:
 *  - Unlikely to appear in regular output (non-printable + distinctive tag)
 *  - Compact (no excessive byte overhead per line)
 *  - Easy to grep / parse: starts with ASCII ESC-like prefix + " PILOG "
 */
export const LOG_SENTINEL = "\x02PILOG\x03 ";

/**
 * Serialize a LogEntry into a single log line ready for stderr output.
 * Format: `LOG_SENTINEL + JSON.stringify(entry) + "\n"`
 */
export function serializeLogLine(entry: LogEntry): string {
  return LOG_SENTINEL + JSON.stringify(entry) + "\n";
}

/**
 * Node stderr sink.
 *
 * Writes the serialized log line to `process.stderr` via guarded global access.
 * Write failures are silently swallowed — a log sink must never crash the
 * process it is monitoring (Requirement 7.4 / error strategy).
 */
export const nodeSink: Sink = (entry: LogEntry): void => {
  try {
    const line = serializeLogLine(entry);
    // Guard: access stderr only if process and stderr.write exist.
    // This prevents any module-level side-effects in browser builds.
    (globalThis as Record<string, unknown> & {
      process?: { stderr?: { write?: (s: string) => void } };
    }).process?.stderr?.write?.(line);
  } catch {
    // Swallow all errors — sink failures must not propagate (R7.4).
  }
};

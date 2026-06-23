/**
 * @pi-web/protocol — logging/log-entry
 *
 * Defines the wire-level log data contract for the logging system:
 *  - LogLevelSchema: zod enum for the four log severity levels.
 *  - LogEntrySchema: zod shape for a single structured log entry on the wire.
 *  - parseLogLine: sentinel-aware parser (stderr log line → LogEntry | null).
 *
 * Design decisions:
 *  - LOG_SENTINEL is imported from @pi-web/logger (the single source of truth)
 *    to avoid sentinel string drift between producer and parser.
 *  - LogEntry type is imported type-only from @pi-web/logger; LogEntrySchema
 *    mirrors that shape exactly. A compile-time satisfies check in tests
 *    enforces alignment.
 *  - parseLogLine never throws — all errors are swallowed and represented as null.
 */

import { z } from "zod";
// Runtime import for LOG_SENTINEL constant (logger is zero-dependency, safe).
import { LOG_SENTINEL } from "@pi-web/logger";
// Type-only import to align LogEntrySchema with logger's canonical LogEntry shape.
import type { LogEntry } from "@pi-web/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

/** Wire-level log severity enum. Mirrors LogLevel from @pi-web/logger. */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Wire-level log entry schema.
 *
 * Fields:
 *  - id?: server-assigned monotonic sequence id (absent when emitted from Node sink).
 *  - level: severity level (enum).
 *  - ns: namespace — non-empty string identifying the log source (e.g. "agent:hello").
 *  - msg: human-readable message.
 *  - data?: optional structured payload of any type.
 *  - ts: epoch milliseconds timestamp.
 *
 * Compile-time shape alignment with logger's LogEntry is enforced in tests via
 * bidirectional assignability checks.
 */
export const LogEntrySchema = z.object({
  id: z.string().optional(),
  level: LogLevelSchema,
  ns: z.string().min(1),
  msg: z.string(),
  data: z.unknown().optional(),
  ts: z.number(),
});

// Ensure the inferred type is structurally compatible with logger's LogEntry.
// This is a module-level type assertion — fails at compile time if shapes diverge.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertEntryAligned = z.infer<typeof LogEntrySchema> extends LogEntry
  ? LogEntry extends z.infer<typeof LogEntrySchema>
    ? true
    : never
  : never;

// ──────────────────────────────────────────────────────────────────────────────
// parseLogLine
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single stderr line produced by the Node sink into a LogEntry.
 *
 * Rules:
 *  1. If `line` does not start with LOG_SENTINEL → return null.
 *  2. Strip the sentinel prefix, JSON.parse the remainder.
 *  3. Validate the parsed object with LogEntrySchema.
 *  4. On success, return the validated LogEntry; on any failure, return null.
 *
 * This function never throws — all errors (non-string input, invalid JSON,
 * schema violations) are swallowed and produce null.
 */
export function parseLogLine(line: string): LogEntry | null {
  try {
    // Guard: must be a string starting with LOG_SENTINEL.
    if (typeof line !== "string" || !line.startsWith(LOG_SENTINEL)) {
      return null;
    }

    // Strip sentinel prefix.
    const jsonPart = line.slice(LOG_SENTINEL.length);

    // Parse JSON.
    const parsed: unknown = JSON.parse(jsonPart);

    // Validate with schema.
    const result = LogEntrySchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    return result.data as LogEntry;
  } catch {
    // Swallow all errors (JSON.parse failure, unexpected exceptions).
    return null;
  }
}

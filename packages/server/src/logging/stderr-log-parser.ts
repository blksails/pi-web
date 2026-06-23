/**
 * @pi-web/server — logging/stderr-log-parser
 *
 * Stateful line-buffered parser for a subprocess stderr stream.
 *
 * Contract (Req 2.5, 4.3):
 *  - Sentinel lines (prefix LOG_SENTINEL from @pi-web/logger) → parsed as LogEntry
 *    with their original namespace preserved (e.g. "agent:*").
 *  - Non-sentinel non-empty text lines → wrapped as LogEntry with ns="proc:stderr",
 *    level="warn", and ts=Date.now() (Req 4.3, R1 proc:stderr wrapping).
 *  - Empty / whitespace-only lines → silently ignored (no noise).
 *  - Handles cross-chunk boundaries: a partial line is retained in the internal
 *    buffer until the next chunk supplies its newline.
 *
 * NOTE: This module does not assign ids to entries — that is the responsibility
 * of LogRingBuffer.ingest(). StderrLogParser simply produces raw LogEntry objects
 * (no id field) from the sentinel-formatted lines.
 *
 * Requirements: 2.5, 4.3
 */

import { parseLogLine, LogEntrySchema } from "@pi-web/protocol";
import { LOG_SENTINEL } from "@pi-web/logger";
import type { z } from "zod";

/** Inferred wire-level LogEntry type (id is optional). */
type LogEntry = z.infer<typeof LogEntrySchema>;

export class StderrLogParser {
  /** Incomplete line accumulated across ingestChunk calls. */
  private lineBuffer = "";

  /**
   * Feed a raw stderr chunk (string) into the parser.
   *
   * Splits on "\n", completes any buffered partial line, calls `parseLogLine`
   * on each complete line, and returns all successfully parsed LogEntry objects
   * from this chunk. Non-sentinel or malformed lines produce no output.
   *
   * @param chunk - A raw string chunk from a subprocess stderr stream.
   * @returns Array of LogEntry objects parsed from this chunk (may be empty).
   */
  ingestChunk(chunk: string): LogEntry[] {
    const results: LogEntry[] = [];

    // Prepend any buffered partial line from the previous chunk.
    const combined = this.lineBuffer + chunk;
    const parts = combined.split("\n");

    // All but the last element are complete lines (split always produces at
    // least one element; the last may be empty or a partial line).
    const completedLines = parts.slice(0, -1);
    // The final element is either "" (chunk ended with \n) or a partial line.
    // `split` always returns at least one element, so this is never undefined.
    this.lineBuffer = parts[parts.length - 1] ?? "";

    for (const line of completedLines) {
      if (line.startsWith(LOG_SENTINEL)) {
        // Sentinel line: parse as structured LogEntry (preserves original ns).
        const entry = parseLogLine(line);
        if (entry !== null) {
          results.push(entry);
        }
        // Malformed sentinel (invalid JSON / schema) → silently dropped.
      } else if (line.trim().length > 0) {
        // Non-sentinel non-empty line: wrap as a raw proc:stderr entry.
        results.push({
          level: "warn",
          ns: "proc:stderr",
          msg: line,
          ts: Date.now(),
        });
      }
      // Empty / whitespace-only lines are silently ignored.
    }

    return results;
  }
}

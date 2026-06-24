/**
 * @blksails/pi-web-protocol — logging barrel
 *
 * Exports all public symbols from the logging sub-module:
 *  - LogLevelSchema, LogLevel (wire-level severity enum)
 *  - LogEntrySchema (wire-level log entry zod schema)
 *  - parseLogLine (sentinel-aware stderr line parser)
 */
export { LogLevelSchema, LogEntrySchema, parseLogLine } from "./log-entry.js";
export type { LogLevel } from "./log-entry.js";
// Convenience type alias: inferred shape of the wire-level log entry schema.
import type { z } from "zod";
import { LogEntrySchema } from "./log-entry.js";
export type LogEntry = z.infer<typeof LogEntrySchema>;

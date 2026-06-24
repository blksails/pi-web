/**
 * @blksails/pi-web-logger — core type definitions
 *
 * Zero runtime dependencies. No Node-specific or browser-specific imports.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Assigned by the server on ingestion (monotonic seq); browser-local logs use a local id. */
  id?: string;
  level: LogLevel;
  /** Namespace, e.g. "agent:hello" */
  ns: string;
  msg: string;
  /** Optional structured data */
  data?: unknown;
  /** Epoch milliseconds */
  ts: number;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Returns a child Logger whose namespace is `<parentNs>:<ns>` */
  child(ns: string): Logger;
}

export interface LoggerRuntimeConfig {
  enabled: boolean;
  level: LogLevel;
  /** Namespace → enabled; absent key defaults to true (open). */
  namespaces?: Record<string, boolean>;
}

/**
 * Sink interface: receives a fully-constructed LogEntry after all gating passes.
 * The default sink is a no-op; task 1.3 will supply Node stderr / browser bus sinks.
 */
export type Sink = (entry: LogEntry) => void;

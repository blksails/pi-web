/**
 * @blksails/pi-web-logger — createLogger factory
 *
 * Three-gate gating logic (applied in order, short-circuit on first drop):
 *   1. enabled gate  — global kill-switch (LoggerRuntimeConfig.enabled)
 *   2. level gate    — entry level must meet or exceed the effective threshold
 *   3. namespace gate — namespace must not be explicitly disabled
 *
 * The effective level threshold is the stricter of:
 *   - the level passed to createLogger (per-logger static config)
 *   - the runtime level from configureLogger (global dynamic config)
 *
 * Zero runtime dependencies. No Node-specific or browser-specific imports.
 */

import type { Logger, LogEntry, LogLevel, Sink } from "./types.js";
import { getRuntimeConfig, getFileSink } from "./config.js";
import { isLevelEnabled, isNamespaceEnabled } from "./level.js";
import { getDefaultSink } from "./sink.js";

/** Options accepted by createLogger. */
export interface CreateLoggerOptions {
  /** Root namespace for this logger instance. */
  namespace: string;
  /** Per-logger static level floor (optional; runtime config may be stricter). */
  level?: LogLevel;
  /**
   * Injectable sink for testing or environment-specific output.
   * Task 1.3 will supply concrete Node stderr / browser bus sinks.
   * Defaults to a no-op sink.
   */
  sink?: Sink;
}

/**
 * Create a Logger bound to `namespace`.
 *
 * The returned Logger reads the global runtime config on every call, so
 * `configureLogger()` changes take effect immediately without recreating loggers.
 */
export function createLogger(opts: CreateLoggerOptions): Logger {
  const { namespace, level: staticLevel } = opts;
  // Track whether the caller supplied an explicit sink or we should use the default.
  const explicitSink: Sink | undefined = opts.sink;
  const sink: Sink = explicitSink ?? getDefaultSink();

  function emit(level: LogLevel, msg: string, data?: unknown): void {
    // ── Gate 1: global enabled ──────────────────────────────────────────────
    const cfg = getRuntimeConfig();
    if (!cfg.enabled) return;

    // ── Gate 2: level ───────────────────────────────────────────────────────
    // Effective threshold = stricter of static per-logger level & runtime level.
    const runtimeLevel = cfg.level;
    const effectiveLevel: LogLevel = pickStricter(staticLevel, runtimeLevel);
    if (!isLevelEnabled(level, effectiveLevel)) return;

    // ── Gate 3: namespace ───────────────────────────────────────────────────
    if (!isNamespaceEnabled(namespace, cfg.namespaces)) return;

    // ── Produce entry ───────────────────────────────────────────────────────
    const entry: LogEntry =
      data !== undefined
        ? { level, ns: namespace, msg, data, ts: Date.now() }
        : { level, ns: namespace, msg, ts: Date.now() };

    try {
      sink(entry);
    } catch {
      // Sink errors must never propagate — graceful degradation (R7.4 / error strategy).
      // Use console.error to avoid recursion into the logger itself.
      console.error("[pi-web/logger] sink threw an error", entry);
    }

    // ── File output (additive, only when using default sink) ───────────────
    // When the caller did not inject an explicit sink we also forward the entry
    // to the globally configured file sink (if any).  Explicit-sink loggers are
    // test-/tool-specific and are intentionally not forwarded.
    if (explicitSink === undefined) {
      try {
        getFileSink()?.(entry);
      } catch {
        // File sink errors must never propagate (R7.4).
        console.error("[pi-web/logger] file sink threw an error", entry);
      }
    }
  }

  const logger: Logger = {
    debug(msg, data?) {
      emit("debug", msg, data);
    },
    info(msg, data?) {
      emit("info", msg, data);
    },
    warn(msg, data?) {
      emit("warn", msg, data);
    },
    error(msg, data?) {
      emit("error", msg, data);
    },
    child(childNs: string): Logger {
      return createLogger({
        namespace: `${namespace}:${childNs}`,
        level: staticLevel, // inherit static level
        sink,               // inherit sink
      });
    },
  };

  return logger;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Returns the stricter (higher-severity) of two levels.
 * If `a` is undefined, returns `b`.
 */
function pickStricter(
  a: LogLevel | undefined,
  b: LogLevel,
): LogLevel {
  if (a === undefined) return b;
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

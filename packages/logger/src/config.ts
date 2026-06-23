/**
 * @pi-web/logger — runtime configuration store
 *
 * Module-level singleton holding the current LoggerRuntimeConfig.
 * Mutated via configureLogger(); read by create-logger.ts on every log call.
 *
 * Also owns the optional file-output sink reference (configureFileOutput /
 * getFileSink), wired in here so create-logger can pick it up via the
 * default-sink path without a circular dependency.
 *
 * Zero runtime dependencies. No Node-specific or browser-specific imports
 * (file-sink.ts itself guards all fs access).
 */

import type { LoggerRuntimeConfig, LogLevel, Sink } from "./types.js";
import type { FileOutputConfig } from "./file-sink.js";
import { createFileSink } from "./file-sink.js";

// ── Logger runtime config ─────────────────────────────────────────────────

const _config: LoggerRuntimeConfig = {
  enabled: true,
  level: "debug",
  namespaces: {},
};

/** Read the current runtime config (live reference — do not mutate directly). */
export function getRuntimeConfig(): Readonly<LoggerRuntimeConfig> {
  return _config;
}

/**
 * Merge `partial` into the current runtime config.
 * Subsequent createLogger() calls — and every log call — will respect the new config.
 */
export function configureLogger(
  partial: Partial<LoggerRuntimeConfig>,
): void {
  if (partial.enabled !== undefined) _config.enabled = partial.enabled;
  if (partial.level !== undefined) _config.level = partial.level as LogLevel;
  if (partial.namespaces !== undefined) _config.namespaces = partial.namespaces;
}

/**
 * Initialize Node-side logger configuration from environment variables.
 *
 * Reads the following variables (all optional; absent → keep current default):
 *   - PI_WEB_LOG_LEVEL      — one of "debug" | "info" | "warn" | "error"
 *   - PI_WEB_LOG_ENABLED    — "false" to disable; any other value → enabled
 *   - PI_WEB_LOG_NAMESPACES — comma-separated list of namespace names to enable
 *                             (sets each listed namespace to `true`; others unaffected)
 *
 * All access to `process.env` is guarded via `globalThis.process?.env` so this
 * function is safe to call in browser environments (no-op when process is absent).
 *
 * Intended to be called once at application startup on the Node side.
 */
export function initConfigFromEnv(): void {
  // Guard: safe in browser environments where process is unavailable.
  const env = (
    globalThis as Record<string, unknown> & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;

  if (!env) return;

  const partial: Partial<LoggerRuntimeConfig> = {};

  // PI_WEB_LOG_ENABLED
  const rawEnabled = env["PI_WEB_LOG_ENABLED"];
  if (rawEnabled !== undefined) {
    partial.enabled = rawEnabled.toLowerCase() !== "false";
  }

  // PI_WEB_LOG_LEVEL
  const rawLevel = env["PI_WEB_LOG_LEVEL"];
  if (rawLevel !== undefined) {
    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const level = rawLevel.toLowerCase() as LogLevel;
    if (validLevels.includes(level)) {
      partial.level = level;
    }
  }

  // PI_WEB_LOG_NAMESPACES — comma-separated list, each set to enabled:true
  const rawNs = env["PI_WEB_LOG_NAMESPACES"];
  if (rawNs !== undefined && rawNs.trim().length > 0) {
    const current = _config.namespaces ?? {};
    const updated: Record<string, boolean> = { ...current };
    for (const ns of rawNs.split(",")) {
      const trimmed = ns.trim();
      if (trimmed.length > 0) {
        updated[trimmed] = true;
      }
    }
    partial.namespaces = updated;
  }

  configureLogger(partial);

  // ── File output from env ────────────────────────────────────────────────
  // PI_WEB_LOG_FILE         — absolute path to log file (enables file output)
  // PI_WEB_LOG_FILE_MAXSIZE — max file size in MB before rotation (default: 10)
  // PI_WEB_LOG_FILE_MAXFILES — max number of rotated backup files (default: 5)
  const rawFile = env["PI_WEB_LOG_FILE"];
  if (rawFile !== undefined && rawFile.trim().length > 0) {
    const maxSizeMbRaw = env["PI_WEB_LOG_FILE_MAXSIZE"];
    const maxFilesRaw = env["PI_WEB_LOG_FILE_MAXFILES"];
    const maxSizeMb = maxSizeMbRaw !== undefined ? parseFloat(maxSizeMbRaw) : 10;
    const maxFiles = maxFilesRaw !== undefined ? parseInt(maxFilesRaw, 10) : 5;
    configureFileOutput({
      enabled: true,
      path: rawFile.trim(),
      maxSizeMb: isFinite(maxSizeMb) && maxSizeMb > 0 ? maxSizeMb : 10,
      maxFiles: isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 5,
    });
  }
}

// ── File output configuration ─────────────────────────────────────────────
//
// A module-level reference to the currently configured file sink.
// Null means file output is disabled or not yet configured.
// Created/replaced by configureFileOutput(); read by getFileSink().

let _fileSink: Sink | null = null;

/**
 * Configure the global file-output sink.
 *
 * When `config.enabled` is true and a valid `path` is provided, subsequent
 * log calls (from loggers that use the default sink) will also be written to
 * the configured file.  Calling with `enabled: false` disables file output.
 *
 * This function is safe to call in any environment; file-sink's own guards
 * ensure no Node-specific API is touched in a browser context.
 */
export function configureFileOutput(config: FileOutputConfig): void {
  _fileSink = createFileSink(config);
}

/**
 * Return the currently configured file sink, or null when file output is
 * not configured or disabled.
 */
export function getFileSink(): Sink | null {
  return _fileSink;
}

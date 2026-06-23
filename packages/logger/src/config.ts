/**
 * @pi-web/logger — runtime configuration store
 *
 * Module-level singleton holding the current LoggerRuntimeConfig.
 * Mutated via configureLogger(); read by create-logger.ts on every log call.
 *
 * Zero runtime dependencies. No Node-specific or browser-specific imports.
 */

import type { LoggerRuntimeConfig, LogLevel } from "./types.js";

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
}

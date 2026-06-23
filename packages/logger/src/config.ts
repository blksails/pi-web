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

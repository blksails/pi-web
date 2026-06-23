/**
 * @pi-web/logger — isomorphic structured logging library
 *
 * Public API surface. All imports are zero-runtime-dependency, no Node-specific
 * or browser-specific modules. Concrete sinks (Node stderr / browser bus) are
 * implemented in task 1.3 (node-sink.ts / browser-sink.ts).
 */

export type { LogLevel, LogEntry, Logger, LoggerRuntimeConfig, Sink } from "./types.js";
export { createLogger } from "./create-logger.js";
export type { CreateLoggerOptions } from "./create-logger.js";
export { configureLogger, getRuntimeConfig } from "./config.js";
export { isLevelEnabled, isNamespaceEnabled } from "./level.js";

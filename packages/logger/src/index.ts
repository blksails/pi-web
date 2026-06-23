/**
 * @pi-web/logger — isomorphic structured logging library
 *
 * Public API surface. Zero runtime dependencies. No static Node-specific imports.
 */

export type { LogLevel, LogEntry, Logger, LoggerRuntimeConfig, Sink } from "./types.js";
export { createLogger } from "./create-logger.js";
export type { CreateLoggerOptions } from "./create-logger.js";
export { configureLogger, getRuntimeConfig, initConfigFromEnv, configureFileOutput, getFileSink } from "./config.js";
export { isLevelEnabled, isNamespaceEnabled } from "./level.js";
// Node sink
export { LOG_SENTINEL, serializeLogLine, nodeSink } from "./node-sink.js";
// File sink
export type { FileOutputConfig } from "./file-sink.js";
export { createFileSink } from "./file-sink.js";
// Browser bus
export {
  BROWSER_LOG_CAPACITY,
  subscribeBrowserLogs,
  getBrowserLogs,
  browserSink,
} from "./browser-sink.js";
// Sink selector
export { getDefaultSink } from "./sink.js";

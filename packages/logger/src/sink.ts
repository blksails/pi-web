/**
 * @blksails/pi-web-logger — default sink selector
 *
 * Selects the appropriate sink based on the current runtime environment:
 *   - Browser (typeof window !== "undefined") → browserSink
 *   - Node / any other environment             → nodeSink
 *
 * This module is the only place where environment detection lives, keeping
 * node-sink.ts and browser-sink.ts free of cross-environment concerns.
 *
 * Zero static `node:` imports — isomorphic purity is preserved (Requirement 1.6).
 */

import type { Sink } from "./types.js";
import { nodeSink } from "./node-sink.js";
import { browserSink } from "./browser-sink.js";

/**
 * Returns the default sink for the current runtime environment.
 *
 * Called lazily (not at module-eval time) to ensure that environment stubs
 * (e.g. `vi.stubGlobal("window", ...)` in tests) are observed correctly.
 *
 * We use `(globalThis as Record<string, unknown>)["window"]` instead of
 * `typeof window` to avoid a TS2304 error when the DOM lib is not included
 * in the compiler options (isomorphic library — lib: ["ES2022"] only).
 */
export function getDefaultSink(): Sink {
  const isBrowser =
    (globalThis as Record<string, unknown>)["window"] !== undefined;
  return isBrowser ? browserSink : nodeSink;
}

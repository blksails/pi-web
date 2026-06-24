/**
 * @blksails/pi-web-logger — level ordering & namespace prefix matching
 *
 * Zero runtime dependencies. No Node-specific or browser-specific imports.
 */

import type { LogLevel } from "./types.js";

/** Severity order: debug=0, info=1, warn=2, error=3 */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Returns true if `candidate` meets or exceeds `threshold`.
 * i.e. the log entry passes the level gate.
 */
export function isLevelEnabled(
  candidate: LogLevel,
  threshold: LogLevel,
): boolean {
  return LEVEL_ORDER[candidate] >= LEVEL_ORDER[threshold];
}

/**
 * Returns true when the `ns` namespace is enabled given `namespaces` map.
 *
 * Rules (applied in order):
 * 1. If `ns` exactly matches a key → use that value.
 * 2. If a key `k` is a colon-segment prefix of `ns`
 *    (i.e. `ns === k` OR `ns.startsWith(k + ":")`), use the key's value.
 *    The **longest matching key** wins (most-specific prefix).
 * 3. If no key matches → default true (open).
 *
 * Example: key "agent" → disabled. This blocks "agent", "agent:hello",
 * "agent:hello:tool" — but NOT "agentx" or "agentx:foo".
 */
export function isNamespaceEnabled(
  ns: string,
  namespaces: Record<string, boolean> | undefined,
): boolean {
  if (!namespaces) return true;

  let bestMatchLen = -1;
  let bestMatchValue = true; // default open

  for (const [key, value] of Object.entries(namespaces)) {
    if (ns === key) {
      // Exact match — highest priority; length = key.length
      if (key.length > bestMatchLen) {
        bestMatchLen = key.length;
        bestMatchValue = value;
      }
    } else if (ns.startsWith(key + ":")) {
      // Colon-segment prefix match
      if (key.length > bestMatchLen) {
        bestMatchLen = key.length;
        bestMatchValue = value;
      }
    }
  }

  return bestMatchValue;
}

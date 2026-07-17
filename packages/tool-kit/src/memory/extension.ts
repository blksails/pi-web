/**
 * memoryExtension — process-in ExtensionFactory registering long-term memory tools.
 *
 * Load via agent: `extensions: [memoryExtension]`
 * Runtime-only: import from `@blksails/pi-web-tool-kit/runtime`.
 */

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerMemoryTools } from "./tools/register.js";

/**
 * Default factory: builds store from PI_WEB_MEMORY_* env and registers tools.
 */
export const memoryExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  registerMemoryTools(pi);
};

/**
 * Factory with injectable store (tests / custom assembly).
 */
export function makeMemoryExtension(
  opts?: Parameters<typeof registerMemoryTools>[1],
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    registerMemoryTools(pi, opts);
  };
}

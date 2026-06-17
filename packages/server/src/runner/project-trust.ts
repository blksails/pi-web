/**
 * Project trust wiring.
 *
 * The runner only *carries* a trust decision; it does not compute it (the
 * "source → trusted?" policy belongs to agent-source-resolver). This module
 * turns an external boolean into the `resolveProjectTrust` hook shape that pi's
 * resource loader expects.
 *
 * Trust gates only `.pi/` project-level resources (extensions/skills/prompts/
 * settings). Context files (AGENTS.md / CLAUDE.md) and user/global extensions
 * are unaffected — that is pi's existing behaviour and we do not change it.
 */
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

/**
 * Hook accepted by pi's `resourceLoaderReloadOptions.resolveProjectTrust`.
 * Resolves whether project-level `.pi/` resources should be loaded.
 */
export type ResolveProjectTrust = (input: {
  extensionsResult: LoadExtensionsResult;
}) => Promise<boolean>;

/**
 * Build a {@link ResolveProjectTrust} hook from an externally-decided boolean.
 *
 * - `true`  → pi loads `.pi/` project-level resources.
 * - `false` → pi ignores `.pi/` project-level resources (headless default).
 */
export function makeResolveProjectTrust(trusted: boolean): ResolveProjectTrust {
  return async () => trusted;
}

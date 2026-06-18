import type { AgentDefinition } from "./types.js";
import type { SkillsOverride } from "./sdk-types.js";
import { defineAgent } from "./index.js";

/** Override hook that closes all disk-discovered skills (preserving diagnostics). */
const noSkills: SkillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics });

/**
 * Minimal default preset: tools closed + skills closed + system extensions closed.
 * - `noTools: "all"`     → no built-in/extension tools enabled (`customTools` may
 *   still be layered on by the author).
 * - `skills` empty override → the resolved skill set is empty.
 * - `allowExtensions: []` → close all disk-discovered system extensions (explicit
 *   `extensions` append items are unaffected).
 */
export const minimalAgentPreset: AgentDefinition = {
  noTools: "all",
  skills: noSkills,
  allowExtensions: [],
};

/**
 * Build a minimal agent in one line: layer author overrides on top of the preset
 * (shallow merge, overrides win). Close semantics are preserved by default; the
 * author can re-open capabilities via override fields or `allowExtensions`.
 *
 * @example
 * ```ts
 * export default defineMinimalAgent({
 *   model: { provider: "anthropic", modelId: "claude-opus-4-5" },
 * });
 * ```
 */
export function defineMinimalAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return defineAgent({ ...minimalAgentPreset, ...overrides });
}

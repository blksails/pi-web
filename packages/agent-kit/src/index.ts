/**
 * `@pi-web/agent-kit` — lightweight, zero-forced-runtime-dependency helpers for
 * authoring pi-web custom agents.
 *
 * Authors write an `index.ts` whose default export is an {@link AgentDefinition}
 * (or a factory producing one). {@link defineAgent} is an identity function that
 * exists purely for type inference — it never transforms or copies the input,
 * so a definition produced without this package is structurally identical and
 * still loadable by the runner.
 */
export type { AgentContext, AgentDefinition, AgentModel } from "./types.js";
export type {
  AgentsFilesOverride,
  ExtensionFactory,
  FromServicesOptions,
  Model,
  PromptsOverride,
  ScopedModelEntry,
  SkillsOverride,
  SystemPromptValue,
  ThinkingLevel,
  ToolDefinition,
} from "./sdk-types.js";

import type { AgentDefinition } from "./types.js";

/**
 * Identity helper providing compile-time type checking for an
 * {@link AgentDefinition}. Returns the exact same reference it was given;
 * there are no runtime side effects and no forced runtime dependency.
 *
 * @example
 * ```ts
 * export default defineAgent({
 *   model: { provider: "anthropic", modelId: "claude-opus-4-5" },
 *   systemPrompt: "You are helpful.",
 * });
 * ```
 */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  return def;
}

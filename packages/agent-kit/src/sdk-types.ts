/**
 * Thin re-exports / derivations of pi SDK types used by {@link AgentDefinition}.
 *
 * `@blksails/agent-kit` keeps the pi SDK as a peer/dev dependency only: these are
 * pure `type` imports and never produce a runtime dependency edge. To stay
 * resolvable from a package that only depends on `@earendil-works/pi-coding-agent`
 * (and not its transitive `pi-ai` / `pi-agent-core` packages directly), every
 * type is derived from the public surface re-exported by the SDK barrel rather
 * than imported from a transitive package.
 */
import type {
  CreateAgentSessionFromServicesOptions,
  CreateAgentSessionServicesOptions,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export type { ExtensionFactory, ToolDefinition };

/** A resolved pi model, derived from the public from-services options. */
export type Model = NonNullable<CreateAgentSessionFromServicesOptions["model"]>;

/** Reasoning effort level, derived from the public from-services options. */
export type ThinkingLevel = NonNullable<
  CreateAgentSessionFromServicesOptions["thinkingLevel"]
>;

/** A single entry of the `scopedModels` array. */
export type ScopedModelEntry = NonNullable<
  CreateAgentSessionFromServicesOptions["scopedModels"]
>[number];

/**
 * The `resourceLoaderOptions` bag accepted by `createAgentSessionServices`.
 * `NonNullable` strips the `| undefined` so member lookups below are precise.
 */
type ResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions["resourceLoaderOptions"]
>;

/** Override hook for the resolved skill set (`skillsOverride`). */
export type SkillsOverride = NonNullable<ResourceLoaderOptions["skillsOverride"]>;

/** Override hook for the resolved prompt templates (`promptsOverride`). */
export type PromptsOverride = NonNullable<ResourceLoaderOptions["promptsOverride"]>;

/** Override hook for the resolved context files (`agentsFilesOverride`). */
export type AgentsFilesOverride = NonNullable<
  ResourceLoaderOptions["agentsFilesOverride"]
>;

/**
 * The `systemPrompt` value accepted by the resource loader, widened with a
 * thunk form so authors may compute the prompt lazily.
 */
export type SystemPromptValue =
  | NonNullable<ResourceLoaderOptions["systemPrompt"]>
  | (() => string);

/** Convenience alias for the session-level options consumed by the mapper. */
export type FromServicesOptions = CreateAgentSessionFromServicesOptions;

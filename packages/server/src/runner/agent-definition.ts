/**
 * Server-internal mirror of the `@pi-web/agent-kit` public type surface.
 *
 * `@pi-web/server` intentionally does NOT depend on `@pi-web/agent-kit`
 * (the kit is a zero-forced-dependency, types-only authoring package, and the
 * loader normalizes user exports by structural duck-typing rather than by
 * import). To map a normalized definition the runner still needs the *type*, so
 * we re-derive an equivalent shape from the same pi SDK public surface the kit
 * derives from. Because both are structural and derived from identical SDK
 * types, an `AgentDefinition` authored via `defineAgent(...)` is assignable here.
 */
import type {
  CreateAgentSessionFromServicesOptions,
  CreateAgentSessionServicesOptions,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Logger } from "@pi-web/logger";

/** A resolved pi model (from the public from-services options). */
export type Model = NonNullable<CreateAgentSessionFromServicesOptions["model"]>;

/** Reasoning effort level. */
export type ThinkingLevel = NonNullable<
  CreateAgentSessionFromServicesOptions["thinkingLevel"]
>;

type ResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions["resourceLoaderOptions"]
>;

export type SkillsOverride = NonNullable<ResourceLoaderOptions["skillsOverride"]>;
export type PromptsOverride = NonNullable<ResourceLoaderOptions["promptsOverride"]>;
export type AgentsFilesOverride = NonNullable<
  ResourceLoaderOptions["agentsFilesOverride"]
>;
export type SystemPromptValue =
  | NonNullable<ResourceLoaderOptions["systemPrompt"]>
  | (() => string);

/** Context handed to shape-(b) factory definitions. */
export interface AgentContext {
  cwd: string;
  agentDir?: string;
  env: Record<string, string | undefined>;
  /**
   * Structured logger for the agent (Node sink → stderr → main process pipeline).
   * Namespace is prefixed with "agent:" followed by the agent identifier.
   */
  logger?: Logger;
}

/** Model reference: a resolved pi Model or a lightweight `{ provider, modelId }`. */
export type AgentModel = Model | { provider: string; modelId: string };

/** Declarative custom-agent capabilities (mirror of agent-kit's AgentDefinition). */
export interface AgentDefinition {
  model?: AgentModel;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
  customTools?: ToolDefinition[];
  systemPrompt?: SystemPromptValue;
  extensions?: Array<string | ExtensionFactory>;
  /**
   * System extension allowlist (close semantics). Independent of the
   * append-only `extensions` field.
   * - Absent: keep the SDK default — discover and load all system extensions.
   * - `[]`: disable all disk-discovered system extensions (explicit
   *   `extensions` append items are unaffected).
   * - `["a", ...]`: keep only the named discovered extensions enabled; close
   *   the rest.
   */
  allowExtensions?: string[];
  skills?: SkillsOverride;
  promptTemplates?: PromptsOverride;
  contextFiles?: AgentsFilesOverride;
  scopedModels?: Array<{ model: AgentModel; thinkingLevel?: ThinkingLevel }>;
}

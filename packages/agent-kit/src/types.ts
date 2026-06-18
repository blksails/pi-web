import type {
  AgentsFilesOverride,
  ExtensionFactory,
  Model,
  PromptsOverride,
  SkillsOverride,
  SystemPromptValue,
  ThinkingLevel,
  ToolDefinition,
} from "./sdk-types.js";

/**
 * Context passed to a factory-style agent definition (shape b).
 *
 * The runner supplies the resolved working directory, the optional agent
 * config directory and a snapshot of the process environment so that the
 * factory can make environment-aware decisions when producing its
 * {@link AgentDefinition}.
 */
export interface AgentContext {
  /** Effective working directory for project-local discovery. */
  cwd: string;
  /** Global agent config directory (e.g. ~/.pi/agent), if provided. */
  agentDir?: string;
  /** Snapshot of the process environment. */
  env: Record<string, string | undefined>;
}

/**
 * A model reference for an {@link AgentDefinition}.
 *
 * Either a fully-resolved pi {@link Model} (e.g. from `getModel(...)`), or a
 * lightweight `{ provider, modelId }` descriptor that the runner resolves
 * against the model registry at startup.
 */
export type AgentModel =
  | Model
  | {
      provider: string;
      modelId: string;
    };

/**
 * Declarative description of a custom agent's capabilities.
 *
 * Every field is optional: an empty definition yields pi's default discovery
 * behaviour. Field types are aligned with the pi SDK `createAgentSession*`
 * inputs so the same value can be threaded through without coercion.
 */
export interface AgentDefinition {
  /** Model to use. A resolved pi Model or a `{ provider, modelId }` ref. */
  model?: AgentModel;
  /** Reasoning effort. */
  thinkingLevel?: ThinkingLevel;
  /** Allowlist of built-in/extension tool names. */
  tools?: string[];
  /** Denylist of tool names, applied after `tools`. */
  excludeTools?: string[];
  /**
   * Default tool suppression mode when no allowlist is provided.
   * - `"all"`: start with no tools enabled.
   * - `"builtin"`: disable default built-in tools, keep extension/custom tools.
   */
  noTools?: "all" | "builtin";
  /** Custom tools to register, e.g. from `defineTool(...)`. */
  customTools?: ToolDefinition[];
  /** System prompt override (a string, or a thunk returning a string). */
  systemPrompt?: SystemPromptValue;
  /**
   * Extensions to load. String items are treated as filesystem paths;
   * function items are treated as in-process extension factories.
   */
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
  /** Override hook for the resolved skill set. */
  skills?: SkillsOverride;
  /** Override hook for the resolved prompt templates. */
  promptTemplates?: PromptsOverride;
  /** Override hook for the resolved context (AGENTS.md/CLAUDE.md) files. */
  contextFiles?: AgentsFilesOverride;
  /** Models available for cycling at runtime. */
  scopedModels?: Array<{
    model: AgentModel;
    thinkingLevel?: ThinkingLevel;
  }>;
}

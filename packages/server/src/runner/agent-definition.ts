/**
 * Server-internal mirror of the `@blksails/pi-web-agent-kit` public type surface.
 *
 * `@blksails/pi-web-server` intentionally does NOT depend on `@blksails/pi-web-agent-kit`
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
import type { Logger } from "@blksails/pi-web-logger";
import type { AgentRouteMethod, SlashCompletionDecl } from "@blksails/pi-web-protocol";

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
  /**
   * Resolved per-source settings values (spec: source-settings-and-slots,
   * Req 4.1–4.5). Mirror of `@blksails/pi-web-agent-kit`'s `AgentContext.settings`
   * — see that package's `types.ts` for the full contract. Injected by
   * {@link ../runner.js startRunner} at assembly time; `{}` when the source
   * declares no settings, no settings file exists, or resolution is skipped.
   */
  readonly settings: Readonly<Record<string, unknown>>;
}

/** Model reference: a resolved pi Model or a lightweight `{ provider, modelId }`. */
export type AgentModel = Model | { provider: string; modelId: string };

/**
 * Request context handed to an agent route handler (mirror of agent-kit's
 * `AgentRouteRequest`; spec agent-declared-routes).
 */
export interface AgentRouteRequest {
  /** Declared route name being invoked. */
  readonly name: string;
  /** HTTP method of the incoming call. */
  readonly method: AgentRouteMethod;
  /** URL query parameters, flattened to single string values. */
  readonly query: Readonly<Record<string, string>>;
  /** Parsed JSON request body, if the call carried one. */
  readonly body?: unknown;
}

/**
 * Handler bound to a declared route (mirror of agent-kit's
 * `AgentRouteHandler`). Runs only inside the agent subprocess — the function
 * never crosses the process boundary.
 */
export type AgentRouteHandler = (
  req: AgentRouteRequest,
) => unknown | Promise<unknown>;

/**
 * One agent-declared HTTP route (mirror of agent-kit's `AgentRouteDecl`).
 * Authoritative validation (name format `^[a-z0-9][a-z0-9-]*$`, uniqueness
 * within one definition, methods ⊆ {GET, POST}) happens at assembly time in
 * the agent-loader normalization.
 */
export interface AgentRouteDecl {
  /** Route name (URL segment under the session namespace). */
  readonly name: string;
  /** Allowed HTTP methods. Defaults to `["GET"]` when omitted. */
  readonly methods?: ReadonlyArray<AgentRouteMethod>;
  /** Human-readable description, surfaced in the route listing. */
  readonly description?: string;
  /** Handler executed in the agent subprocess. */
  readonly handler: AgentRouteHandler;
}

/**
 * A dynamic attachment catalog entry (mirror of agent-kit's `CatalogEntry`;
 * spec agent-attachment-catalog). Pure data — no bytes.
 */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly sizeHint?: number;
  readonly version?: string;
}

/** Materialized bytes for one catalog entry (mirror of agent-kit's `CatalogResolved`). */
export interface CatalogResolved {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * Declarative attachment catalog (mirror of agent-kit's
 * `AgentAttachmentCatalogDecl`). Both handlers run only inside the agent
 * subprocess — they never cross the process boundary.
 */
export interface AgentAttachmentCatalogDecl {
  list(query: string): CatalogEntry[] | Promise<CatalogEntry[]>;
  resolve(entryId: string): CatalogResolved | Promise<CatalogResolved>;
}

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
  /**
   * Static slash-command completion candidates (mirror of agent-kit field).
   * pi-web-only metadata (not a pi SDK session field): threaded from the agent
   * definition to the server via a runner-assembly-time stdout frame.
   */
  slashCompletions?: SlashCompletionDecl[];
  /**
   * HTTP routes this agent declares (mirror of agent-kit field; spec
   * agent-declared-routes). pi-web-only metadata: normalized and validated at
   * assembly time by the agent-loader; the pure-data projection
   * (name/methods/description) is threaded to the server via a
   * runner-assembly-time stdout frame, handlers stay in the subprocess.
   */
  routes?: AgentRouteDecl[];
  /**
   * Named attachment write-target profile (mirror of agent-kit field; spec
   * agent-attachment-profile). pi-web-only metadata: shape-validated at
   * assembly time by the agent-loader, whitelist-validated by the runner
   * against the host's `PI_WEB_ATTACHMENT_BACKENDS` topology, then threaded
   * to the subprocess child attachment store's write policy and announced to
   * the server via a runner-assembly-time stdout frame.
   */
  attachmentProfile?: string;
  /**
   * Dynamic attachment catalog this agent's session exposes (mirror of
   * agent-kit field; spec agent-attachment-catalog). pi-web-only metadata:
   * shape-validated at assembly time by the agent-loader; handlers stay in
   * the subprocess, consumed by the runner's catalog bridge.
   */
  attachmentCatalog?: AgentAttachmentCatalogDecl;
}

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
import type { Logger } from "@blksails/pi-web-logger";
import type { SlashCompletionDecl } from "@blksails/pi-web-protocol";

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
  /**
   * Structured logger for the agent (Node sink → stderr → main process pipeline).
   * Namespace is prefixed with "agent:" followed by the agent identifier.
   */
  logger?: Logger;
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
 * Request context handed to an {@link AgentRouteHandler} for one route call.
 *
 * Defined locally (not imported from the protocol package) to keep agent-kit
 * a pure-type, zero-dependency authoring surface; shape parity with the
 * protocol DTOs is guaranteed by the server-side normalization layer.
 */
export interface AgentRouteRequest {
  /** Declared route name being invoked. */
  readonly name: string;
  /** HTTP method of the incoming call. */
  readonly method: "GET" | "POST";
  /** URL query parameters, flattened to single string values. */
  readonly query: Readonly<Record<string, string>>;
  /** Parsed JSON request body, if the call carried one. */
  readonly body?: unknown;
}

/**
 * Handler bound to a declared route.
 *
 * Invoked only inside the agent subprocess — the function itself never
 * crosses the process boundary (the main process only sees the pure-data
 * declaration). The return value MUST be JSON-serializable; it becomes the
 * HTTP response body. A thrown error is reported to the main process and
 * surfaces to the caller as a 502.
 */
export type AgentRouteHandler = (
  req: AgentRouteRequest,
) => unknown | Promise<unknown>;

/**
 * One agent-declared HTTP route, exposed under the session namespace
 * (`/api/sessions/:id/agent-routes/:name`) once the session is created.
 */
export interface AgentRouteDecl {
  /**
   * Route name. Must be non-empty and contain only lowercase letters,
   * digits and hyphens; unique within one definition (validated at
   * assembly time — violations fail session creation).
   */
  readonly name: string;
  /**
   * Allowed HTTP methods. Defaults to `["GET"]` when omitted (the primary
   * use case is read-only queries).
   */
  readonly methods?: ReadonlyArray<"GET" | "POST">;
  /** Human-readable description, surfaced in the route listing. */
  readonly description?: string;
  /** Handler executed in the agent subprocess. See {@link AgentRouteHandler}. */
  readonly handler: AgentRouteHandler;
}

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
  /**
   * Static slash-command completion candidates this agent declares (e.g.
   * `/img-gen`, `/img-edit`). They surface in the input `/` completion and,
   * when selected, only fill the input box — they are NOT executed; the filled
   * text is sent as a normal message and interpreted by the LLM (driven by the
   * system prompt). Pure data, threaded to the server at runner assembly time.
   */
  slashCompletions?: SlashCompletionDecl[];
  /**
   * HTTP routes this agent declares. When present, each route becomes
   * callable at `GET|POST /api/sessions/:id/agent-routes/:name` for the
   * agent's session — no host-side configuration needed. Handlers run in
   * the agent subprocess only; the main process receives the pure-data
   * declaration (name/methods/description). Omitting this field leaves the
   * agent completely unaffected by the feature.
   */
  routes?: AgentRouteDecl[];
  /**
   * Named attachment write-target profile (spec `agent-attachment-profile`).
   * A **plain name** referencing a backend the host has registered in its
   * `PI_WEB_ATTACHMENT_BACKENDS` topology — this field carries no credentials,
   * endpoints, or storage parameters, only a whitelist reference. New
   * attachments produced by this agent's session (both browser uploads and
   * subprocess tool output) are written to that backend; reads/signed
   * distribution keep routing by the descriptor's already-fixed backend
   * binding, independent of this field or the session's lifetime.
   *
   * The name must match a backend the host has declared, or session creation
   * fails with an error naming the unregistered profile — the host, not the
   * agent, holds final authority over where data lands. Omitting this field
   * leaves the agent's session on the host's default write target, identical
   * to pre-feature behavior.
   */
  attachmentProfile?: string;
  /**
   * Dynamic, discoverable attachment catalog this agent's session exposes
   * (spec `agent-attachment-catalog`). Entries surface in the input `@`
   * completion under the "catalog" group; selecting one lazily materializes
   * it into a standard attachment (same treatment as an uploaded file — the
   * bytes never leave the agent subprocess until a user actually picks the
   * entry). Omitting this field leaves the agent completely unaffected.
   *
   * Both handlers run only inside the agent subprocess; the main process
   * only ever sees the pure-data entry projection (`CatalogEntry`, no
   * bytes) and, after materialization, a standard `att_` id.
   */
  attachmentCatalog?: AgentAttachmentCatalogDecl;
}

/**
 * A dynamic attachment catalog entry (pure data — no bytes). `id` must be
 * stable for the lifetime of the session (re-listing the same logical item
 * should reuse the same `id`). `version`, when the underlying content can
 * change, is part of the materialization idempotency key: a repeated
 * `materialize` call for the same `id` + `version` reuses the previously
 * materialized attachment rather than re-running `resolve` and re-storing
 * bytes; bumping `version` signals new content.
 */
export interface CatalogEntry {
  /** Stable entry id within this session. `^[A-Za-z0-9][\w.-]*$`. */
  readonly id: string;
  /** Display name, also used as the completion filter target. */
  readonly name: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** Optional content-type hint (display only, not enforced). */
  readonly mimeType?: string;
  /** Optional size hint in bytes (display only). */
  readonly sizeHint?: number;
  /** Optional idempotency-key component; a version bump means new content. */
  readonly version?: string;
}

/** The materialized bytes for one catalog entry, returned by `resolve`. */
export interface CatalogResolved {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * Declarative attachment catalog: `list` enumerates entries matching a query
 * (called on every `@` completion keystroke, so it should be fast — an
 * in-memory catalog is strongly recommended); `resolve` lazily produces the
 * bytes for one entry id, only called when a user actually selects it (or
 * the completion framework's resolve fallback path runs). Both may be sync
 * or async; both run only inside the agent subprocess.
 */
export interface AgentAttachmentCatalogDecl {
  list(query: string): CatalogEntry[] | Promise<CatalogEntry[]>;
  resolve(entryId: string): CatalogResolved | Promise<CatalogResolved>;
}

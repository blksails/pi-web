/**
 * Register memory_* tools on a pi ExtensionAPI.
 */

import { Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { createMemoryStore, memoryConfigFromEnv } from "../config.js";
import { normalizeMemoryName } from "../name.js";
import type {
  MemoryErrorCode,
  MemoryResult,
  MemoryScope,
  MemoryStore,
} from "../types.js";
import { memoryErr } from "../types.js";

function textResult<T>(payload: MemoryResult<T>): AgentToolResult<MemoryResult<T>> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function codeOf(err: unknown): MemoryErrorCode {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code: unknown }).code;
    if (
      c === "INVALID_NAME" ||
      c === "NOT_FOUND" ||
      c === "INVALID_SCOPE" ||
      c === "BACKEND_CONFIG" ||
      c === "IO_ERROR" ||
      c === "REMOTE_ERROR"
    ) {
      return c;
    }
  }
  return "IO_ERROR";
}

function asScope(v: unknown): MemoryScope | undefined {
  if (v === "global" || v === "agent-source") return v;
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

export interface RegisterMemoryToolsOptions {
  /** Pre-built store (tests); default createMemoryStore() from env. */
  readonly store?: MemoryStore;
  /** Default agent source when tools omit it. */
  readonly defaultAgentSourceId?: string;
}

/**
 * Register five memory tools. Safe against uncaught throws from the store layer.
 */
export function registerMemoryTools(
  pi: ExtensionAPI,
  opts?: RegisterMemoryToolsOptions,
): void {
  let store: MemoryStore;
  let defaultAgentSourceId = opts?.defaultAgentSourceId;
  try {
    if (opts?.store) {
      store = opts.store;
    } else {
      const cfg = memoryConfigFromEnv();
      store = createMemoryStore({ config: cfg });
      defaultAgentSourceId = defaultAgentSourceId ?? cfg.defaultAgentSourceId;
    }
  } catch (err) {
    // Register tools that always report BACKEND_CONFIG so the agent still loads.
    const message = err instanceof Error ? err.message : String(err);
    const fail = async () =>
      textResult(memoryErr("BACKEND_CONFIG", message));
    for (const name of [
      "memory_write",
      "memory_read",
      "memory_list",
      "memory_delete",
      "memory_search",
    ] as const) {
      pi.registerTool({
        name,
        label: name,
        description: `Memory tool unavailable: ${message}`,
        parameters: Type.Object({}),
        execute: fail,
      });
    }
    return;
  }

  const resolveAgentId = (params: Record<string, unknown>): string | undefined => {
    if (typeof params["agentSourceId"] === "string" && params["agentSourceId"].trim()) {
      return params["agentSourceId"].trim();
    }
    return defaultAgentSourceId;
  };

  pi.registerTool({
    name: "memory_write",
    label: "Memory write",
    description:
      "Create or update a long-term memory entry (skills-like document: name + optional description/tags + markdown body). " +
      "Default scope is global (shared across agent sources). Use scope=agent-source to isolate per agent.",
    parameters: Type.Object({
      name: Type.String({
        description: "Stable memory name/slug (e.g. user-prefs)",
      }),
      content: Type.String({
        description: "Markdown body of the memory",
      }),
      description: Type.Optional(
        Type.String({ description: "Short summary for listings" }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Tags for filtering" }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal("global"), Type.Literal("agent-source")], {
          description: "global (default, cross agent-source) or agent-source",
        }),
      ),
      agentSourceId: Type.Optional(
        Type.String({
          description:
            "Required when scope=agent-source if PI_WEB_MEMORY_AGENT_SOURCE_ID is unset",
        }),
      ),
    }),
    async execute(_id, params: Record<string, unknown>) {
      try {
        const name = typeof params["name"] === "string" ? params["name"] : "";
        const content =
          typeof params["content"] === "string" ? params["content"] : "";
        const n = normalizeMemoryName(name);
        if (!n.ok) return textResult(memoryErr("INVALID_NAME", n.message));
        const scope = asScope(params["scope"]) ?? "global";
        const agentSourceId =
          scope === "agent-source" ? resolveAgentId(params) : undefined;
        if (scope === "agent-source" && !agentSourceId) {
          return textResult(
            memoryErr(
              "INVALID_SCOPE",
              "agentSourceId required for scope=agent-source (pass param or set PI_WEB_MEMORY_AGENT_SOURCE_ID)",
            ),
          );
        }
        const entry = await store.put({
          name: n.name,
          content,
          description:
            typeof params["description"] === "string"
              ? params["description"]
              : undefined,
          tags: asStringArray(params["tags"]),
          scope,
          agentSourceId,
        });
        return textResult({ ok: true, entry });
      } catch (err) {
        return textResult(
          memoryErr(codeOf(err), err instanceof Error ? err.message : String(err)),
        );
      }
    },
  });

  pi.registerTool({
    name: "memory_read",
    label: "Memory read",
    description:
      "Read a memory entry by name (full body). Sees global memories plus agent-source memories for the current agent.",
    parameters: Type.Object({
      name: Type.String({ description: "Memory name/slug" }),
      agentSourceId: Type.Optional(
        Type.String({ description: "Agent source id for isolation visibility" }),
      ),
    }),
    async execute(_id, params: Record<string, unknown>) {
      try {
        const name = typeof params["name"] === "string" ? params["name"] : "";
        const entry = await store.get(name, {
          agentSourceId: resolveAgentId(params),
        });
        if (!entry) {
          return textResult(
            memoryErr("NOT_FOUND", `memory not found: ${name}`),
          );
        }
        return textResult({ ok: true, entry });
      } catch (err) {
        return textResult(
          memoryErr(codeOf(err), err instanceof Error ? err.message : String(err)),
        );
      }
    },
  });

  pi.registerTool({
    name: "memory_list",
    label: "Memory list",
    description:
      "List memory metadata (no full body). Optional tags (must include all) and scope filter.",
    parameters: Type.Object({
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Only entries that include all these tags",
        }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal("global"), Type.Literal("agent-source")]),
      ),
      agentSourceId: Type.Optional(Type.String()),
    }),
    async execute(_id, params: Record<string, unknown>) {
      try {
        const items = await store.list({
          tags: asStringArray(params["tags"]),
          scope: asScope(params["scope"]),
          agentSourceId: resolveAgentId(params),
        });
        return textResult({ ok: true, items, count: items.length });
      } catch (err) {
        return textResult(
          memoryErr(codeOf(err), err instanceof Error ? err.message : String(err)),
        );
      }
    },
  });

  pi.registerTool({
    name: "memory_delete",
    label: "Memory delete",
    description:
      "Delete a memory by name. Prefer scope when both global and agent-source exist.",
    parameters: Type.Object({
      name: Type.String({ description: "Memory name/slug" }),
      scope: Type.Optional(
        Type.Union([Type.Literal("global"), Type.Literal("agent-source")]),
      ),
      agentSourceId: Type.Optional(Type.String()),
    }),
    async execute(_id, params: Record<string, unknown>) {
      try {
        const name = typeof params["name"] === "string" ? params["name"] : "";
        const deleted = await store.delete(name, {
          scope: asScope(params["scope"]),
          agentSourceId: resolveAgentId(params),
        });
        if (!deleted) {
          return textResult(
            memoryErr("NOT_FOUND", `memory not found: ${name}`),
          );
        }
        return textResult({ ok: true, deleted: true, name });
      } catch (err) {
        return textResult(
          memoryErr(codeOf(err), err instanceof Error ? err.message : String(err)),
        );
      }
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory search",
    description:
      "Keyword search over name, description, tags, and content (case-insensitive substring). Returns metadata list.",
    parameters: Type.Object({
      query: Type.String({ description: "Search keyword" }),
      tags: Type.Optional(Type.Array(Type.String())),
      scope: Type.Optional(
        Type.Union([Type.Literal("global"), Type.Literal("agent-source")]),
      ),
      agentSourceId: Type.Optional(Type.String()),
    }),
    async execute(_id, params: Record<string, unknown>) {
      try {
        const query =
          typeof params["query"] === "string" ? params["query"] : "";
        const items = await store.search(query, {
          tags: asStringArray(params["tags"]),
          scope: asScope(params["scope"]),
          agentSourceId: resolveAgentId(params),
        });
        return textResult({ ok: true, items, count: items.length });
      } catch (err) {
        return textResult(
          memoryErr(codeOf(err), err instanceof Error ? err.message : String(err)),
        );
      }
    },
  });
}

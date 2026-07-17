/**
 * SupabaseMemoryStore — PostgREST via fetch (no @supabase/supabase-js).
 *
 * Table columns (snake_case) map 1:1 to MemoryEntry fields.
 */

import { normalizeMemoryName } from "./name.js";
import {
  filterEntries,
  pickByName,
  searchEntries,
} from "./ops.js";
import type {
  MemoryDeleteOpts,
  MemoryEntry,
  MemoryEntryMeta,
  MemoryListFilter,
  MemoryStore,
  MemoryVisibility,
  MemoryWriteInput,
} from "./types.js";

export interface SupabaseMemoryStoreOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly table?: string;
  /** Inject for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface Row {
  name: string;
  description: string | null;
  content: string;
  tags: string[] | null;
  scope: "global" | "agent-source";
  agent_source_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: Row): MemoryEntry {
  const agentSourceId =
    row.agent_source_id && row.agent_source_id !== ""
      ? row.agent_source_id
      : undefined;
  return {
    name: row.name,
    description: row.description ?? undefined,
    tags: row.tags ?? [],
    scope: row.scope,
    agentSourceId,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** agent_source_id is '' for global so (name, scope, agent_source_id) is a clean PK. */
function entryToRow(entry: MemoryEntry): Row {
  return {
    name: entry.name,
    description: entry.description ?? null,
    content: entry.content,
    tags: [...entry.tags],
    scope: entry.scope,
    agent_source_id: entry.agentSourceId ?? "",
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

export class SupabaseMemoryStore implements MemoryStore {
  private readonly base: string;
  private readonly table: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SupabaseMemoryStoreOptions) {
    this.base = opts.url.replace(/\/$/, "");
    this.table = opts.table ?? "pi_web_memories";
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra,
    };
  }

  private restUrl(query: string): string {
    return `${this.base}/rest/v1/${this.table}${query}`;
  }

  private async request(
    method: string,
    query: string,
    body?: unknown,
    prefer?: string,
  ): Promise<unknown> {
    const headers = this.headers(
      prefer !== undefined ? { Prefer: prefer } : undefined,
    );
    const res = await this.fetchImpl(this.restUrl(query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(
        new Error(`Supabase ${method} ${res.status}: ${text.slice(0, 200)}`),
        { code: "REMOTE_ERROR" as const },
      );
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    return res.json();
  }

  private async fetchAllRows(): Promise<MemoryEntry[]> {
    const data = (await this.request(
      "GET",
      "?select=*",
    )) as Row[] | null;
    if (!Array.isArray(data)) return [];
    return data.map(rowToEntry);
  }

  async get(name: string, vis?: MemoryVisibility): Promise<MemoryEntry | undefined> {
    const n = normalizeMemoryName(name);
    if (!n.ok) return undefined;

    const orParts = [`and(name.eq.${encodeURIComponent(n.name)},scope.eq.global)`];
    const agentId = vis?.agentSourceId?.trim();
    if (agentId) {
      orParts.push(
        `and(name.eq.${encodeURIComponent(n.name)},scope.eq.agent-source,agent_source_id.eq.${encodeURIComponent(agentId)})`,
      );
    }
    // PostgREST or= — keep simple: fetch by name and filter client-side for correctness.
    const data = (await this.request(
      "GET",
      `?select=*&name=eq.${encodeURIComponent(n.name)}`,
    )) as Row[] | null;
    const candidates = Array.isArray(data) ? data.map(rowToEntry) : [];
    return pickByName(candidates, n.name, vis);
  }

  async put(input: MemoryWriteInput): Promise<MemoryEntry> {
    const n = normalizeMemoryName(input.name);
    if (!n.ok) {
      throw Object.assign(new Error(n.message), { code: "INVALID_NAME" as const });
    }
    const scope = input.scope ?? "global";
    const agentSourceId =
      scope === "agent-source" ? input.agentSourceId?.trim() : undefined;
    if (scope === "agent-source" && !agentSourceId) {
      throw Object.assign(
        new Error("agentSourceId is required when scope is agent-source"),
        { code: "INVALID_SCOPE" as const },
      );
    }

    const now = new Date().toISOString();
    // Load existing for createdAt preservation
    let existing: MemoryEntry | undefined;
    try {
      const sid = agentSourceId ?? "";
      const q = `?select=*&name=eq.${encodeURIComponent(n.name)}&scope=eq.${scope}&agent_source_id=eq.${encodeURIComponent(sid)}`;
      const rows = (await this.request("GET", q)) as Row[] | null;
      if (Array.isArray(rows) && rows[0]) existing = rowToEntry(rows[0]);
    } catch {
      // ignore; treat as new
    }

    const entry: MemoryEntry = {
      name: n.name,
      description: input.description,
      tags: input.tags ? [...input.tags] : [],
      scope,
      agentSourceId,
      content: input.content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const row = entryToRow(entry);
    // Upsert on composite PK (name, scope, agent_source_id); global uses agent_source_id=''
    await this.request(
      "POST",
      "?on_conflict=name,scope,agent_source_id",
      row,
      "return=representation,resolution=merge-duplicates",
    );
    return entry;
  }

  async delete(name: string, opts?: MemoryDeleteOpts): Promise<boolean> {
    const n = normalizeMemoryName(name);
    if (!n.ok) return false;

    const scope = opts?.scope;
    const agentId = opts?.agentSourceId?.trim();

    const doDelete = async (query: string): Promise<boolean> => {
      const data = (await this.request(
        "DELETE",
        query,
        undefined,
        "return=representation",
      )) as Row[] | null;
      return Array.isArray(data) && data.length > 0;
    };

    if (scope === "agent-source") {
      if (!agentId) return false;
      return doDelete(
        `?name=eq.${encodeURIComponent(n.name)}&scope=eq.agent-source&agent_source_id=eq.${encodeURIComponent(agentId)}`,
      );
    }
    if (scope === "global") {
      return doDelete(
        `?name=eq.${encodeURIComponent(n.name)}&scope=eq.global&agent_source_id=eq.`,
      );
    }

    if (agentId) {
      const local = await doDelete(
        `?name=eq.${encodeURIComponent(n.name)}&scope=eq.agent-source&agent_source_id=eq.${encodeURIComponent(agentId)}`,
      );
      if (local) return true;
    }
    return doDelete(
      `?name=eq.${encodeURIComponent(n.name)}&scope=eq.global&agent_source_id=eq.`,
    );
  }

  async list(filter?: MemoryListFilter): Promise<MemoryEntryMeta[]> {
    const all = await this.fetchAllRows();
    return filterEntries(all, filter);
  }

  async search(query: string, filter?: MemoryListFilter): Promise<MemoryEntryMeta[]> {
    const all = await this.fetchAllRows();
    return searchEntries(all, query, filter);
  }
}

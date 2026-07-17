/**
 * Memory extension — shared types, port, and structured result codes.
 */

export type MemoryScope = "global" | "agent-source";

export interface MemoryEntry {
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly scope: MemoryScope;
  readonly agentSourceId?: string;
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Lightweight list/search projection (body optional for callers that only need meta). */
export interface MemoryEntryMeta {
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly scope: MemoryScope;
  readonly agentSourceId?: string;
  readonly updatedAt: string;
}

export interface MemoryWriteInput {
  readonly name: string;
  readonly content: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  /** Default: global */
  readonly scope?: MemoryScope;
  /** Required when scope is agent-source */
  readonly agentSourceId?: string;
}

export interface MemoryVisibility {
  /** Current agent source id; when omitted only global entries are visible. */
  readonly agentSourceId?: string;
}

export interface MemoryListFilter extends MemoryVisibility {
  /** Entry must include all of these tags. */
  readonly tags?: readonly string[];
  /** Restrict to a single scope. */
  readonly scope?: MemoryScope;
}

export interface MemoryDeleteOpts extends MemoryVisibility {
  readonly scope?: MemoryScope;
}

/**
 * Pluggable memory backend. Implementations must enforce visibility:
 * - global: visible to all callers
 * - agent-source: only when vis.agentSourceId matches entry.agentSourceId
 */
export interface MemoryStore {
  get(name: string, vis?: MemoryVisibility): Promise<MemoryEntry | undefined>;
  put(input: MemoryWriteInput): Promise<MemoryEntry>;
  delete(name: string, opts?: MemoryDeleteOpts): Promise<boolean>;
  list(filter?: MemoryListFilter): Promise<MemoryEntryMeta[]>;
  search(query: string, filter?: MemoryListFilter): Promise<MemoryEntryMeta[]>;
}

export type MemoryErrorCode =
  | "INVALID_NAME"
  | "NOT_FOUND"
  | "INVALID_SCOPE"
  | "BACKEND_CONFIG"
  | "IO_ERROR"
  | "REMOTE_ERROR";

export type MemoryOk<T> = { readonly ok: true } & T;
export type MemoryErr = {
  readonly ok: false;
  readonly code: MemoryErrorCode;
  readonly message: string;
};
export type MemoryResult<T> = MemoryOk<T> | MemoryErr;

export function memoryErr(code: MemoryErrorCode, message: string): MemoryErr {
  return { ok: false, code, message };
}

export function toMeta(entry: MemoryEntry): MemoryEntryMeta {
  return {
    name: entry.name,
    description: entry.description,
    tags: entry.tags,
    scope: entry.scope,
    agentSourceId: entry.agentSourceId,
    updatedAt: entry.updatedAt,
  };
}

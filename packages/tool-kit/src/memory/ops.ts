/**
 * Pure visibility / filter / search helpers shared by all MemoryStore adapters.
 */

import type {
  MemoryEntry,
  MemoryEntryMeta,
  MemoryListFilter,
  MemoryVisibility,
} from "./types.js";
import { toMeta } from "./types.js";

/** Whether a caller may see this entry. */
export function isVisible(
  entry: Pick<MemoryEntry, "scope" | "agentSourceId">,
  vis?: MemoryVisibility,
): boolean {
  if (entry.scope === "global") return true;
  const id = vis?.agentSourceId?.trim();
  if (!id) return false;
  return entry.agentSourceId === id;
}

/** Entry must include every tag in `required` (order-independent). */
export function matchesTags(
  entryTags: readonly string[],
  required?: readonly string[],
): boolean {
  if (!required || required.length === 0) return true;
  const set = new Set(entryTags.map((t) => t.toLowerCase()));
  return required.every((t) => set.has(t.toLowerCase()));
}

export function matchesListFilter(
  entry: MemoryEntry,
  filter?: MemoryListFilter,
): boolean {
  if (!isVisible(entry, filter)) return false;
  if (filter?.scope !== undefined && entry.scope !== filter.scope) return false;
  if (!matchesTags(entry.tags, filter?.tags)) return false;
  return true;
}

/** Case-insensitive substring match over name, description, tags, content. */
export function matchesQuery(entry: MemoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.description?.toLowerCase().includes(q)) return true;
  if (entry.content.toLowerCase().includes(q)) return true;
  for (const t of entry.tags) {
    if (t.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function filterEntries(
  entries: readonly MemoryEntry[],
  filter?: MemoryListFilter,
): MemoryEntryMeta[] {
  return entries.filter((e) => matchesListFilter(e, filter)).map(toMeta);
}

export function searchEntries(
  entries: readonly MemoryEntry[],
  query: string,
  filter?: MemoryListFilter,
): MemoryEntryMeta[] {
  return entries
    .filter((e) => matchesListFilter(e, filter) && matchesQuery(e, query))
    .map(toMeta);
}

/**
 * Resolve get() preference: agent-source match first (if vis has id), else global.
 * When both exist under ambiguous lookup by name only, prefer agent-source if visible.
 */
export function pickByName(
  candidates: readonly MemoryEntry[],
  name: string,
  vis?: MemoryVisibility,
): MemoryEntry | undefined {
  const visible = candidates.filter(
    (e) => e.name === name && isVisible(e, vis),
  );
  if (visible.length === 0) return undefined;
  const agentId = vis?.agentSourceId?.trim();
  if (agentId) {
    const local = visible.find(
      (e) => e.scope === "agent-source" && e.agentSourceId === agentId,
    );
    if (local) return local;
  }
  return visible.find((e) => e.scope === "global") ?? visible[0];
}

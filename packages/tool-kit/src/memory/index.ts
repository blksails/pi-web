/**
 * Memory extension module — ports, adapters, tools (node-only).
 */

export type {
  MemoryScope,
  MemoryEntry,
  MemoryEntryMeta,
  MemoryWriteInput,
  MemoryVisibility,
  MemoryListFilter,
  MemoryDeleteOpts,
  MemoryStore,
  MemoryErrorCode,
  MemoryOk,
  MemoryErr,
  MemoryResult,
} from "./types.js";
export { memoryErr, toMeta } from "./types.js";

export { normalizeMemoryName, isValidMemoryName } from "./name.js";
export {
  parseMemoryDocument,
  serializeMemoryDocument,
} from "./frontmatter.js";
export {
  isVisible,
  matchesTags,
  matchesListFilter,
  matchesQuery,
  filterEntries,
  searchEntries,
  pickByName,
} from "./ops.js";

export { FileMemoryStore } from "./file-store.js";
export {
  SupabaseMemoryStore,
  type SupabaseMemoryStoreOptions,
} from "./supabase-store.js";
export {
  memoryConfigFromEnv,
  createMemoryStore,
  MemoryConfigError,
  MEMORY_ENV_KEYS,
  type MemoryConfig,
  type MemoryBackendKind,
  type CreateMemoryStoreOptions,
} from "./config.js";

export { registerMemoryTools, type RegisterMemoryToolsOptions } from "./tools/register.js";
export { memoryExtension, makeMemoryExtension } from "./extension.js";

/**
 * session-store-adapters — 公共导出面。
 *
 * 可插拔的会话事件存储:`SessionEntryStore` 接口 + fs/sqlite/postgres 三个 adapter
 * + 共享的序列化/编码纯函数。树运算(重建上下文/分支)由调用方在 `read()` 之上自理。
 */
export type {
  SessionEntryStore,
  SessionHeader,
  SessionEntry,
  SessionEntryBase,
  SessionEntryType,
  SessionMeta,
  SessionVersion,
  AgentMessage,
  MessageEntry,
  ModelChangeEntry,
  ThinkingLevelChangeEntry,
  CompactionEntry,
  BranchSummaryEntry,
  LabelEntry,
  SessionInfoEntry,
  CustomEntry,
  CustomMessageEntry,
} from "./types.js";
export {
  KNOWN_ENTRY_TYPES,
  SessionStoreNotFoundError,
  SessionStoreConflictError,
  UnknownSessionVersionError,
  SessionEntryParseError,
} from "./types.js";
export {
  serializeHeader,
  serializeEntry,
  parseHeader,
  parseEntry,
  parseEntryLoose,
  parseLine,
  parseJson,
  bucketDirName,
  sessionFileName,
  v1EntryId,
  makeReadNormalizer,
  makeStoredEntryNormalizer,
  isKnownEntryType,
} from "./codec.js";
export { FsSessionEntryStore, defaultSessionsRoot } from "./fs-store.js";
export { SqliteSessionEntryStore } from "./sqlite-store.js";
export { PostgresSessionEntryStore } from "./postgres-store.js";
export {
  createSessionEntryStore,
  sessionStoreConfigFromEnv,
  type SessionStoreConfig,
  type SessionStoreKind,
} from "./factory.js";
export { mirrorSessionManagerToStore, type SessionMirror } from "./mirror.js";
export {
  PIWEB_COMMAND_CUSTOM_TYPE,
  type PiwebCommandMarkerData,
} from "./piweb-entries.js";

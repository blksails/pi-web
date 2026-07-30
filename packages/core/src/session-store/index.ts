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
// ★ postgres 实现与「按 env 选型」的工厂**不在本包**:前者值依赖 `pg` 驱动,
//   后者值依赖前者。内核包的依赖声明不得出现数据库驱动(R1.2),而源码直连分发
//   使 optional peer 不可用(消费方 `tsc` 会编译到该文件)。二者住在兼容层包的
//   `session-store-postgres` 模块,并由其经主 barrel 原样导出。
//   本包保留接口(`types`)、编解码、fs / sqlite 两个无外部驱动的实现,
//   以及**后端选型的配置形状与 env 解析**(`config.ts`,零后端依赖)。
export {
  sessionStoreConfigFromEnv,
  type SessionStoreConfig,
  type SessionStoreKind,
} from "./config.js";
export { mirrorSessionManagerToStore, type SessionMirror } from "./mirror.js";

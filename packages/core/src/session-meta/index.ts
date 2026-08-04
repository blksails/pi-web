/**
 * session-meta — 会话展示元数据索引(spec session-meta-index)。
 *
 * 端口 `SessionMetaIndex` + 集中 JSON 文件实现。定位是**缓存**:标题权威仍在会话历史,
 * 索引不可用时调用方退回既有派生路径。详见 `types.ts` 与 `json-file-index.ts` 的模块注释。
 */
export type { SessionMetaEntry, SessionMetaIndex } from "./types.js";
export {
  createLocalSessionMetaIndex,
  sessionMetaStoreKindFromEnv,
  type SessionMetaStoreKind,
} from "./local-factory.js";
export {
  SqliteSessionMetaIndex,
  defaultSessionMetaDbPath,
  sessionMetaDbPathFromEnv,
  type SqliteSessionMetaIndexOptions,
} from "./sqlite-index.js";
export {
  WorkspaceSessionMetaIndex,
  type WorkspaceSessionMetaIndexOptions,
} from "./workspace-index.js";
export {
  JsonFileSessionMetaIndex,
  defaultSessionMetaIndexPath,
  sessionMetaIndexPathFromEnv,
  type JsonFileSessionMetaIndexOptions,
} from "./json-file-index.js";

/**
 * session-store-adapters — 存储契约(接口 + 数据类型 + 错误)。
 *
 * 这是一个**可插拔的会话事件存储**端口:把 pi 会话的 "append-only 事件树" 持久化
 * 能力从存储介质中解耦。本模块**只承担条目存取(IO)**;"从叶子回溯重建上下文、
 * 分支选择" 等树运算属调用方(领域层),不进本接口(Req 1.2/1.5)。
 *
 * 注意:错误类型以 `SessionStore*` 前缀命名,避免与 session-engine 的
 * `SessionNotFoundError`(活跃会话注册表概念)在包级 barrel 中冲突。
 */

/** 会话格式版本:v1 线性 / v2 树 / v3 `custom` 改名(Req 9.1)。 */
export type SessionVersion = 1 | 2 | 3;

/**
 * 会话头部:会话起始元数据,不参与 `id`/`parentId` 树结构(Req 2.4)。
 * `id` 即 `sessionId`(uuidv7,由调用方生成,Req 1.4)。
 */
export interface SessionHeader {
  type: "session";
  id: string;
  version: SessionVersion;
  cwd: string;
  timestamp: string;
  parentSession?: string;
  name?: string;
}

/**
 * 消息负载对存储不透明:存储只做序列化/反序列化,不解释其内部结构。
 * 用 `Record<string, unknown>` 而非 `any`,保持 strict 安全。
 */
export type AgentMessage = { role: string } & Record<string, unknown>;

/** entry 判别联合的公共基:除 header 外所有条目(Req 1.4)。 */
export interface SessionEntryBase {
  /** 8 位 hex,在所在会话内唯一。 */
  id: string;
  /** 父条目 id;`null` 表示首条(Req 3.1)。 */
  parentId: string | null;
  /** ISO 时间戳。 */
  timestamp: string;
}

export type MessageEntry = SessionEntryBase & { type: "message"; message: AgentMessage };
export type ModelChangeEntry = SessionEntryBase & { type: "model_change"; provider: string; modelId: string };
export type ThinkingLevelChangeEntry = SessionEntryBase & { type: "thinking_level_change"; thinkingLevel: string };
export type CompactionEntry = SessionEntryBase & {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
};
export type BranchSummaryEntry = SessionEntryBase & {
  type: "branch_summary";
  summary: string;
  fromId: string;
  details?: unknown;
  fromHook?: boolean;
};
export type LabelEntry = SessionEntryBase & { type: "label"; targetId: string; label?: string };
export type SessionInfoEntry = SessionEntryBase & { type: "session_info"; name: string };
export type CustomEntry = SessionEntryBase & { type: "custom"; customType: string; data?: unknown };
export type CustomMessageEntry = SessionEntryBase & {
  type: "custom_message";
  customType: string;
  content: unknown;
  display: boolean;
  details?: unknown;
};

/** 全部已知 entry 类型的判别联合(header 不在其中)。 */
export type SessionEntry =
  | MessageEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | LabelEntry
  | SessionInfoEntry
  | CustomEntry
  | CustomMessageEntry;

/** 已知 entry `type` 取值集合,用于解析校验(Req 5.5)。 */
export const KNOWN_ENTRY_TYPES = [
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "label",
  "session_info",
  "custom",
  "custom_message",
] as const;

export type SessionEntryType = (typeof KNOWN_ENTRY_TYPES)[number];

/** 列举条目:可据以排序与定位(Req 6.4)。 */
export interface SessionMeta {
  sessionId: string;
  cwd: string;
  name?: string;
  version: SessionVersion;
  /** 来自 header.timestamp(ISO),用于排序。 */
  createdAt: string;
  /** 最近一次追加时间(可得则填)。 */
  updatedAt?: string;
  /** 条目数(可得则填;列举为性能可省略)。 */
  entryCount?: number;
}

/**
 * 可插拔会话事件存储端口(Req 1.1)。
 *
 * 全部方法异步;`read` 为异步可迭代(流式)。实现可被装饰(包裹另一个
 * `SessionEntryStore` 作为 inner),为中间件(加密/缓冲/缓存/遥测)留接缝
 * (Req 14.1)——本特性不实现任何中间件(Req 14.2)。
 */
export interface SessionEntryStore {
  /** 以会话头部创建会话,返回 sessionId;重复 id 抛 {@link SessionStoreConflictError}(Req 2.1/2.3)。 */
  create(header: SessionHeader): Promise<string>;
  /** 向会话末尾追加一条 entry;`(sessionId, entry.id)` 幂等(Req 3.1/3.4)。 */
  append(sessionId: string, entry: SessionEntry): Promise<void>;
  /** 按给定顺序批量追加,批次可见性一致(Req 4.1/4.2)。 */
  appendBatch(sessionId: string, entries: readonly SessionEntry[]): Promise<void>;
  /** 按追加序流式读回全部 entry;会话不存在则迭代起始即抛(Req 5.1/5.2/5.4)。 */
  read(sessionId: string): AsyncIterable<SessionEntry>;
  /** 读回会话头部;不存在抛 {@link SessionStoreNotFoundError}(Req 2.2/5.3)。 */
  readHeader(sessionId: string): Promise<SessionHeader>;
  /** 列举归属某工作目录的会话;无则返回空数组(Req 6.1/6.3)。 */
  list(cwd: string): Promise<SessionMeta[]>;
  /** 列举跨所有工作目录的会话(Req 6.2)。 */
  listAll(): Promise<SessionMeta[]>;
  /** 删除整会话;不存在抛 {@link SessionStoreNotFoundError}(Req 7.1/7.2)。 */
  delete(sessionId: string): Promise<void>;
}

/** 会话不存在(append/read/readHeader/delete 命中,Req 3.3/5.4/7.2)。 */
export class SessionStoreNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session not found: ${sessionId}`);
    this.name = "SessionStoreNotFoundError";
  }
}

/** 以已存在的 sessionId 重复 create(Req 2.3)。 */
export class SessionStoreConflictError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session already exists: ${sessionId}`);
    this.name = "SessionStoreConflictError";
  }
}

/** header.version 非 1/2/3(Req 9.3)。 */
export class UnknownSessionVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`unknown session version: ${String(version)}`);
    this.name = "UnknownSessionVersionError";
  }
}

/** 已写入条目无法解析为已知形态(Req 5.5)。 */
export class SessionEntryParseError extends Error {
  constructor(
    public readonly detail: { sessionId?: string; position: number | string; cause?: unknown },
  ) {
    super(
      `failed to parse session entry at ${String(detail.position)}` +
        (detail.sessionId ? ` (session ${detail.sessionId})` : ""),
    );
    this.name = "SessionEntryParseError";
  }
}

/**
 * session-meta — `SessionMetaIndex` 的 **Workspace 实现**(spec session-meta-index)。
 *
 * 为什么需要它:`JsonFileSessionMetaIndex` 直接用 `node:fs` + 固定路径,只能在有本地磁盘、
 * 单租户的形态下工作。云端(pi-clouds)注入自己的 `Workspace`(TenantWorkspace)做租户隔离,
 * 任何绕过该端口的持久化在云端都是不可用的。M2/M4 已把 config / favorites / per-source /
 * sources 四个 store 迁到 Workspace 之上,本实现补齐会话展示元数据这一块。
 *
 * ★ **每会话一键**,而不是整份索引存一个键 —— 这是被契约语义逼出来的,不是偏好:
 *   - 契约保证「单键原子可见性」,但**不提供**跨进程锁,也不保证 read-modify-write 原子。
 *     本地实现的 `writeJson(merge:true)` 就是 `read → deepMerge → writeFileAtomic`;
 *     若把整份索引塞进一个键,两个进程并发写不同会话时,后写者会覆盖掉先写者刚加的键
 *     —— 正是 `JsonFileSessionMetaIndex` 用自制锁解决的那个问题,而这里没有锁可用。
 *   - 分键之后,不同会话写的是不同键,单键原子性就够了,不需要任何跨键事务(契约也不提供)。
 *
 * 代价是读放大:全量读要 `list` + N 次 `readJson`。故端口的 `read(sessionIds?)` 允许
 * 只读当前页 —— 列表的常态路径只读 ≤limit 条,全量读只在搜索分支付出。
 *
 * 与文件实现同为**缓存**语义:所有方法绝不抛,失败即「无元数据」(Req 3.5)。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { JsonObject, WorkspaceNamespace } from "../workspace/types.js";
import type { SessionMetaEntry, SessionMetaIndex } from "./types.js";

const log = createLogger({ namespace: "session:meta" });

/** 分组前缀:每个会话一个键 `session-meta/<sessionId>.json`。 */
const PREFIX = "session-meta";

/** 会话标识 → Workspace 键。 */
function keyOf(sessionId: string): string {
  return `${PREFIX}/${sessionId}.json`;
}

/** Workspace 键 → 会话标识(仅接受本前缀下的 `.json` 直接子级)。 */
function sessionIdOf(key: string): string | undefined {
  const prefix = `${PREFIX}/`;
  if (!key.startsWith(prefix) || !key.endsWith(".json")) return undefined;
  const id = key.slice(prefix.length, -".json".length);
  return id.length > 0 ? id : undefined;
}

/**
 * 会话标识是否可安全用作键的一段。
 *
 * ⚠ 键空间规则是**安全边界**(见 workspace/key.ts):`/`、`..`、控制字符等都可能造成
 * 越权读写。sessionId 本应是 uuid,但它来自请求参数,不能假定;此处显式挡一道,
 * 不合规即静默跳过(元数据是展示增强,拒绝写入远好过越界)。
 */
function isSafeSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(sessionId) &&
    sessionId !== "." &&
    sessionId !== ".."
  );
}

/** 取可选字符串字段;类型不符即视为缺省(**只丢该字段**,不丢整条,Req 3.3)。 */
function optionalString(
  raw: JsonObject,
  field: string,
  sessionId: string,
): string | undefined {
  const v = raw[field];
  if (v === undefined) return undefined;
  if (typeof v === "string" && v.length > 0) return v;
  log.debug("workspace meta field dropped", { sessionId, field });
  return undefined;
}

/** 逐字段校验单条目;全字段都不可用时返回 undefined。 */
function parseEntry(raw: JsonObject, sessionId: string): SessionMetaEntry | undefined {
  const title = optionalString(raw, "title", sessionId);
  const agentSource = optionalString(raw, "agentSource", sessionId);
  const updatedAt = optionalString(raw, "updatedAt", sessionId);
  if (title === undefined && agentSource === undefined && updatedAt === undefined) {
    return undefined;
  }
  return {
    ...(title !== undefined ? { title } : {}),
    ...(agentSource !== undefined ? { agentSource } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export interface WorkspaceSessionMetaIndexOptions {
  /** 时间源(测试可注入确定性实现)。 */
  readonly now?: () => Date;
}

export class WorkspaceSessionMetaIndex implements SessionMetaIndex {
  readonly #ns: WorkspaceNamespace;
  readonly #now: () => Date;

  /**
   * @param ns 用户级命名空间。本地传 `createLocalWorkspaceNamespace(agentDir)`;
   *           云端传注入的 `workspace.user`(TenantWorkspace)。
   */
  constructor(ns: WorkspaceNamespace, opts: WorkspaceSessionMetaIndexOptions = {}) {
    this.#ns = ns;
    this.#now = opts.now ?? ((): Date => new Date());
  }

  async read(
    sessionIds?: readonly string[],
  ): Promise<ReadonlyMap<string, SessionMetaEntry>> {
    const out = new Map<string, SessionMetaEntry>();
    let ids: readonly string[];
    if (sessionIds !== undefined) {
      // 只读指定会话:列表常态路径(一页 ≤limit 条),避开全量读放大。
      ids = sessionIds.filter(isSafeSessionId);
    } else {
      try {
        const keys = await this.#ns.list(PREFIX);
        ids = keys.map(sessionIdOf).filter((x): x is string => x !== undefined);
      } catch (err) {
        log.debug("workspace meta list failed", { error: describe(err) });
        return out;
      }
    }
    // 逐键读;单键失败只丢那一条(损坏/越权/IO 都不该拖垮整份读取,Req 3.1/3.2/3.3)。
    await Promise.all(
      ids.map(async (id) => {
        try {
          const raw = await this.#ns.readJson(keyOf(id));
          const entry = parseEntry(raw, id);
          if (entry !== undefined) out.set(id, entry);
        } catch (err) {
          log.debug("workspace meta read failed", { sessionId: id, error: describe(err) });
        }
      }),
    );
    return out;
  }

  async merge(sessionId: string, patch: SessionMetaEntry): Promise<void> {
    if (!isSafeSessionId(sessionId)) return;
    const values: JsonObject = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.agentSource !== undefined ? { agentSource: patch.agentSource } : {}),
      updatedAt: patch.updatedAt ?? this.#now().toISOString(),
    };
    try {
      // merge:true(缺省)= 与既有值深度合并 → patch 未提供的字段保持原值(Req 4.4 的"字段级")。
      // 单键写,契约保证原子可见性;不同会话写不同键,故并发写天然互不影响(Req 4.1/4.2)。
      await this.#ns.writeJson(keyOf(sessionId), values);
    } catch (err) {
      log.debug("workspace meta write failed", { sessionId, error: describe(err) });
    }
  }

  async remove(sessionId: string): Promise<void> {
    if (!isSafeSessionId(sessionId)) return;
    try {
      await this.#ns.delete(keyOf(sessionId)); // 键不存在 → 幂等成功(契约 Req 2.8)
    } catch (err) {
      log.debug("workspace meta delete failed", { sessionId, error: describe(err) });
    }
  }

  async prune(existingSessionIds: Iterable<string>): Promise<number> {
    const keep = new Set(existingSessionIds);
    let keys: readonly string[];
    try {
      keys = await this.#ns.list(PREFIX);
    } catch (err) {
      log.debug("workspace meta prune list failed", { error: describe(err) });
      return 0;
    }
    let removed = 0;
    for (const key of keys) {
      const id = sessionIdOf(key);
      if (id === undefined || keep.has(id)) continue;
      try {
        await this.#ns.delete(key);
        removed += 1;
      } catch (err) {
        // 单键删除失败不影响其余(逐键删,无整份覆盖 → 不存在"清了一半把别的搞坏"的风险)。
        log.debug("workspace meta prune delete failed", { key, error: describe(err) });
      }
    }
    return removed;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

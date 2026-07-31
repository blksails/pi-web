/**
 * session-meta — `SessionMetaIndex` 的 **SQLite 实现**(spec session-meta-index)。
 *
 * 三条实现里最适合本地重度使用的一条:
 *
 *  | 实现 | 写并发 | 单次写成本 | 适用 |
 *  |---|---|---|---|
 *  | `JsonFileSessionMetaIndex` | 自制跨进程锁 | 整份 read + write | 本地默认,会话量小 |
 *  | `WorkspaceSessionMetaIndex` | 契约的单键原子(每会话一键) | 单键 | 云端(租户隔离) |
 *  | **本实现** | **数据库事务 + WAL** | **单行 upsert** | 本地会话量大 / 多进程共写 |
 *
 * ★ 这里**没有任何自制锁**,也不需要:并发控制交给 SQLite。JSON 文件实现之所以要
 *   `mkdir` 锁 + 读-合并-写,是因为"整份文件"这个存储形态下,两个进程的 RMW 会互相
 *   覆盖;行存储 + `ON CONFLICT DO UPDATE` 天然是原子的字段级更新,写谁的行就只动谁的行。
 *
 * ★ 字段级合并靠 `COALESCE(excluded.x, session_meta.x)`:patch 里没给的字段传 NULL,
 *   于是保留原值 —— 这与端口约定的"patch 未提供的字段保持原值"逐字对应,不需要先读后写。
 *
 * 与另两条实现同为**缓存**语义:所有方法绝不抛,失败即「无元数据」(Req 3.5)。
 * 零外部依赖:`node:sqlite` 是 Node 内置(同 `session-store/sqlite-store.ts` 的既有用法),
 * 内核包的依赖声明里不会出现数据库驱动。
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createLogger } from "@blksails/pi-web-logger";
import type { SessionMetaEntry, SessionMetaIndex } from "./types.js";

const log = createLogger({ namespace: "session:meta" });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_meta (
  session_id   TEXT PRIMARY KEY,
  title        TEXT,
  agent_source TEXT,
  updated_at   TEXT
);
`;

/**
 * 惰性加载 `node:sqlite`(照抄 `session-store/sqlite-store.ts` 的既有做法):
 * 经 createRequire 在运行时由 Node 原生加载,避免打包器对这个较新的内置模块做静态解析而失败。
 * 不用 `import.meta.url` —— standalone 下会被内联成构建机绝对路径,跨 OS 会抛。
 */
const loadNodeSqlite = (): typeof import("node:sqlite") =>
  createRequire(join(process.cwd(), "noop.cjs"))("node:sqlite");

/** 默认库路径:`~/.pi/agent/piweb-session-meta.db`(在 sessions 目录**之外**,同文件实现的取位)。 */
export function defaultSessionMetaDbPath(): string {
  return join(homedir(), ".pi", "agent", "piweb-session-meta.db");
}

/** 解析库路径:env 覆盖优先,否则默认路径。 */
export function sessionMetaDbPathFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env["PI_WEB_SESSION_META_DB_PATH"];
  return override !== undefined && override.length > 0
    ? override
    : defaultSessionMetaDbPath();
}

/** 取行里的可选字符串列;NULL/空串/类型不符 → 缺省。 */
function optionalText(row: Record<string, unknown>, col: string): string | undefined {
  const v = row[col];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 行 → 条目;全列都空则视为无元数据(与另两条实现一致)。 */
function toEntry(row: Record<string, unknown>): SessionMetaEntry | undefined {
  const title = optionalText(row, "title");
  const agentSource = optionalText(row, "agent_source");
  const updatedAt = optionalText(row, "updated_at");
  if (title === undefined && agentSource === undefined && updatedAt === undefined) {
    return undefined;
  }
  return {
    ...(title !== undefined ? { title } : {}),
    ...(agentSource !== undefined ? { agentSource } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export interface SqliteSessionMetaIndexOptions {
  /** 库路径或已建好的实例;省略时经 env / 默认路径解析。`:memory:` 用于测试。 */
  readonly db?: DatabaseSync | string;
  /** 时间源(测试可注入确定性实现)。 */
  readonly now?: () => Date;
}

export class SqliteSessionMetaIndex implements SessionMetaIndex {
  /** 打不开/建不了表时为 undefined —— 此后所有方法降级为「无元数据」,绝不抛(Req 3.5)。 */
  readonly #db: DatabaseSync | undefined;
  readonly #now: () => Date;

  constructor(opts: SqliteSessionMetaIndexOptions = {}) {
    this.#now = opts.now ?? ((): Date => new Date());
    const target = opts.db ?? sessionMetaDbPathFromEnv();
    this.#db = openOrRebuild(target);
  }

  /** 释放底层句柄(测试与优雅停机用)。 */
  close(): void {
    try {
      this.#db?.close();
    } catch {
      /* 已关闭 */
    }
  }

  async read(
    sessionIds?: readonly string[],
  ): Promise<ReadonlyMap<string, SessionMetaEntry>> {
    const out = new Map<string, SessionMetaEntry>();
    const db = this.#db;
    if (db === undefined) return out;
    try {
      let rows: Record<string, unknown>[];
      if (sessionIds === undefined) {
        rows = db
          .prepare("SELECT session_id, title, agent_source, updated_at FROM session_meta")
          .all() as Record<string, unknown>[];
      } else {
        const ids = sessionIds.filter((id) => id.length > 0);
        if (ids.length === 0) return out;
        // 参数化 IN 列表:占位符按数量生成,标识永不拼进 SQL 文本。
        const placeholders = ids.map(() => "?").join(",");
        rows = db
          .prepare(
            `SELECT session_id, title, agent_source, updated_at FROM session_meta WHERE session_id IN (${placeholders})`,
          )
          .all(...ids) as Record<string, unknown>[];
      }
      for (const row of rows) {
        const id = optionalText(row, "session_id");
        if (id === undefined) continue;
        const entry = toEntry(row);
        if (entry !== undefined) out.set(id, entry);
      }
    } catch (err) {
      log.debug("sqlite meta read failed", { error: describe(err) });
      return new Map();
    }
    return out;
  }

  async merge(sessionId: string, patch: SessionMetaEntry): Promise<void> {
    if (sessionId.length === 0 || this.#db === undefined) return;
    const updatedAt = patch.updatedAt ?? this.#now().toISOString();
    try {
      // 单行 upsert + COALESCE:patch 未提供的列传 NULL → 保留原值(字段级合并)。
      // 整个语句是一次原子写,不需要先读后写,故不存在 RMW 竞态。
      this.#db
        .prepare(
          `INSERT INTO session_meta (session_id, title, agent_source, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             title        = COALESCE(excluded.title, session_meta.title),
             agent_source = COALESCE(excluded.agent_source, session_meta.agent_source),
             updated_at   = excluded.updated_at`,
        )
        .run(sessionId, patch.title ?? null, patch.agentSource ?? null, updatedAt);
    } catch (err) {
      log.debug("sqlite meta write failed", { sessionId, error: describe(err) });
    }
  }

  async remove(sessionId: string): Promise<void> {
    if (sessionId.length === 0 || this.#db === undefined) return;
    try {
      this.#db.prepare("DELETE FROM session_meta WHERE session_id = ?").run(sessionId);
    } catch (err) {
      log.debug("sqlite meta delete failed", { sessionId, error: describe(err) });
    }
  }

  async prune(existingSessionIds: Iterable<string>): Promise<number> {
    const keep = [...new Set(existingSessionIds)].filter((id) => id.length > 0);
    if (this.#db === undefined) return 0;
    try {
      if (keep.length === 0) {
        const r = this.#db.prepare("DELETE FROM session_meta").run();
        return Number(r.changes ?? 0);
      }
      const placeholders = keep.map(() => "?").join(",");
      const r = this.#db
        .prepare(
          `DELETE FROM session_meta WHERE session_id NOT IN (${placeholders})`,
        )
        .run(...keep);
      return Number(r.changes ?? 0);
    } catch (err) {
      log.debug("sqlite meta prune failed", { error: describe(err) });
      return 0;
    }
  }
}

/**
 * 打开库并建表;**损坏即重建**(索引是缓存,可从会话历史重建 —— 见端口注释)。
 *
 * 顺序:直接打开 → 建表。任一步失败且目标是文件路径,则删掉该文件重来一次;
 * 再失败就返回 undefined,此后整个实例降级为「无元数据」而不是抛 —— 端口契约要求
 * 所有方法绝不抛,构造期也不例外(否则装配阶段一个坏文件就能拖垮整个宿主)。
 */
function openOrRebuild(target: DatabaseSync | string): DatabaseSync | undefined {
  if (typeof target !== "string") {
    try {
      target.exec(SCHEMA);
      return target;
    } catch (err) {
      log.debug("sqlite meta schema failed on injected handle", { error: describe(err) });
      return undefined;
    }
  }

  const openOnce = (): DatabaseSync => {
    if (target !== ":memory:") {
      // 目录不存在时 SQLite 直接报 unable to open;先建出来(与文件实现的 mkdir 同理)。
      mkdirSync(dirname(target), { recursive: true });
    }
    const db = new (loadNodeSqlite().DatabaseSync)(target);
    db.exec(SCHEMA);
    // WAL:多进程共写时读不阻塞写、写不阻塞读。内存库不支持 WAL,忽略其报错。
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } catch {
      /* :memory: 或不支持 WAL 的文件系统 —— 退回默认日志模式,不影响正确性。 */
    }
    return db;
  };

  try {
    return openOnce();
  } catch (err) {
    log.debug("sqlite meta open failed; rebuilding", {
      path: target,
      error: describe(err),
    });
  }
  if (target === ":memory:") return undefined;
  // 重建:删掉损坏的库(连同 WAL/SHM 边文件)再开一次。
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${target}${suffix}`, { force: true });
    } catch {
      /* 删不掉就让下面的重开失败,进入禁用态 */
    }
  }
  try {
    return openOnce();
  } catch (err) {
    log.debug("sqlite meta rebuild failed; index disabled", {
      path: target,
      error: describe(err),
    });
    return undefined;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

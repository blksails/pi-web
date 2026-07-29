/**
 * session-store-adapters — SQLite adapter(基于 Node 内置 `node:sqlite`)。
 *
 * 单机零运维的结构化后端。会话头部与条目分别落 `sessions` / `entries` 表,
 * 可观察语义与 fs adapter 一致(Req 11.1)。`(session_id, id)` 主键 + `ON CONFLICT
 * DO NOTHING` 实现幂等(Req 3.4/8.2);批量在事务内(Req 4.2);`seq` 表达追加序,
 * `read` 用 `iterate()` 流式产出(Req 5.1/5.2)。
 *
 * 注:`node:sqlite` 为实验特性,导入/使用时会打印一次性 ExperimentalWarning。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { makeStoredEntryNormalizer, parseHeader, parseLine, serializeEntry, serializeHeader } from "./codec.js";
import {
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  type SessionEntry,
  type SessionEntryStore,
  type SessionHeader,
  type SessionMeta,
  type SessionVersion,
} from "./types.js";

type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  cwd            TEXT NOT NULL,
  name           TEXT,
  version        INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  parent_session TEXT,
  header_json    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  session_id   TEXT NOT NULL,
  id           TEXT NOT NULL,
  parent_id    TEXT,
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_seq    ON entries(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_parent ON entries(session_id, parent_id);
`;

/**
 * 惰性加载 `node:sqlite`:经 createRequire 在运行时由 Node 原生加载,避免打包器
 * (vite/webpack)对这个较新的内置模块做静态解析而失败。类型经 `import type` 擦除。
 */
const loadNodeSqlite = (): typeof import("node:sqlite") =>
  // createRequire 的 base 仅需在**运行 OS** 上合法;node:sqlite 是内置,解析与 base 无关。
  // 不用 import.meta.url:standalone 里被 webpack 内联成构建机绝对路径,Windows 上对该
  // Linux URL 调 createRequire 会抛 ERR_INVALID_FILE_URL_PATH。cwd 是运行 OS 的合法绝对路径。
  createRequire(join(process.cwd(), "noop.cjs"))("node:sqlite");

export class SqliteSessionEntryStore implements SessionEntryStore {
  readonly #db: DatabaseSync;

  /** 传入 `:memory:`、文件路径或已建好的 DatabaseSync 实例。 */
  constructor(db: DatabaseSync | string = ":memory:") {
    this.#db = typeof db === "string" ? new (loadNodeSqlite().DatabaseSync)(db) : db;
    this.#db.exec(SCHEMA);
  }

  /** 释放底层数据库句柄(便于重开同一文件库验证持久化)。 */
  close(): void {
    this.#db.close();
  }

  async create(header: SessionHeader): Promise<string> {
    const exists = this.#db.prepare("SELECT 1 FROM sessions WHERE session_id = ?").get(header.id);
    if (exists) throw new SessionStoreConflictError(header.id);
    this.#db
      .prepare(
        "INSERT INTO sessions (session_id, cwd, name, version, created_at, parent_session, header_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        header.id,
        header.cwd,
        header.name ?? null,
        header.version,
        header.timestamp,
        header.parentSession ?? null,
        serializeHeader(header),
      );
    return header.id;
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    await this.appendBatch(sessionId, [entry]);
  }

  async appendBatch(sessionId: string, entries: readonly SessionEntry[]): Promise<void> {
    this.#ensureExists(sessionId);
    if (entries.length === 0) return;
    const db = this.#db;
    db.exec("BEGIN");
    try {
      let seq = this.#maxSeq(sessionId);
      const insert = db.prepare(
        "INSERT INTO entries (session_id, id, parent_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, id) DO NOTHING",
      );
      const localSeen = new Set<string>();
      let latestName: string | undefined;
      for (const entry of entries) {
        if (localSeen.has(entry.id)) continue;
        localSeen.add(entry.id);
        seq += 1;
        insert.run(sessionId, entry.id, entry.parentId, seq, entry.type, serializeEntry(entry), entry.timestamp);
        // 维护去规范化的 name 列(spec auto-session-title, Req 8.4):session_info 即会话显示名,
        // 最新生效 → 列表 SessionMeta.name 据此显示自动标题,无需读侧扫 entries。
        if (entry.type === "session_info") {
          latestName = (entry as { name?: string }).name;
        }
      }
      if (latestName !== undefined) {
        db.prepare("UPDATE sessions SET name = ? WHERE session_id = ?").run(latestName, sessionId);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async *read(sessionId: string): AsyncIterable<SessionEntry> {
    const header = this.#headerOrThrow(sessionId);
    const normalize = makeStoredEntryNormalizer(header.version);
    const stmt = this.#db.prepare(
      "SELECT payload_json FROM entries WHERE session_id = ? ORDER BY seq, id",
    );
    let position = 0;
    for (const row of stmt.iterate(sessionId)) {
      const payload = (row as Row)["payload_json"];
      if (typeof payload !== "string") continue;
      const parsed = parseLine(payload, position, sessionId);
      position += 1;
      if (parsed.type === "session") continue;
      yield normalize(parsed);
    }
  }

  async readHeader(sessionId: string): Promise<SessionHeader> {
    return this.#headerOrThrow(sessionId);
  }

  async list(cwd: string): Promise<SessionMeta[]> {
    const rows = this.#db
      .prepare(
        "SELECT session_id, cwd, name, version, created_at FROM sessions WHERE cwd = ? ORDER BY created_at",
      )
      .all(cwd) as Row[];
    return rows.map(rowToMeta);
  }

  async listAll(): Promise<SessionMeta[]> {
    const rows = this.#db
      .prepare("SELECT session_id, cwd, name, version, created_at FROM sessions ORDER BY created_at")
      .all() as Row[];
    return rows.map(rowToMeta);
  }

  async delete(sessionId: string): Promise<void> {
    this.#ensureExists(sessionId);
    const db = this.#db;
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM entries WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- 内部 ----

  #ensureExists(sessionId: string): void {
    const row = this.#db.prepare("SELECT 1 FROM sessions WHERE session_id = ?").get(sessionId);
    if (!row) throw new SessionStoreNotFoundError(sessionId);
  }

  #headerOrThrow(sessionId: string): SessionHeader {
    const row = this.#db
      .prepare("SELECT header_json FROM sessions WHERE session_id = ?")
      .get(sessionId) as Row | undefined;
    if (!row) throw new SessionStoreNotFoundError(sessionId);
    const headerJson = row["header_json"];
    return parseHeader(typeof headerJson === "string" ? JSON.parse(headerJson) : headerJson, 0);
  }

  #maxSeq(sessionId: string): number {
    const row = this.#db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM entries WHERE session_id = ?")
      .get(sessionId) as Row | undefined;
    return row ? Number(row["m"]) : 0;
  }
}

function rowToMeta(row: Row): SessionMeta {
  const name = row["name"];
  return {
    sessionId: String(row["session_id"]),
    cwd: String(row["cwd"]),
    name: name == null ? undefined : String(name),
    version: Number(row["version"]) as SessionVersion,
    createdAt: String(row["created_at"]),
  };
}

/**
 * session-store-adapters — PostgreSQL adapter(注入 `pg` 连接池)。
 *
 * 多实例共享后端:同一库下一个实例写入可被其他实例读到(Req 12.2)。schema 与
 * sqlite 一致,可观察语义与 fs/sqlite adapter 一致(Req 12.1)。`(session_id, id)`
 * 主键 + `ON CONFLICT DO NOTHING` 幂等、并发同父=分叉(Req 12.3/8);批量在事务内;
 * `read` 用 keyset 分页流式产出(Req 5.2)。
 *
 * `pg` 仅以 `import type` 引入(运行时擦除),连接池由调用方注入——本文件不在运行时
 * 加载 `pg`,未用 PG 的部署不受影响(research.md 决策)。
 */
import type { Pool, QueryResult } from "pg";
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

interface PgRow {
  [column: string]: unknown;
}

const READ_PAGE_SIZE = 500;

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
  seq          BIGINT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_seq    ON entries(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_parent ON entries(session_id, parent_id);
`;

export class PostgresSessionEntryStore implements SessionEntryStore {
  readonly #pool: Pool;
  #ready: Promise<void> | undefined;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async create(header: SessionHeader): Promise<string> {
    await this.#init();
    const exists = await this.#pool.query("SELECT 1 FROM sessions WHERE session_id = $1", [header.id]);
    if ((exists.rowCount ?? 0) > 0) throw new SessionStoreConflictError(header.id);
    // ON CONFLICT DO NOTHING 让真实 PG 下的并发竞态优雅降级(不崩溃),冲突判定以上面的存在性检查为准。
    await this.#pool.query(
      "INSERT INTO sessions (session_id, cwd, name, version, created_at, parent_session, header_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id) DO NOTHING",
      [
        header.id,
        header.cwd,
        header.name ?? null,
        header.version,
        header.timestamp,
        header.parentSession ?? null,
        serializeHeader(header),
      ],
    );
    return header.id;
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    await this.appendBatch(sessionId, [entry]);
  }

  async appendBatch(sessionId: string, entries: readonly SessionEntry[]): Promise<void> {
    await this.#init();
    await this.#ensureExists(sessionId);
    if (entries.length === 0) return;
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const seqRes = await client.query<PgRow>(
        "SELECT COALESCE(MAX(seq), 0) AS m FROM entries WHERE session_id = $1",
        [sessionId],
      );
      let seq = Number(seqRes.rows[0]?.["m"] ?? 0);
      const localSeen = new Set<string>();
      for (const entry of entries) {
        if (localSeen.has(entry.id)) continue;
        localSeen.add(entry.id);
        seq += 1;
        await client.query(
          "INSERT INTO entries (session_id, id, parent_id, seq, type, payload_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id, id) DO NOTHING",
          [sessionId, entry.id, entry.parentId, seq, entry.type, serializeEntry(entry), entry.timestamp],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async *read(sessionId: string): AsyncIterable<SessionEntry> {
    await this.#init();
    const header = await this.#headerOrThrow(sessionId);
    const normalize = makeStoredEntryNormalizer(header.version);
    let cursorSeq: number | null = null;
    let cursorId = "";
    let position = 0;
    for (;;) {
      const res: QueryResult<PgRow> =
        cursorSeq === null
          ? await this.#pool.query<PgRow>(
              "SELECT seq, id, payload_json FROM entries WHERE session_id = $1 ORDER BY seq, id LIMIT $2",
              [sessionId, READ_PAGE_SIZE],
            )
          : await this.#pool.query<PgRow>(
              "SELECT seq, id, payload_json FROM entries WHERE session_id = $1 AND (seq > $2 OR (seq = $2 AND id > $3)) ORDER BY seq, id LIMIT $4",
              [sessionId, cursorSeq, cursorId, READ_PAGE_SIZE],
            );
      if (res.rows.length === 0) break;
      for (const row of res.rows) {
        const payload = row["payload_json"];
        if (typeof payload !== "string") continue;
        const parsed = parseLine(payload, position, sessionId);
        position += 1;
        if (parsed.type === "session") continue;
        yield normalize(parsed);
      }
      const last = res.rows[res.rows.length - 1];
      if (!last) break;
      cursorSeq = Number(last["seq"]);
      cursorId = String(last["id"]);
      if (res.rows.length < READ_PAGE_SIZE) break;
    }
  }

  async readHeader(sessionId: string): Promise<SessionHeader> {
    await this.#init();
    return this.#headerOrThrow(sessionId);
  }

  async list(cwd: string): Promise<SessionMeta[]> {
    await this.#init();
    const res = await this.#pool.query<PgRow>(
      "SELECT session_id, cwd, name, version, created_at FROM sessions WHERE cwd = $1 ORDER BY created_at",
      [cwd],
    );
    return res.rows.map(rowToMeta);
  }

  async listAll(): Promise<SessionMeta[]> {
    await this.#init();
    const res = await this.#pool.query<PgRow>(
      "SELECT session_id, cwd, name, version, created_at FROM sessions ORDER BY created_at",
    );
    return res.rows.map(rowToMeta);
  }

  async delete(sessionId: string): Promise<void> {
    await this.#init();
    await this.#ensureExists(sessionId);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM entries WHERE session_id = $1", [sessionId]);
      await client.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- 内部 ----

  /** 首次操作时幂等建表(单飞)。 */
  #init(): Promise<void> {
    if (!this.#ready) {
      this.#ready = this.#pool.query(SCHEMA).then(() => undefined);
    }
    return this.#ready;
  }

  async #ensureExists(sessionId: string): Promise<void> {
    const res = await this.#pool.query("SELECT 1 FROM sessions WHERE session_id = $1", [sessionId]);
    if (res.rowCount === 0) throw new SessionStoreNotFoundError(sessionId);
  }

  async #headerOrThrow(sessionId: string): Promise<SessionHeader> {
    const res = await this.#pool.query<PgRow>("SELECT header_json FROM sessions WHERE session_id = $1", [
      sessionId,
    ]);
    const row = res.rows[0];
    if (!row) throw new SessionStoreNotFoundError(sessionId);
    const headerJson = row["header_json"];
    return parseHeader(typeof headerJson === "string" ? JSON.parse(headerJson) : headerJson, 0);
  }
}

function rowToMeta(row: PgRow): SessionMeta {
  const name = row["name"];
  return {
    sessionId: String(row["session_id"]),
    cwd: String(row["cwd"]),
    name: name == null ? undefined : String(name),
    version: Number(row["version"]) as SessionVersion,
    createdAt: String(row["created_at"]),
  };
}

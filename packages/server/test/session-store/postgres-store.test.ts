/**
 * postgres adapter:用内存 PG(pg-mem)跑通契约 + 多实例共享可见性(Req 12.x)。
 * 若设置 TEST_POSTGRES_URL,则对真实 PostgreSQL 附加运行同一套契约。
 */
import type { Pool } from "pg";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { PostgresSessionEntryStore } from "../../src/session-store/postgres-store.js";
import { collect, header, msg, runStoreContract } from "./contract.js";

/** 用 pg-mem 造一个与 pg 兼容的 Pool;返回的多个 Pool 共享同一内存库。 */
function memDb() {
  // noAstCoverageCheck:绕过 pg-mem 对 CREATE TABLE 约束的严格 AST 覆盖检查(真实 PG 无此限制)。
  const db = newDb({ noAstCoverageCheck: true });
  const { Pool } = db.adapters.createPg();
  return {
    newPool: () => new Pool() as unknown as Pool,
  };
}

runStoreContract("PostgresSessionEntryStore (pg-mem)", () => {
  const { newPool } = memDb();
  const pool = newPool();
  return { store: new PostgresSessionEntryStore(pool), cleanup: async () => { await pool.end(); } };
});

describe("postgres adapter 专项", () => {
  it("两个实例共享同库:一方写入可被另一方读到(Req 12.2)", async () => {
    const { newPool } = memDb();
    const writer = new PostgresSessionEntryStore(newPool());
    const reader = new PostgresSessionEntryStore(newPool());
    await writer.create(header("s1", "/proj"));
    await writer.appendBatch("s1", [msg("e1", null), msg("e2", "e1")]);
    const ids = (await collect(reader.read("s1"))).map((e) => e.id);
    expect(ids).toEqual(["e1", "e2"]);
    const all = (await reader.listAll()).map((m) => m.sessionId);
    expect(all).toContain("s1");
  });
});

const realUrl = process.env["TEST_POSTGRES_URL"];
if (realUrl) {
  runStoreContract("PostgresSessionEntryStore (real)", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: realUrl });
    await pool.query("DROP TABLE IF EXISTS entries");
    await pool.query("DROP TABLE IF EXISTS sessions");
    return { store: new PostgresSessionEntryStore(pool), cleanup: async () => { await pool.end(); } };
  });
}

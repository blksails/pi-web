/**
 * sqlite adapter:跑通契约工厂 + 重开同一文件库后数据仍在(Req 11.x)。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteSessionEntryStore } from "../../src/session-store/sqlite-store.js";
import { collect, header, msg, runStoreContract } from "./contract.js";

runStoreContract("SqliteSessionEntryStore", () => {
  const store = new SqliteSessionEntryStore(":memory:");
  return { store, cleanup: () => store.close() };
});

describe("sqlite adapter 专项", () => {
  it("重开同一文件库后此前数据仍可读回(Req 11.3)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-sqlite-"));
    const dbPath = join(dir, "sessions.db");
    try {
      const first = new SqliteSessionEntryStore(dbPath);
      await first.create(header("s1", "/proj"));
      await first.appendBatch("s1", [msg("e1", null), msg("e2", "e1")]);
      first.close();

      const second = new SqliteSessionEntryStore(dbPath);
      const head = await second.readHeader("s1");
      expect(head.cwd).toBe("/proj");
      const ids = (await collect(second.read("s1"))).map((e) => e.id);
      expect(ids).toEqual(["e1", "e2"]);
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

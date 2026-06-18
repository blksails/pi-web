/**
 * createSessionEntryStore / sessionStoreConfigFromEnv 单测:
 * 验证按配置/环境选择正确 adapter,且选出的 store 可正常读写;并校验 env 解析与错误。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSessionEntryStore,
  FsSessionEntryStore,
  PostgresSessionEntryStore,
  sessionStoreConfigFromEnv,
  SqliteSessionEntryStore,
} from "../../src/session-store/index.js";
import { collect, header, msg } from "./contract.js";

describe("createSessionEntryStore 工厂选择 adapter", () => {
  it("kind=fs → FsSessionEntryStore,且可创建/追加/读回", async () => {
    const root = mkdtempSync(join(tmpdir(), "fac-fs-"));
    try {
      const store = await createSessionEntryStore({ kind: "fs", root });
      expect(store).toBeInstanceOf(FsSessionEntryStore);
      await store.create(header("s1", "/p"));
      await store.append("s1", msg("e1", null));
      expect((await collect(store.read("s1"))).map((e) => e.id)).toEqual(["e1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("kind=sqlite → SqliteSessionEntryStore,且可创建/追加/读回", async () => {
    const store = await createSessionEntryStore({ kind: "sqlite", path: ":memory:" });
    expect(store).toBeInstanceOf(SqliteSessionEntryStore);
    await store.create(header("s1"));
    await store.append("s1", msg("e1", null));
    expect((await collect(store.read("s1"))).map((e) => e.id)).toEqual(["e1"]);
  });

  it("kind=postgres → PostgresSessionEntryStore(仅构造,不连接)", async () => {
    const store = await createSessionEntryStore({
      kind: "postgres",
      connectionString: "postgres://user@localhost:5432/none",
    });
    expect(store).toBeInstanceOf(PostgresSessionEntryStore);
  });

  it("postgres 缺 connectionString 时抛错", async () => {
    await expect(createSessionEntryStore({ kind: "postgres", connectionString: "" })).rejects.toThrow(
      /connectionString/,
    );
  });
});

describe("sessionStoreConfigFromEnv 环境解析", () => {
  it("未设 / 显式 fs → fs(可选 root)", () => {
    expect(sessionStoreConfigFromEnv({})).toEqual({ kind: "fs" });
    expect(sessionStoreConfigFromEnv({ SESSION_STORE: "fs", SESSION_STORE_ROOT: "/data/s" })).toEqual({
      kind: "fs",
      root: "/data/s",
    });
  });

  it("sqlite → 解析 SESSION_STORE_PATH", () => {
    expect(sessionStoreConfigFromEnv({ SESSION_STORE: "sqlite", SESSION_STORE_PATH: "/data/s.db" })).toEqual({
      kind: "sqlite",
      path: "/data/s.db",
    });
  });

  it("postgres → 解析 DATABASE_URL", () => {
    expect(sessionStoreConfigFromEnv({ SESSION_STORE: "postgres", DATABASE_URL: "postgres://x/db" })).toEqual({
      kind: "postgres",
      connectionString: "postgres://x/db",
    });
  });

  it("未知 SESSION_STORE 值抛错", () => {
    expect(() => sessionStoreConfigFromEnv({ SESSION_STORE: "redis" })).toThrow(/unknown SESSION_STORE/);
  });
});

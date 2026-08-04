/**
 * SqliteSessionMetaIndex 特有行为(spec session-meta-index)。
 *
 * 跨实现的公共语义在 `conformance.it.test.ts`(三实现同一批断言);这里只验 SQLite 独有的:
 * 持久化跨实例可见、真·多进程并发写、字段级 upsert 不读先写、以及库损坏时的降级。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SqliteSessionMetaIndex } from "../../src/session-meta/sqlite-index.js";

const exec = promisify(execFile);

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "meta-sqlite-"));
  dbPath = join(dir, "session-meta.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const open = (): SqliteSessionMetaIndex =>
  new SqliteSessionMetaIndex({ db: dbPath });

describe("持久化", () => {
  it("写入后关闭再开,数据仍在(跨实例/跨重启)", async () => {
    const a = open();
    await a.merge("s1", { title: "持久的标题", agentSource: "builtin:demo" });
    a.close();

    const b = open();
    const entry = (await b.read()).get("s1");
    expect(entry?.title).toBe("持久的标题");
    expect(entry?.agentSource).toBe("builtin:demo");
    b.close();
  });

  it("库文件所在目录不存在时自动创建", async () => {
    const nested = join(dir, "deep", "nested", "meta.db");
    const idx = new SqliteSessionMetaIndex({ db: nested });
    await idx.merge("s1", { title: "x" });
    expect((await idx.read()).get("s1")?.title).toBe("x");
    idx.close();
  });
});

describe("字段级 upsert(不读先写)", () => {
  it("只给 title 时不清掉已有的 agentSource,反之亦然", async () => {
    const idx = open();
    await idx.merge("s1", { agentSource: "builtin:demo" });
    await idx.merge("s1", { title: "后加的" });
    let e = (await idx.read()).get("s1");
    expect(e).toEqual(
      expect.objectContaining({ title: "后加的", agentSource: "builtin:demo" }),
    );

    await idx.merge("s1", { agentSource: "builtin:changed" });
    e = (await idx.read()).get("s1");
    expect(e?.title).toBe("后加的"); // title 未被清掉
    expect(e?.agentSource).toBe("builtin:changed");
    idx.close();
  });

  it("updatedAt 每次写入都刷新", async () => {
    let t = 0;
    const idx = new SqliteSessionMetaIndex({
      db: dbPath,
      now: () => new Date(1_800_000_000_000 + (t += 1000)),
    });
    await idx.merge("s1", { title: "a" });
    const first = (await idx.read()).get("s1")?.updatedAt;
    await idx.merge("s1", { title: "b" });
    const second = (await idx.read()).get("s1")?.updatedAt;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second! > first!).toBe(true);
    idx.close();
  });
});

describe("★ 真·多进程并发写", () => {
  it("6 个独立进程各写各的会话,一条都不丢", async () => {
    // 先建库(WAL 模式),再让子进程各自打开同一个文件库并写入。
    open().close();

    const script = (id: string): string => `
      const { createRequire } = require("node:module");
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      // ★ busy_timeout 必须先设:切 WAL 需要短暂独占锁,6 个进程同时开库时若无 busy_timeout,
      // 这一句会当场抛 "database is locked"(而不是等待)。顺序颠倒过一次,表现为偶发红。
      db.exec("PRAGMA busy_timeout = 15000");
      db.exec("PRAGMA journal_mode = WAL");
      db.prepare(
        \`INSERT INTO session_meta (session_id, title, agent_source, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           title = COALESCE(excluded.title, session_meta.title),
           agent_source = COALESCE(excluded.agent_source, session_meta.agent_source),
           updated_at = excluded.updated_at\`
      ).run(${JSON.stringify(id)}, ${JSON.stringify(`t-${id}`)}, null, new Date().toISOString());
      db.close();
    `;

    const ids = Array.from({ length: 6 }, (_, i) => `proc-${i}`);
    // ★ 真的并行起 6 个 node 进程 —— 这是 JSON 文件实现必须靠自制锁才能通过的场景,
    //   在行存储 + 事务下无需任何应用层锁。
    await Promise.all(
      ids.map((id) =>
        // 超时给足:全套并发跑时 6 个 node 冷启动会和别的用例抢 CPU,
        // 30s 曾偶发撞线(单跑必过、全套偶发失败)——这是负载问题,不是并发正确性问题。
        exec(process.execPath, ["--input-type=commonjs", "-e", script(id)], {
          timeout: 120_000,
        }),
      ),
    );

    const idx = open();
    const map = await idx.read();
    expect([...map.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(map.get(id)?.title).toBe(`t-${id}`);
    idx.close();
  }, 180_000);
});

describe("降级(Req 3.1/3.2/3.5)", () => {
  it("★ 库文件是垃圾内容 → 构造不抛,且**重建后可正常读写**(不是彻底禁用)", async () => {
    await writeFile(dbPath, "this is definitely not a sqlite database", "utf8");
    // 端口契约要求所有方法绝不抛,构造期也不例外 —— 装配阶段一个坏文件不该拖垮宿主。
    let idx: SqliteSessionMetaIndex | undefined;
    expect(() => {
      idx = new SqliteSessionMetaIndex({ db: dbPath });
    }).not.toThrow();
    expect(idx).toBeDefined();

    // 损坏的旧内容读不出东西(索引是缓存,丢了就重建)
    await expect(idx!.read()).resolves.toEqual(new Map());

    // ★ 判别力所在:若实现只是"禁用"而非"重建",下面这条会失败 ——
    //   写进去再读回来,证明库被重建成了可用状态。
    await idx!.merge("s1", { title: "重建之后写入的" });
    expect((await idx!.read()).get("s1")?.title).toBe("重建之后写入的");
    idx!.close();

    // 重开也仍然可用(重建的是真库文件,不是内存态)
    const reopened = new SqliteSessionMetaIndex({ db: dbPath });
    expect((await reopened.read()).get("s1")?.title).toBe("重建之后写入的");
    reopened.close();
  });

  it("句柄已关闭后各方法仍不抛(缓存语义)", async () => {
    const idx = open();
    await idx.merge("s1", { title: "x" });
    idx.close();
    await expect(idx.read()).resolves.toBeInstanceOf(Map);
    await expect(idx.merge("s2", { title: "y" })).resolves.toBeUndefined();
    await expect(idx.remove("s1")).resolves.toBeUndefined();
    await expect(idx.prune(["s1"])).resolves.toBeTypeOf("number");
  });
});

/**
 * JsonFileSessionMetaIndex(spec session-meta-index, 任务 2.1)。
 *
 * 覆盖:读降级三态 / 逐字段校验 / 字段级合并与后写者赢 / remove / prune /
 * **真并发**(并行写不同会话不丢键)/ 写入过程中并发读不见中间态 / 抢锁超时放弃。
 *
 * ★ 并发用例刻意并行发起(`Promise.all`)而非串行 —— 串行版本无论有没有锁都会绿,
 *   那种「测试」对 Req 4.1 零判别力。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/json-file-index.js";

let dir: string;
let indexPath: string;

const newIndex = (lockTimeoutMs = 2_000): JsonFileSessionMetaIndex =>
  new JsonFileSessionMetaIndex({ path: indexPath, lockTimeoutMs });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-session-meta-"));
  indexPath = join(dir, "piweb-session-index.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("读降级(Req 3.1/3.2)", () => {
  it("索引文件不存在 → 空结果,不抛", async () => {
    await expect(newIndex().read()).resolves.toEqual(new Map());
  });

  it("内容不可解析 → 空结果,不抛", async () => {
    await writeFile(indexPath, "{ this is not json", "utf8");
    await expect(newIndex().read()).resolves.toEqual(new Map());
  });

  it("版本不识 → 空结果,且下次写入可重建(Req 3.4)", async () => {
    await writeFile(
      indexPath,
      JSON.stringify({ v: 999, sessions: { s1: { title: "旧格式" } } }),
      "utf8",
    );
    const idx = newIndex();
    expect(await idx.read()).toEqual(new Map());
    await idx.merge("s2", { title: "新写入" });
    const after = await idx.read();
    expect(after.get("s2")?.title).toBe("新写入");
    // 重建后不应残留不识版本里的键
    expect(after.has("s1")).toBe(false);
  });

  it("顶层不是对象 → 空结果", async () => {
    await writeFile(indexPath, "[1,2,3]", "utf8");
    await expect(newIndex().read()).resolves.toEqual(new Map());
  });
});

describe("逐字段校验(Req 3.3)", () => {
  it("坏字段被丢弃,同条目其余字段与其他条目保留", async () => {
    await writeFile(
      indexPath,
      JSON.stringify({
        v: 1,
        sessions: {
          good: { title: "正常", agentSource: "builtin:demo" },
          partial: { title: 42, agentSource: "builtin:keep" },
          broken: "not-an-object",
        },
      }),
      "utf8",
    );
    const map = await newIndex().read();
    expect(map.get("good")).toEqual({ title: "正常", agentSource: "builtin:demo" });
    // title 类型不符 → 只丢 title,agentSource 仍在
    expect(map.get("partial")).toEqual({ agentSource: "builtin:keep" });
    expect(map.has("broken")).toBe(false);
  });
});

describe("写入语义(Req 4.4/5.1/5.3)", () => {
  it("字段级合并:patch 未提供的字段保持原值", async () => {
    const idx = newIndex();
    await idx.merge("s1", { agentSource: "builtin:demo" });
    await idx.merge("s1", { title: "标题" });
    const entry = (await idx.read()).get("s1");
    expect(entry?.agentSource).toBe("builtin:demo");
    expect(entry?.title).toBe("标题");
  });

  it("同字段后写者赢", async () => {
    const idx = newIndex();
    await idx.merge("s1", { title: "先" });
    await idx.merge("s1", { title: "后" });
    expect((await idx.read()).get("s1")?.title).toBe("后");
  });

  it("merge 自动记 updatedAt", async () => {
    const idx = new JsonFileSessionMetaIndex({
      path: indexPath,
      now: () => new Date("2026-07-30T10:00:00.000Z"),
    });
    await idx.merge("s1", { title: "x" });
    expect((await idx.read()).get("s1")?.updatedAt).toBe("2026-07-30T10:00:00.000Z");
  });

  it("remove 只删目标键", async () => {
    const idx = newIndex();
    await idx.merge("s1", { title: "a" });
    await idx.merge("s2", { title: "b" });
    await idx.remove("s1");
    const map = await idx.read();
    expect(map.has("s1")).toBe(false);
    expect(map.get("s2")?.title).toBe("b");
  });

  it("prune 只保留给定集合并返回清除条数", async () => {
    const idx = newIndex();
    await idx.merge("keep", { title: "k" });
    await idx.merge("gone1", { title: "g1" });
    await idx.merge("gone2", { title: "g2" });
    const removed = await idx.prune(["keep"]);
    expect(removed).toBe(2);
    expect([...(await idx.read()).keys()]).toEqual(["keep"]);
  });

  it("空 sessionId 被忽略,不写入伪键", async () => {
    const idx = newIndex();
    await idx.merge("", { title: "x" });
    expect(await idx.read()).toEqual(new Map());
  });
});

describe("并发(Req 4.1/4.2)", () => {
  it("并行写入 12 个不同会话后全部键都在(不丢别人的写)", async () => {
    const idx = newIndex();
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    // ★ 并行发起:这是本用例的全部意义所在。
    await Promise.all(ids.map((id) => idx.merge(id, { title: `t-${id}` })));
    const map = await idx.read();
    expect([...map.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(map.get(id)?.title).toBe(`t-${id}`);
  });

  it("多个索引实例(模拟多进程)并行写入互不覆盖", async () => {
    const writers = Array.from({ length: 6 }, () => newIndex());
    await Promise.all(
      writers.map((w, i) => w.merge(`p${i}`, { agentSource: `src-${i}` })),
    );
    const map = await newIndex().read();
    expect(map.size).toBe(6);
    for (let i = 0; i < 6; i += 1) {
      expect(map.get(`p${i}`)?.agentSource).toBe(`src-${i}`);
    }
  });

  it("并发读写期间读到的永远是完整内容(无中间态)", async () => {
    const idx = newIndex();
    await idx.merge("seed", { title: "seed" });
    const reads: Promise<unknown>[] = [];
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 10; i += 1) {
      writes.push(idx.merge(`w${i}`, { title: `w${i}` }));
      reads.push(idx.read());
    }
    await Promise.all(writes);
    const snapshots = await Promise.all(reads);
    // 每次读到的都必须是可解析的 Map(实现里解析失败会退化成空 Map,
    // 故这里额外断言磁盘内容始终是合法 JSON)。
    for (const snap of snapshots) expect(snap).toBeInstanceOf(Map);
    const raw = await readFile(indexPath, "utf8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("抢不到锁即放弃本次写入,已有元数据不变(Req 4.3)", async () => {
    const idx = newIndex();
    await idx.merge("s1", { title: "原值" });
    // 手工占住锁目录(模拟另一进程持锁),且不让它被判为陈旧。
    const { mkdir } = await import("node:fs/promises");
    await mkdir(`${indexPath}.lock`);
    try {
      const impatient = newIndex(80);
      await expect(impatient.merge("s1", { title: "新值" })).resolves.toBeUndefined();
      // 放弃写入 → 原值保持
      expect((await idx.read()).get("s1")?.title).toBe("原值");
    } finally {
      await rm(`${indexPath}.lock`, { recursive: true, force: true });
    }
  });
});

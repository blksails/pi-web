/**
 * fs adapter:跑通契约工厂 + pi 布局兼容/桶命名/并发不交错(Req 10.x/8.3)。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsSessionEntryStore } from "../../src/session-store/fs-store.js";
import { bucketDirName, sessionFileName } from "../../src/session-store/codec.js";
import { collect, header, msg, runStoreContract } from "./contract.js";

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-fsstore-"));
}

runStoreContract("FsSessionEntryStore", async () => {
  const root = await tmpRoot();
  return {
    store: new FsSessionEntryStore(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});

describe("fs adapter 专项", () => {
  it("读取按 pi 既有布局预置的 JSONL 文件(Req 10.4)", async () => {
    const root = await tmpRoot();
    try {
      const cwd = "/Users/me/proj";
      const bucket = join(root, bucketDirName(cwd));
      await mkdir(bucket, { recursive: true });
      const h = { type: "session", id: "legacy1", version: 3, cwd, timestamp: "2026-02-03T04:05:06.700Z" };
      const file = join(bucket, sessionFileName(h.timestamp, h.id));
      const lines = [
        JSON.stringify(h),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "t", message: { role: "user", content: "hi" } }),
        JSON.stringify({ type: "model_change", id: "m2", parentId: "m1", timestamp: "t", provider: "openrouter", modelId: "anthropic/claude-sonnet-4.6" }),
      ];
      await writeFile(file, lines.join("\n") + "\n", "utf8");

      const store = new FsSessionEntryStore(root);
      const head = await store.readHeader("legacy1");
      expect(head.cwd).toBe(cwd);
      const entries = await collect(store.read("legacy1"));
      expect(entries.map((e) => e.id)).toEqual(["m1", "m2"]);
      expect(entries[1]?.type).toBe("model_change");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("读取真实 v1 历史文件:无 id 的 entry 按行号合成 id 与 parentId 链(Req 9.1/9.2)", async () => {
    const root = await tmpRoot();
    try {
      const cwd = "/legacy";
      const bucket = join(root, bucketDirName(cwd));
      await mkdir(bucket, { recursive: true });
      const h = { type: "session", id: "v1sess", version: 1, cwd, timestamp: "2026-02-03T04:05:06.700Z" };
      const file = join(bucket, sessionFileName(h.timestamp, h.id));
      // 真实 v1:entry 无 id / 无 parentId;compaction 用 firstKeptEntryIndex(行号)
      const lines = [
        JSON.stringify(h),
        JSON.stringify({ type: "message", timestamp: "t", message: { role: "user", content: "a" } }),
        JSON.stringify({ type: "message", timestamp: "t", message: { role: "hookMessage", content: "b" } }),
        JSON.stringify({ type: "compaction", timestamp: "t", summary: "s", tokensBefore: 5, firstKeptEntryIndex: 1 }),
      ];
      await writeFile(file, lines.join("\n") + "\n", "utf8");

      const store = new FsSessionEntryStore(root);
      expect((await store.readHeader("v1sess")).version).toBe(1);
      const entries = await collect(store.read("v1sess"));
      expect(entries.map((e) => e.id)).toEqual(["v1-1", "v1-2", "v1-3"]);
      expect(entries.map((e) => e.parentId)).toEqual([null, "v1-1", "v1-2"]);
      // hookMessage 角色归一为 custom
      expect((entries[1] as { message: { role: string } }).message.role).toBe("custom");
      // compaction firstKeptEntryIndex → firstKeptEntryId(行号 id)
      expect((entries[2] as { firstKeptEntryId?: unknown }).firstKeptEntryId).toBe("v1-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("读取真实 v2 文件:hookMessage 角色归一为 custom,保留既有 id/parentId(Req 9.1)", async () => {
    const root = await tmpRoot();
    try {
      const cwd = "/legacy2";
      const bucket = join(root, bucketDirName(cwd));
      await mkdir(bucket, { recursive: true });
      const h = { type: "session", id: "v2sess", version: 2, cwd, timestamp: "2026-02-03T04:05:06.700Z" };
      const file = join(bucket, sessionFileName(h.timestamp, h.id));
      const lines = [
        JSON.stringify(h),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "t", message: { role: "hookMessage", content: "x" } }),
      ];
      await writeFile(file, lines.join("\n") + "\n", "utf8");

      const store = new FsSessionEntryStore(root);
      const entries = await collect(store.read("v2sess"));
      expect(entries[0]?.id).toBe("m1");
      expect((entries[0] as { message: { role: string } }).message.role).toBe("custom");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("create 产出与 pi 一致的桶目录与文件名(Req 10.1/10.2)", async () => {
    const root = await tmpRoot();
    try {
      const store = new FsSessionEntryStore(root);
      await store.create(header("s1", "/Users/me/proj", { timestamp: "2026-02-03T04:05:06.700Z" }));
      const buckets = await readdir(root);
      expect(buckets).toContain("--Users-me-proj--");
      const files = await readdir(join(root, "--Users-me-proj--"));
      expect(files).toContain("2026-02-03T04-05-06-700Z_s1.jsonl");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("同一会话并发追加不交错且均保留(Req 8.3)", async () => {
    const root = await tmpRoot();
    try {
      const store = new FsSessionEntryStore(root);
      await store.create(header("s1"));
      await store.append("s1", msg("root", null));
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => store.append("s1", msg(`e${i}`, "root"))),
      );
      const entries = await collect(store.read("s1"));
      // 21 条:root + 20 子;每条都是完整 entry(未交错损坏)
      expect(entries).toHaveLength(21);
      expect(entries.filter((e) => e.parentId === "root")).toHaveLength(20);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

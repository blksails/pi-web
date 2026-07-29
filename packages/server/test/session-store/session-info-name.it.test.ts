/**
 * 会话显示名派生(spec auto-session-title, Req 8.4):
 *  - fs-store.displayName 扫文件取最新 session_info 名(header 未命名时列表据此显示自动标题)。
 *  - sqlite-store 在 append session_info 时维护 name 列,list().name 即时正确。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsSessionEntryStore } from "../../src/session-store/fs-store.js";
import { SqliteSessionEntryStore } from "../../src/session-store/sqlite-store.js";
import type { SessionEntry } from "../../src/session-store/types.js";
import { header } from "./contract.js";

function sessionInfo(id: string, parentId: string | null, name: string): SessionEntry {
  return {
    type: "session_info",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02.000Z",
    name,
  } as unknown as SessionEntry;
}

describe("fs-store.displayName(最新 session_info 名)", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("有 session_info → 返回其名;多条取最新", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-name-fs-"));
    const store = new FsSessionEntryStore(root);
    await store.create(header("s1", "/proj"));
    await store.append("s1", sessionInfo("i1", null, "第一个标题"));
    await store.append("s1", sessionInfo("i2", "i1", "更新后的标题"));
    expect(await store.displayName("s1")).toBe("更新后的标题");
  });

  it("无 session_info → undefined", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-name-fs-"));
    const store = new FsSessionEntryStore(root);
    await store.create(header("s2", "/proj"));
    expect(await store.displayName("s2")).toBeUndefined();
  });

  it("会话不存在 → undefined(不抛)", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-name-fs-"));
    const store = new FsSessionEntryStore(root);
    expect(await store.displayName("missing")).toBeUndefined();
  });

  it("list().name 仅来自 header(未命名会话为空),展示名须经 displayName 派生", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-name-fs-"));
    const store = new FsSessionEntryStore(root);
    await store.create(header("s3", "/proj")); // header 无 name
    await store.append("s3", sessionInfo("i1", null, "蓝天白云"));
    const metas = await store.list("/proj");
    expect(metas.find((m) => m.sessionId === "s3")?.name).toBeUndefined();
    expect(await store.displayName("s3")).toBe("蓝天白云");
  });
});

describe("sqlite-store:append session_info 维护 name 列", () => {
  it("append session_info 后 list().name 即更新(最新生效)", async () => {
    const store = new SqliteSessionEntryStore(":memory:");
    try {
      await store.create(header("s1", "/proj")); // 无 name
      let metas = await store.list("/proj");
      expect(metas.find((m) => m.sessionId === "s1")?.name).toBeUndefined();

      await store.append("s1", sessionInfo("i1", null, "标题甲"));
      metas = await store.list("/proj");
      expect(metas.find((m) => m.sessionId === "s1")?.name).toBe("标题甲");

      await store.append("s1", sessionInfo("i2", "i1", "标题乙"));
      metas = await store.list("/proj");
      expect(metas.find((m) => m.sessionId === "s1")?.name).toBe("标题乙");
    } finally {
      store.close();
    }
  });

  it("appendBatch 含 session_info → 取批内最新名", async () => {
    const store = new SqliteSessionEntryStore(":memory:");
    try {
      await store.create(header("s1", "/proj"));
      await store.appendBatch("s1", [
        sessionInfo("i1", null, "批一"),
        sessionInfo("i2", "i1", "批二"),
      ]);
      const metas = await store.list("/proj");
      expect(metas.find((m) => m.sessionId === "s1")?.name).toBe("批二");
    } finally {
      store.close();
    }
  });
});

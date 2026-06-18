/**
 * session-store-adapters — 与 adapter 无关的契约用例工厂(Req 13.1/13.2)。
 *
 * 三个 adapter 各调用一次 `runStoreContract(...)`,跑同一套断言以保证可观察语义一致:
 * 创建+读头部、按序读回、批量顺序与可见性、未找到语义、幂等、并发分叉、列举与删除。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  type SessionEntry,
  type SessionEntryStore,
  type SessionHeader,
} from "../../src/session-store/index.js";

export interface StoreHarness {
  store: SessionEntryStore;
  cleanup?: () => Promise<void> | void;
}

export function header(id: string, cwd = "/work", overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    type: "session",
    id,
    version: 3,
    cwd,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function msg(id: string, parentId: string | null, text = "hi"): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: text },
  };
}

export async function collect(it: AsyncIterable<SessionEntry>): Promise<SessionEntry[]> {
  const out: SessionEntry[] = [];
  for await (const entry of it) out.push(entry);
  return out;
}

export function runStoreContract(
  name: string,
  makeHarness: () => Promise<StoreHarness> | StoreHarness,
): void {
  describe(`SessionEntryStore 契约: ${name}`, () => {
    let store: SessionEntryStore;
    let cleanup: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const harness = await makeHarness();
      store = harness.store;
      cleanup = harness.cleanup;
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
    });

    it("create 后 readHeader 回读头部(Req 2.1/2.2)", async () => {
      const id = await store.create(header("s1", "/proj/a", { name: "任务一" }));
      expect(id).toBe("s1");
      const h = await store.readHeader("s1");
      expect(h.id).toBe("s1");
      expect(h.cwd).toBe("/proj/a");
      expect(h.version).toBe(3);
      expect(h.name).toBe("任务一");
    });

    it("重复 create 抛冲突错误(Req 2.3)", async () => {
      await store.create(header("s1"));
      await expect(store.create(header("s1"))).rejects.toBeInstanceOf(SessionStoreConflictError);
    });

    it("append 后按追加序 read(Req 3.1/5.1)", async () => {
      await store.create(header("s1"));
      await store.append("s1", msg("e1", null));
      await store.append("s1", msg("e2", "e1"));
      await store.append("s1", msg("e3", "e2"));
      const ids = (await collect(store.read("s1"))).map((e) => e.id);
      expect(ids).toEqual(["e1", "e2", "e3"]);
    });

    it("appendBatch 保持顺序且整批可见(Req 4.1/4.3)", async () => {
      await store.create(header("s1"));
      await store.appendBatch("s1", [msg("e1", null), msg("e2", "e1"), msg("e3", "e2")]);
      const ids = (await collect(store.read("s1"))).map((e) => e.id);
      expect(ids).toEqual(["e1", "e2", "e3"]);
    });

    it("对不存在会话的操作给出未找到语义(Req 3.3/5.4/7.2)", async () => {
      await expect(store.append("missing", msg("e1", null))).rejects.toBeInstanceOf(
        SessionStoreNotFoundError,
      );
      await expect(store.readHeader("missing")).rejects.toBeInstanceOf(SessionStoreNotFoundError);
      await expect(store.delete("missing")).rejects.toBeInstanceOf(SessionStoreNotFoundError);
      await expect(collect(store.read("missing"))).rejects.toBeInstanceOf(SessionStoreNotFoundError);
    });

    it("重复同 id append 幂等,不产生重复条目(Req 3.4/8.2)", async () => {
      await store.create(header("s1"));
      await store.append("s1", msg("e1", null));
      await store.append("s1", msg("e1", null));
      const ids = (await collect(store.read("s1"))).map((e) => e.id);
      expect(ids).toEqual(["e1"]);
    });

    it("并发同父追加保留为两个子节点=分叉(Req 8.1)", async () => {
      await store.create(header("s1"));
      await store.append("s1", msg("root", null));
      await Promise.all([store.append("s1", msg("c1", "root")), store.append("s1", msg("c2", "root"))]);
      const children = (await collect(store.read("s1")))
        .filter((e) => e.parentId === "root")
        .map((e) => e.id)
        .sort();
      expect(children).toEqual(["c1", "c2"]);
    });

    it("list 按 cwd 过滤,空目录返回空数组(Req 6.1/6.3)", async () => {
      await store.create(header("s1", "/proj/a"));
      await store.create(header("s2", "/proj/b"));
      const inA = await store.list("/proj/a");
      expect(inA.map((m) => m.sessionId)).toEqual(["s1"]);
      expect(await store.list("/nope")).toEqual([]);
    });

    it("listAll 跨工作目录列举(Req 6.2)", async () => {
      await store.create(header("s1", "/proj/a"));
      await store.create(header("s2", "/proj/b"));
      const ids = (await store.listAll()).map((m) => m.sessionId).sort();
      expect(ids).toEqual(["s1", "s2"]);
    });

    it("delete 后不再出现且不影响其余会话(Req 7.1/7.3)", async () => {
      await store.create(header("s1", "/proj/a"));
      await store.create(header("s2", "/proj/a"));
      await store.append("s2", msg("keep", null));
      await store.delete("s1");
      const ids = (await store.listAll()).map((m) => m.sessionId);
      expect(ids).toContain("s2");
      expect(ids).not.toContain("s1");
      await expect(collect(store.read("s1"))).rejects.toBeInstanceOf(SessionStoreNotFoundError);
      expect((await collect(store.read("s2"))).map((e) => e.id)).toEqual(["keep"]);
    });
  });
}

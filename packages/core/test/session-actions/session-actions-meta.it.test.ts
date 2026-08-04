/**
 * 元数据写入挂点:改名写标题 / 删除清条目(spec session-meta-index, 任务 3.3 / Req 1.3, 5.1, 3.5)。
 *
 * 经完整 handler + 真实 fs 存储 + 真实 JSON 索引;并验证「恶意索引」下端点响应**不变** ——
 * 元数据故障绝不能改变会话操作的响应码与响应体。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionActionsRoutes } from "../../src/session-actions/index.js";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/index.js";
import type { SessionMetaIndex } from "../../src/session-meta/types.js";

let dir: string;
let indexPath: string;
const cwd = "/tmp/sess-act-meta";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sess-act-meta-"));
  indexPath = join(dir, "piweb-session-index.json");
});

afterEach(async () => {
  // 元数据写入是 fire-and-forget,可能与清理抢目录(测试基建竞态,非产品缺陷)。
  for (let i = 0; i < 20; i += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
});

function makeHandler(metaIndex?: SessionMetaIndex): {
  fetch: (req: Request) => Promise<Response>;
  entryStore: FsSessionEntryStore;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const entryStore = new FsSessionEntryStore(dir);
  const routes = createSessionActionsRoutes({
    createEntryStore: async () => entryStore,
    entryStore,
    agentDir: dir,
    manageEnabled: true,
    ...(metaIndex !== undefined ? { metaIndex } : {}),
  });
  return {
    fetch: createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    }),
    entryStore,
  };
}

async function seedSession(store: FsSessionEntryStore, id: string): Promise<void> {
  await store.create({
    type: "session",
    id,
    version: 1,
    cwd,
    timestamp: "2026-06-01T00:00:01.000Z",
  });
}

const post = (path: string, body: unknown): Request =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("改名写入元数据标题(Req 1.3)", () => {
  it("rename 成功后索引记下新标题", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const h = makeHandler(idx);
    await seedSession(h.entryStore, "s1");
    const res = await h.fetch(post("/sessions/rename", { sessionId: "s1", name: "新名字" }));
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await idx.read()).get("s1")?.title).toBe("新名字");
    });
  });

  it("会话不存在时 404,且不写入任何元数据", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const h = makeHandler(idx);
    const res = await h.fetch(post("/sessions/rename", { sessionId: "ghost", name: "x" }));
    expect(res.status).toBe(404);
    expect((await idx.read()).has("ghost")).toBe(false);
  });
});

describe("删除清除元数据条目(Req 5.1)", () => {
  it("delete 成功后索引不再含该键", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const h = makeHandler(idx);
    await seedSession(h.entryStore, "s1");
    await idx.merge("s1", { title: "待删", agentSource: "builtin:demo" });
    const res = await h.fetch(post("/sessions/delete", { sessionId: "s1" }));
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await idx.read()).has("s1")).toBe(false);
    });
  });

  it("删除不存在的会话仍幂等成功,并清掉可能残留的条目", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const h = makeHandler(idx);
    await idx.merge("orphan", { title: "孤儿条目" });
    const res = await h.fetch(post("/sessions/delete", { sessionId: "orphan" }));
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await idx.read()).has("orphan")).toBe(false);
    });
  });
});

describe("元数据故障不影响端点(Req 3.5)", () => {
  const hostile: SessionMetaIndex = {
    read: () => Promise.reject(new Error("boom")),
    merge: () => Promise.reject(new Error("boom")),
    remove: () => Promise.reject(new Error("boom")),
    prune: () => Promise.reject(new Error("boom")),
  };

  it("索引写入恒失败时 rename 仍 200 且响应体不变", async () => {
    const h = makeHandler(hostile);
    await seedSession(h.entryStore, "s1");
    const res = await h.fetch(post("/sessions/rename", { sessionId: "s1", name: "仍然成功" }));
    expect(res.status).toBe(200);
    // toMatchObject:响应体另含 protocolVersion 等信封字段,本用例只关心业务负载不变。
    expect(JSON.parse(await res.text())).toMatchObject({
      sessionId: "s1",
      name: "仍然成功",
    });
    // 存储侧的真实效果照旧发生
    expect(await h.entryStore.displayName("s1")).toBe("仍然成功");
  });

  it("索引写入恒失败时 delete 仍 200 且会话真的被删", async () => {
    const h = makeHandler(hostile);
    await seedSession(h.entryStore, "s1");
    const res = await h.fetch(post("/sessions/delete", { sessionId: "s1" }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ ok: true });
    expect(await h.entryStore.list(cwd)).toEqual([]);
  });
});

describe("不注入索引时行为与改造前一致", () => {
  it("rename / delete 均正常,无任何元数据副作用", async () => {
    const h = makeHandler();
    await seedSession(h.entryStore, "s1");
    expect(
      (await h.fetch(post("/sessions/rename", { sessionId: "s1", name: "n" }))).status,
    ).toBe(200);
    expect((await h.fetch(post("/sessions/delete", { sessionId: "s1" }))).status).toBe(
      200,
    );
  });
});

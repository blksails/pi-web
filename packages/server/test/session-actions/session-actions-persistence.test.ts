/**
 * 集成:会话操作的持久化效果跨后端一致(session-list-item-actions Req 2.3/3.2/3.3)。
 *
 * 直接在 fs 与 sqlite 两个真实后端上,验证会话操作路由对存储的两项核心写效果:
 *  - 重命名 = append 一条 session_info{name} 后,可完整回放历史且显示名反映新名;
 *  - 删除 = 物理删除后,列表 / 头部读取不再返回该会话。
 * 路由内部经 `store.append` / `store.delete`(与端点实现同路径),此处用注入 store 直连,
 * 使断言可直接读回底层存储、并覆盖 fs 之外的 sqlite 后端(端点集成测试用 fs)。
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  FsSessionEntryStore,
  SqliteSessionEntryStore,
  type SessionEntryStore,
} from "../../src/session-store/index.js";
import { createSessionActionsRoutes } from "../../src/session-actions/index.js";

interface Backend {
  readonly name: string;
  make(): Promise<{ store: SessionEntryStore; cleanup: () => Promise<void> }>;
}

const backends: Backend[] = [
  {
    name: "fs",
    async make() {
      const dir = await mkdtemp(join(tmpdir(), "sess-act-fs-"));
      return {
        store: new FsSessionEntryStore(dir),
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    },
  },
  {
    name: "sqlite",
    async make() {
      const store = new SqliteSessionEntryStore(":memory:");
      return {
        store,
        cleanup: async () => store.close(),
      };
    },
  },
];

function handlerFor(store: SessionEntryStore): (req: Request) => Promise<Response> {
  const mem = new InMemorySessionStore(true);
  const manager = new SessionManager({ store: mem, idleMs: 0 });
  const routes = createSessionActionsRoutes({
    storeConfig: { kind: "fs", root: "/unused" },
    agentDir: tmpdir(),
    manageEnabled: true,
    entryStore: store,
    favoritesStore: { list: async () => [], set: async () => {} },
  });
  return createPiWebHandler({
    manager,
    store: mem,
    routes,
    authResolver: () => ({ anonymous: true }),
  });
}

function post(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function collect(it: AsyncIterable<{ type: string }>): Promise<string[]> {
  const types: string[] = [];
  for await (const e of it) types.push(e.type);
  return types;
}

for (const backend of backends) {
  describe(`会话操作持久化(${backend.name})`, () => {
    it("rename appends session_info, keeps history readable, updates display name", async () => {
      const { store, cleanup } = await backend.make();
      try {
        await store.create({
          type: "session",
          id: "s1",
          version: 1,
          cwd: "/proj",
          timestamp: "2026-06-01T00:00:01.000Z",
        });
        await store.append("s1", {
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-06-01T00:00:02.000Z",
          message: { role: "user", content: "hi" },
        });
        const h = handlerFor(store);
        const res = await h(post("/sessions/rename", { sessionId: "s1", name: "Renamed" }));
        expect(res.status).toBe(200);

        // 历史仍可完整回放(原 message 未被破坏,新增 session_info)。
        const types = await collect(store.read("s1"));
        expect(types).toContain("message");
        expect(types).toContain("session_info");

        // 显示名反映新名(fs 经 displayName 派生;sqlite 维护 name 列 → list().name)。
        const dn =
          typeof store.displayName === "function"
            ? await store.displayName("s1")
            : (await store.list("/proj")).find((m) => m.sessionId === "s1")?.name;
        expect(dn).toBe("Renamed");
      } finally {
        await cleanup();
      }
    });

    it("delete physically removes the session from list and header reads", async () => {
      const { store, cleanup } = await backend.make();
      try {
        await store.create({
          type: "session",
          id: "s1",
          version: 1,
          cwd: "/proj",
          timestamp: "2026-06-01T00:00:01.000Z",
        });
        const h = handlerFor(store);
        const res = await h(post("/sessions/delete", { sessionId: "s1" }));
        expect(res.status).toBe(200);

        const list = await store.list("/proj");
        expect(list.some((m) => m.sessionId === "s1")).toBe(false);
        await expect(store.readHeader("s1")).rejects.toThrow();
      } finally {
        await cleanup();
      }
    });
  });
}

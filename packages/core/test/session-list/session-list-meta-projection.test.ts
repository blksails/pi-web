/**
 * GET /sessions 的元数据与活跃态投影(spec session-meta-index, 任务 3.2)。
 *
 * 经完整 handler 走真实 fs 存储 + 真实 JSON 索引文件,断言的是**响应体**而非内部返回值
 * (stub 喂返回值测不出接线缺口 —— 有前科)。
 *
 * ★ 核心判据是 `displayName` 的**调用计数**:Req 2.2「索引命中即不扫文件」只能这样证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ListSessionsResponseSchema,
  type SessionActivity,
} from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionListRoutes } from "../../src/session-list/index.js";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/index.js";
import type { SessionMetaIndex } from "../../src/session-meta/types.js";

let tmpDir: string;
let indexPath: string;
const cwdA = "/tmp/sess-meta-projA";

beforeEach(async () => {
  tmpDir = join(tmpdir(), `sess-meta-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  indexPath = join(tmpDir, "piweb-session-index.json");
});

afterEach(async () => {
  // 回填写入是 fire-and-forget,清理可能与其抢同一目录(ENOTEMPTY)。重试几次即可 ——
  // 这是测试基建的竞态,不是产品缺陷。
  for (let i = 0; i < 20; i += 1) {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
});

/** seed 三个会话;a2 额外追加一条 session_info(即「历史里有自动标题」)。 */
async function seed(): Promise<void> {
  const store = new FsSessionEntryStore(tmpDir);
  await store.create({
    type: "session",
    id: "a1",
    version: 1,
    cwd: cwdA,
    timestamp: "2026-06-01T00:00:01.000Z",
  });
  await store.create({
    type: "session",
    id: "a2",
    version: 1,
    cwd: cwdA,
    timestamp: "2026-06-01T00:00:02.000Z",
  });
  await store.append("a2", {
    id: "e0000001",
    parentId: null,
    timestamp: "2026-06-01T00:10:00.000Z",
    type: "session_info",
    name: "历史里的自动标题",
  });
  await store.create({
    type: "session",
    id: "a3",
    version: 1,
    cwd: cwdA,
    timestamp: "2026-06-01T00:00:03.000Z",
  });
}

interface HandlerOpts {
  readonly metaIndex?: SessionMetaIndex;
  readonly activityOf?: (sessionId: string) => SessionActivity | undefined;
}

/** 建 handler,并返回 displayName 的调用计数器(判据核心)。 */
function makeHandler(opts: HandlerOpts = {}): {
  fetch: (req: Request) => Promise<Response>;
  displayNameCalls: () => string[];
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const calls: string[] = [];
  const routes = createSessionListRoutes({
    createEntryStore: async () => {
      const entryStore = new FsSessionEntryStore(tmpDir);
      const original = entryStore.displayName.bind(entryStore);
      // 包一层计数:不改实现,只观测「到底扫了几次文件」。
      entryStore.displayName = async (sessionId: string) => {
        calls.push(sessionId);
        return original(sessionId);
      };
      return entryStore;
    },
    ...(opts.metaIndex !== undefined ? { metaIndex: opts.metaIndex } : {}),
    ...(opts.activityOf !== undefined ? { activityOf: opts.activityOf } : {}),
  });
  return {
    fetch: createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    }),
    displayNameCalls: () => calls,
  };
}

async function listSessions(
  h: { fetch: (req: Request) => Promise<Response> },
  qs = "",
): Promise<ReturnType<typeof ListSessionsResponseSchema.parse>> {
  const res = await h.fetch(new Request(`http://x/sessions${qs}`));
  expect(res.status).toBe(200);
  const body: unknown = JSON.parse(await res.text());
  return ListSessionsResponseSchema.parse(body);
}

describe("标题优先级(Req 2.2/2.3/9.7)", () => {
  it("索引命中 → 用索引标题,且 displayName 一次都没被调用", async () => {
    await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    for (const id of ["a1", "a2", "a3"]) {
      await idx.merge(id, { title: `索引标题-${id}` });
    }
    const h = makeHandler({ metaIndex: idx });
    const body = await listSessions(h);
    expect(body.sessions.map((s) => s.name)).toEqual([
      "索引标题-a3",
      "索引标题-a2",
      "索引标题-a1",
    ]);
    // ★ Req 2.2 的唯一硬判据
    expect(h.displayNameCalls()).toEqual([]);
  });

  it("索引未命中 → 走既有派生取得历史标题,并回填索引(Req 3.6/9.7)", async () => {
    await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const h = makeHandler({ metaIndex: idx });
    const body = await listSessions(h);
    const a2 = body.sessions.find((s) => s.sessionId === "a2");
    expect(a2?.name).toBe("历史里的自动标题");
    // 未命中时确实扫了文件
    expect(h.displayNameCalls()).toContain("a2");
    // 回填是 fire-and-forget,给它一拍
    await vi.waitFor(async () => {
      expect((await idx.read()).get("a2")?.title).toBe("历史里的自动标题");
    });
    // 再列一次:这次应命中索引,不再扫 a2
    const h2 = makeHandler({ metaIndex: idx });
    const body2 = await listSessions(h2);
    expect(body2.sessions.find((s) => s.sessionId === "a2")?.name).toBe(
      "历史里的自动标题",
    );
    expect(h2.displayNameCalls()).not.toContain("a2");
  });

  it("不注入索引时行为与改造前一致(既有派生路径)", async () => {
    await seed();
    const h = makeHandler();
    const body = await listSessions(h);
    expect(body.sessions.find((s) => s.sessionId === "a2")?.name).toBe(
      "历史里的自动标题",
    );
    expect(h.displayNameCalls().length).toBeGreaterThan(0);
  });
});

describe("索引降级(Req 3.1/3.2)", () => {
  it("索引文件不存在 → 列表与不注入索引时等价", async () => {
    await seed();
    const withIdx = await listSessions(
      makeHandler({ metaIndex: new JsonFileSessionMetaIndex({ path: indexPath }) }),
    );
    const without = await listSessions(makeHandler());
    expect(withIdx.sessions.map((s) => ({ id: s.sessionId, name: s.name }))).toEqual(
      without.sessions.map((s) => ({ id: s.sessionId, name: s.name })),
    );
  });

  it("索引内容是乱码 → 同样等价,不 500", async () => {
    await seed();
    await fs.writeFile(indexPath, "not json at all{{{", "utf8");
    const body = await listSessions(
      makeHandler({ metaIndex: new JsonFileSessionMetaIndex({ path: indexPath }) }),
    );
    expect(body.sessions).toHaveLength(3);
    expect(body.sessions.find((s) => s.sessionId === "a2")?.name).toBe(
      "历史里的自动标题",
    );
  });

  it("索引读取抛错 → 列表照常返回(端口契约兜底之外再加一层)", async () => {
    await seed();
    const hostile: SessionMetaIndex = {
      read: () => Promise.reject(new Error("disk on fire")),
      merge: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      prune: () => Promise.resolve(0),
    };
    const h = makeHandler({ metaIndex: hostile });
    const res = await h.fetch(new Request("http://x/sessions"));
    // 端点在读取处兜底,故恶意索引不会把列表拖成 500(Req 3.5)。
    expect(res.status).toBe(200);
  });
});

describe("来源与活跃态投影(Req 6.2/7.5/7.6)", () => {
  it("索引里有 agentSource → 响应体带 source", async () => {
    await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("a1", { agentSource: "builtin:demo" });
    const body = await listSessions(makeHandler({ metaIndex: idx }));
    expect(body.sessions.find((s) => s.sessionId === "a1")?.source).toBe(
      "builtin:demo",
    );
    // 未登记来源的会话不得凭空出现 source
    expect(body.sessions.find((s) => s.sessionId === "a3")?.source).toBeUndefined();
  });

  it("活跃会话带 activity;未加载会话该字段缺省", async () => {
    await seed();
    const h = makeHandler({
      activityOf: (id) => (id === "a2" ? "working" : undefined),
    });
    const body = await listSessions(h);
    expect(body.sessions.find((s) => s.sessionId === "a2")?.activity).toBe("working");
    expect(body.sessions.find((s) => s.sessionId === "a1")?.activity).toBeUndefined();
  });

  it("活跃态聚合器抛错 → 该项无 activity,其余项不受影响", async () => {
    await seed();
    const h = makeHandler({
      activityOf: (id) => {
        if (id === "a2") throw new Error("registry exploded");
        return id === "a1" ? "error" : undefined;
      },
    });
    const body = await listSessions(h);
    expect(body.sessions.find((s) => s.sessionId === "a2")?.activity).toBeUndefined();
    expect(body.sessions.find((s) => s.sessionId === "a1")?.activity).toBe("error");
  });

  it("不注入活跃态查询时所有项都无 activity 字段", async () => {
    await seed();
    const body = await listSessions(makeHandler());
    for (const s of body.sessions) expect(s.activity).toBeUndefined();
  });
});

describe("搜索按索引标题匹配(Req 2.4)", () => {
  it("关键字匹配索引里的标题,且既有匹配语义不变(大小写不敏感子串)", async () => {
    await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("a1", { title: "Canvas 画布实验" });
    await idx.merge("a3", { title: "别的东西" });
    const body = await listSessions(makeHandler({ metaIndex: idx }), "?q=canvas");
    expect(body.sessions.map((s) => s.sessionId)).toEqual(["a1"]);
  });
});

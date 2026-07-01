/**
 * 集成 + 单元:会话操作端点(delete/rename/favorites)经 createPiWebHandler routes? 注入。
 *
 * 经完整 handler 路由(而非直调 handler)——同时验证:
 *  - 无 `:id` 路径参数的写端点**不被** router 的内存会话存在性门控拦截(可作用于历史会话);
 *  - `/sessions/delete`、`/sessions/rename`、`/sessions/favorites` 与内置 `/sessions/:id/*`、
 *    `DELETE /sessions/:id` 不误匹配。
 * 数据用真实 fs 存储后端(seed 与端点内部惰性 store 指向同一 root)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionActionsRoutes } from "../../src/session-actions/index.js";

let tmpDir: string;
const cwd = "/tmp/sess-actions-proj";

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `sess-actions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** seed 会话(历史会话:不在内存 SessionStore 中)。 */
async function seed(): Promise<void> {
  const store = new FsSessionEntryStore(tmpDir);
  const mk = (id: string, t: string): Promise<string> =>
    store.create({ type: "session", id, version: 1, cwd, timestamp: t });
  await mk("s1", "2026-06-01T00:00:01.000Z");
  await mk("s2", "2026-06-01T00:00:02.000Z");
}

function makeHandler(manageEnabled: boolean): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createSessionActionsRoutes({
    storeConfig: { kind: "fs", root: tmpDir },
    agentDir: tmpDir,
    manageEnabled,
  });
  return createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => ({ anonymous: true }),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function post(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 直接经 fs store 读回某会话最新显示名(session_info 优先),验证重命名落库。 */
async function displayNameOf(sessionId: string): Promise<string | undefined> {
  const store = new FsSessionEntryStore(tmpDir);
  return store.displayName?.(sessionId);
}
async function exists(sessionId: string): Promise<boolean> {
  const store = new FsSessionEntryStore(tmpDir);
  try {
    await store.readHeader(sessionId);
    return true;
  } catch {
    return false;
  }
}

describe("POST /sessions/delete", () => {
  beforeEach(seed);

  it("physically deletes an existing (historical) session", async () => {
    const h = makeHandler(true);
    expect(await exists("s1")).toBe(true);
    const res = await h(post("/sessions/delete", { sessionId: "s1" }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ ok: true });
    expect(await exists("s1")).toBe(false);
  });

  it("is idempotent when the session does not exist", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/delete", { sessionId: "ghost" }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ ok: true });
  });

  it("rejects missing sessionId with 400", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/delete", {}));
    expect(res.status).toBe(400);
  });

  it("returns 403 and keeps the session when management is disabled", async () => {
    const h = makeHandler(false);
    const res = await h(post("/sessions/delete", { sessionId: "s1" }));
    expect(res.status).toBe(403);
    expect(await exists("s1")).toBe(true);
  });
});

describe("POST /sessions/rename", () => {
  beforeEach(seed);

  it("appends session_info and updates the display name", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/rename", { sessionId: "s1", name: "  My Chat  " }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ sessionId: "s1", name: "My Chat" });
    expect(await displayNameOf("s1")).toBe("My Chat");
  });

  it("rejects blank name with 400 and does not change the name", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/rename", { sessionId: "s1", name: "   " }));
    expect(res.status).toBe(400);
    expect(await displayNameOf("s1")).toBeUndefined();
  });

  it("rejects over-long name with 400", async () => {
    const h = makeHandler(true);
    const res = await h(
      post("/sessions/rename", { sessionId: "s1", name: "a".repeat(201) }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent session", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/rename", { sessionId: "ghost", name: "x" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when management is disabled", async () => {
    const h = makeHandler(false);
    const res = await h(post("/sessions/rename", { sessionId: "s1", name: "x" }));
    expect(res.status).toBe(403);
    expect(await displayNameOf("s1")).toBeUndefined();
  });
});

describe("/sessions/favorites", () => {
  it("GET returns [] initially, POST replaces and echoes, GET reflects", async () => {
    const h = makeHandler(true);
    const g0 = await h(new Request("http://x/sessions/favorites"));
    expect(g0.status).toBe(200);
    expect(await readJson(g0)).toMatchObject({ sessionIds: [] });

    const p = await h(post("/sessions/favorites", { sessionIds: ["s1", "s1", "", "s2"] }));
    expect(p.status).toBe(200);
    expect(await readJson(p)).toMatchObject({ sessionIds: ["s1", "s2"] });

    const g1 = await h(new Request("http://x/sessions/favorites"));
    expect(await readJson(g1)).toMatchObject({ sessionIds: ["s1", "s2"] });
  });

  it("POST rejects a non-array body with 400", async () => {
    const h = makeHandler(true);
    const res = await h(post("/sessions/favorites", { sessionIds: "s1" }));
    expect(res.status).toBe(400);
  });

  it("GET favorites is NOT gated by management flag; POST is", async () => {
    const h = makeHandler(false);
    const g = await h(new Request("http://x/sessions/favorites"));
    expect(g.status).toBe(200); // 读不受门控(Req 4.9)
    const p = await h(post("/sessions/favorites", { sessionIds: ["s1"] }));
    expect(p.status).toBe(403); // 写受门控
  });
});

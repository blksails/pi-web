/**
 * 集成 + 单元:GET /sessions 列表端点经 createPiWebHandler routes? 注入。
 *
 * 经完整 handler 路由(而非直调 handler)同时验证 router 能区分 `/sessions`(列表)与
 * 内置 `/sessions/:id/*`(段数不同,不误匹配)。数据用真实 fs 存储后端(seed 与端点
 * 内部惰性 store 指向同一 root,文件可见)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListSessionsResponseSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionListRoutes } from "../../src/session-list/index.js";

let tmpDir: string;
const cwdA = "/tmp/sess-list-projA";
const cwdB = "/tmp/sess-list-projB";

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `sess-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** seed 5 个会话到 cwdA、2 个到 cwdB(不同 timestamp)。 */
async function seed(): Promise<void> {
  const store = new FsSessionEntryStore(tmpDir);
  const mk = (id: string, cwd: string, t: string): Promise<string> =>
    store.create({ type: "session", id, version: 1, cwd, timestamp: t });
  await mk("a1", cwdA, "2026-06-01T00:00:01.000Z");
  await mk("a2", cwdA, "2026-06-01T00:00:02.000Z");
  await mk("a3", cwdA, "2026-06-01T00:00:03.000Z");
  await mk("a4", cwdA, "2026-06-01T00:00:04.000Z");
  await mk("a5", cwdA, "2026-06-01T00:00:05.000Z");
  await mk("b1", cwdB, "2026-06-01T00:00:06.000Z");
  await mk("b2", cwdB, "2026-06-01T00:00:07.000Z");
}

function makeHandler(globalEnabled: boolean): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createSessionListRoutes({
    storeConfig: { kind: "fs", root: tmpDir },
    globalEnabled,
    defaultCwd: cwdA,
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

const url = (qs: string): Request => new Request(`http://x/sessions${qs}`);

describe("GET /sessions — current-directory view", () => {
  it("returns the cwd's sessions, schema-valid and in non-increasing time order", async () => {
    await seed();
    const handler = makeHandler(false);
    const res = await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}`));
    expect(res.status).toBe(200);

    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.scope).toBe("cwd");
    expect(parsed.globalEnabled).toBe(false);
    expect(parsed.sessions.map((s) => s.sessionId).sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
    ]);
    // 倒序:排序键(updatedAt??createdAt)非升序(fs 后端 updatedAt=mtime,近似相等亦满足)。
    const keys = parsed.sessions.map((s) => s.updatedAt ?? s.createdAt);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i - 1]! >= keys[i]!).toBe(true);
    }
  });

  it("defaults scope to cwd and uses defaultCwd when cwd omitted", async () => {
    await seed();
    const handler = makeHandler(false);
    const res = await handler(url(""));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.scope).toBe("cwd");
    expect(parsed.sessions).toHaveLength(5); // defaultCwd = cwdA
  });

  it("resolves the target directory from sessionId (current session's cwd)", async () => {
    await seed();
    const handler = makeHandler(false);
    // 以 cwdB 的会话 b1 解析「当前目录」→ 返回 cwdB 的会话(b1,b2),而非 defaultCwd(cwdA)。
    const res = await handler(url("?scope=cwd&sessionId=b1"));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions.map((s) => s.sessionId).sort()).toEqual(["b1", "b2"]);
  });

  it("falls back to default cwd when sessionId does not exist", async () => {
    await seed();
    const handler = makeHandler(false);
    const res = await handler(url("?scope=cwd&sessionId=does-not-exist"));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions).toHaveLength(5); // defaultCwd = cwdA
  });

  it("returns an empty list for a directory with no sessions", async () => {
    await seed();
    const handler = makeHandler(false);
    const res = await handler(url(`?scope=cwd&cwd=${encodeURIComponent("/tmp/empty")}`));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions).toEqual([]);
    expect(parsed.nextCursor).toBeUndefined();
  });
});

describe("GET /sessions — pagination", () => {
  it("paginates via cursor without repeating sessions and converges", async () => {
    await seed();
    const handler = makeHandler(false);
    const ids: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const res = await handler(
        url(
          `?scope=cwd&cwd=${encodeURIComponent(cwdA)}&limit=2${cursor !== undefined ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      const parsed = ListSessionsResponseSchema.parse(await readJson(res));
      expect(parsed.sessions.length).toBeLessThanOrEqual(2);
      parsed.sessions.forEach((s) => ids.push(s.sessionId));
      cursor = parsed.nextCursor;
      guard += 1;
    } while (cursor !== undefined && guard < 10);

    expect(ids.sort()).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(new Set(ids).size).toBe(5); // 无重复
  });
});

describe("GET /sessions — system (all) view gating", () => {
  it("rejects scope=all with 403 when global view is disabled", async () => {
    await seed();
    const handler = makeHandler(false);
    const res = await handler(url("?scope=all"));
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe(
      "SESSIONS_GLOBAL_DISABLED",
    );
  });

  it("aggregates across all cwds when global view is enabled", async () => {
    await seed();
    const handler = makeHandler(true);
    const res = await handler(url("?scope=all"));
    expect(res.status).toBe(200);
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.scope).toBe("all");
    expect(parsed.globalEnabled).toBe(true);
    expect(parsed.sessions.map((s) => s.sessionId).sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "b1",
      "b2",
    ]);
  });
});

describe("GET /sessions — request validation", () => {
  it("returns 400 for an undecodable cursor", async () => {
    const handler = makeHandler(false);
    const res = await handler(url("?scope=cwd&cursor=%%%not-base64%%%"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive / non-numeric limit", async () => {
    const handler = makeHandler(false);
    expect((await handler(url("?limit=0"))).status).toBe(400);
    expect((await handler(url("?limit=abc"))).status).toBe(400);
  });

  it("returns 500 when the store cannot be constructed/read", async () => {
    // postgres 配置缺 connectionString → createSessionEntryStore 抛 → handler catch → 500。
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const routes = createSessionListRoutes({
      storeConfig: { kind: "postgres", connectionString: "" },
      globalEnabled: false,
      defaultCwd: cwdA,
    });
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    });
    const res = await handler(url("?scope=cwd"));
    expect(res.status).toBe(500);
  });
});

describe("GET /sessions — name search (q) (sidebar-launcher-rail)", () => {
  /** seed 命名会话到 cwdA。 */
  async function seedNamed(): Promise<void> {
    const store = new FsSessionEntryStore(tmpDir);
    const mk = (id: string, name: string, t: string): Promise<string> =>
      store.create({ type: "session", id, version: 1, cwd: cwdA, name, timestamp: t });
    await mk("s1", "Refactor Auth Module", "2026-06-01T00:00:01.000Z");
    await mk("s2", "Fix login bug", "2026-06-01T00:00:02.000Z");
    await mk("s3", "Docs update", "2026-06-01T00:00:03.000Z");
  }

  it("q 命中(大小写不敏感)只返回匹配名称的会话(Req 3.2)", async () => {
    await seedNamed();
    const handler = makeHandler(false);
    const res = await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}&q=fix`));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("q 未命中 → 空结果(Req 3.4),不使请求失败", async () => {
    await seedNamed();
    const handler = makeHandler(false);
    const res = await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}&q=zzz-nomatch`));
    expect(res.status).toBe(200);
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions).toEqual([]);
  });

  it("空 q 与不传 q 一致(向后兼容 Req 6.2)", async () => {
    await seedNamed();
    const handler = makeHandler(false);
    const base = ListSessionsResponseSchema.parse(
      await readJson(await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}`))),
    );
    const withEmptyQ = ListSessionsResponseSchema.parse(
      await readJson(await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}&q=`))),
    );
    expect(withEmptyQ.sessions.map((s) => s.sessionId)).toEqual(
      base.sessions.map((s) => s.sessionId),
    );
  });

  it("q 也可按 sessionId 子串命中", async () => {
    await seedNamed();
    const handler = makeHandler(false);
    const res = await handler(url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}&q=s3`));
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions.map((s) => s.sessionId)).toEqual(["s3"]);
  });

  it("q 匹配 auto-title 显示名(header 未命名,标题在 session_info)(Req 3.2/3.6)", async () => {
    // header 无 name,标题经 session_info 派生(auto-session-title 路径)。
    const store = new FsSessionEntryStore(tmpDir);
    await store.create({
      type: "session",
      id: "auto1",
      version: 1,
      cwd: cwdA,
      timestamp: "2026-06-01T00:00:01.000Z",
    });
    await store.append("auto1", {
      type: "session_info",
      name: "Investigate Payment Bug",
    } as never);
    const handler = makeHandler(false);
    // 按显示名子串搜索 → 命中该 header 未命名会话(修复前只匹配 header name 会漏)。
    const res = await handler(
      url(`?scope=cwd&cwd=${encodeURIComponent(cwdA)}&q=payment`),
    );
    const parsed = ListSessionsResponseSchema.parse(await readJson(res));
    expect(parsed.sessions.map((s) => s.sessionId)).toEqual(["auto1"]);
  });
});

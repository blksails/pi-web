/**
 * desktop-cloud-login 任务 7.1 · 鉴权端点单测(Req 1.3/2.5/6.2/6.3)。
 *
 * 直接驱动 InjectedRoute handler(不起 HTTP),校验状态码与登录态迁移。
 */
import { describe, it, expect } from "vitest";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";
import { createAuthRoutes } from "../../src/auth/auth-routes.js";
import type { InjectedRoute } from "../../src/http/index.js";

function makeCredential(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.sig`;
}
const VALID = makeCredential({
  userId: "user-A",
  companyId: "co-A",
  scope: "desktop",
  exp: 4_000_000_000,
});
const EXPIRED = makeCredential({
  userId: "user-X",
  companyId: "co-X",
  scope: "desktop",
  exp: 1000,
});

type Handler = InjectedRoute["handler"];

/** 返回一个按 `"METHOD /path"` 取 handler 的函数;缺失即抛(测试即失败)。 */
function routesFor(state: AuthSessionState): (key: string) => Handler {
  const routes = createAuthRoutes({ state });
  const byKey = new Map<string, InjectedRoute>();
  for (const r of routes) byKey.set(`${r.method} ${r.path}`, r);
  return (key) => {
    const r = byKey.get(key);
    if (r === undefined) throw new Error(`route not found: ${key}`);
    return r.handler;
  };
}

/** 造一个最小 ctx,handler 只用到 ctx.req.json()。 */
function ctxWithJson(body: unknown) {
  return {
    req: { json: async () => body },
  } as unknown as Parameters<InjectedRoute["handler"]>[0];
}

async function readJson(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

describe("createAuthRoutes", () => {
  it("GET /auth/me 初始未登录", async () => {
    const routes = routesFor(new AuthSessionState());
    const res = await routes("GET /auth/me")(ctxWithJson(undefined));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ loggedIn: false });
  });

  it("POST 合法凭据 → 200 + 登录态可经 GET 读到(Req 6.2/6.3)", async () => {
    const state = new AuthSessionState();
    const routes = routesFor(state);
    const post = await routes("POST /auth/session")(
      ctxWithJson({ credential: VALID }),
    );
    expect(post.status).toBe(200);
    expect(await readJson(post)).toMatchObject({ loggedIn: true, userId: "user-A", status: "valid" });

    const me = await routes("GET /auth/me")(ctxWithJson(undefined));
    expect(await readJson(me)).toMatchObject({ loggedIn: true, userId: "user-A" });
  });

  it("DELETE → GET 转未登录(Req 2.5)", async () => {
    const state = new AuthSessionState();
    const routes = routesFor(state);
    await routes("POST /auth/session")(ctxWithJson({ credential: VALID }));
    const del = await routes("DELETE /auth/session")(ctxWithJson(undefined));
    expect(del.status).toBe(200);
    const me = await routes("GET /auth/me")(ctxWithJson(undefined));
    expect(await readJson(me)).toMatchObject({ loggedIn: false });
  });

  it("POST 过期凭据 → 401", async () => {
    const routes = routesFor(new AuthSessionState());
    const res = await routes("POST /auth/session")(
      ctxWithJson({ credential: EXPIRED }),
    );
    expect(res.status).toBe(401);
  });

  it("POST 缺凭据 → 400", async () => {
    const routes = routesFor(new AuthSessionState());
    const res = await routes("POST /auth/session")(ctxWithJson({}));
    expect(res.status).toBe(400);
  });

  it("POST 非法凭据 → 400", async () => {
    const routes = routesFor(new AuthSessionState());
    const res = await routes("POST /auth/session")(
      ctxWithJson({ credential: "garbage" }),
    );
    expect(res.status).toBe(400);
  });

  it("回体绝不含凭据明文(Req 5.2)", async () => {
    const routes = routesFor(new AuthSessionState());
    const post = await routes("POST /auth/session")(
      ctxWithJson({ credential: VALID }),
    );
    expect(await post.clone().text()).not.toContain("sig");
  });
});

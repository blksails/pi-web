/**
 * Router 单测:匹配/`:id` 提取/404/405/auth 拒绝/外部注入路由可达且不能遮蔽内置
 * (Req 1.2,1.4,1.5,1.7,8.4,8.5)。
 */
import { describe, expect, it } from "vitest";
import { Router, type RouteSpec } from "../../src/http/router.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function ok(text: string): () => Promise<Response> {
  return () => Promise.resolve(new Response(text, { status: 200 }));
}

function makeStore(withSession = false): InMemorySessionStore {
  const store = new InMemorySessionStore(true);
  if (withSession) {
    const s = new MockSession("sess-1");
    store.create(asPiSession(s));
  }
  return store;
}

describe("Router", () => {
  const builtins: RouteSpec[] = [
    { method: "POST", path: "/sessions", handler: ok("create") },
    {
      method: "GET",
      path: "/sessions/:id/state",
      handler: (ctx) =>
        Promise.resolve(new Response(`state:${ctx.sessionId}`, { status: 200 })),
    },
  ];

  it("matches method+path and dispatches", async () => {
    const router = new Router({ store: makeStore(), builtins });
    const res = await router.route(
      new Request("http://x/sessions", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("create");
  });

  it("extracts :id into RequestContext", async () => {
    const router = new Router({ store: makeStore(true), builtins });
    const res = await router.route(
      new Request("http://x/sessions/sess-1/state", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("state:sess-1");
  });

  it("returns 404 for unknown path", async () => {
    const router = new Router({ store: makeStore(), builtins });
    const res = await router.route(new Request("http://x/nope", { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("returns 405 when path matches but method does not", async () => {
    const router = new Router({ store: makeStore(), builtins });
    const res = await router.route(
      new Request("http://x/sessions", { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });

  it("returns 404 for :id endpoint when session does not exist", async () => {
    const router = new Router({ store: makeStore(false), builtins });
    const res = await router.route(
      new Request("http://x/sessions/missing/state", { method: "GET" }),
    );
    expect(res.status).toBe(404);
  });

  it("authResolver reject → 401, handler not reached", async () => {
    const router = new Router({
      store: makeStore(),
      builtins,
      authResolver: () => ({ reject: 401 }),
    });
    const res = await router.route(
      new Request("http://x/sessions", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("authorizeSession false → 403 for :id endpoint", async () => {
    const router = new Router({
      store: makeStore(true),
      builtins,
      authorizeSession: () => false,
    });
    const res = await router.route(
      new Request("http://x/sessions/sess-1/state", { method: "GET" }),
    );
    expect(res.status).toBe(403);
  });

  it("default-allow passes when no auth seams provided", async () => {
    const router = new Router({ store: makeStore(true), builtins });
    const res = await router.route(
      new Request("http://x/sessions/sess-1/state", { method: "GET" }),
    );
    expect(res.status).toBe(200);
  });

  it("injected external route is reachable", async () => {
    const router = new Router({
      store: makeStore(),
      builtins,
      injected: [{ method: "GET", path: "/extensions", handler: ok("ext") }],
    });
    const res = await router.route(
      new Request("http://x/extensions", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ext");
  });

  it("injected route cannot shadow a built-in (exact path+method)", async () => {
    const router = new Router({
      store: makeStore(),
      builtins,
      injected: [
        { method: "POST", path: "/sessions", handler: ok("SHADOW") },
      ],
    });
    const res = await router.route(
      new Request("http://x/sessions", { method: "POST" }),
    );
    expect(await res.text()).toBe("create");
  });

  it("honors basePath prefix", async () => {
    const router = new Router({ store: makeStore(), builtins, basePath: "/api" });
    const res = await router.route(
      new Request("http://x/api/sessions", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const miss = await router.route(
      new Request("http://x/sessions", { method: "POST" }),
    );
    expect(miss.status).toBe(404);
  });
});

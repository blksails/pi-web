/**
 * agent-route-routes 单测(spec agent-declared-routes task 3.2):
 * HTTP 层错误语义全档 —— 200 / 404(名称) / 405 / 400 / 413 / 502 / 504 /
 * 门控关(404) / 清单空数组(Req 1.4, 2.1–2.5, 3.2–3.4, 3.6, 4.1–4.4)。
 *
 * 经 createPiWebHandler 集成式调用(镜像 command-routes.test.ts):Router 承担
 * 会话 404/401/403,本文件聚焦 handler 自身的检查顺序与错误码字典(design D6)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRouteDeclDto,
  AgentRouteMethod,
  AgentRouteResultFrame,
} from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { AgentRouteTimeoutError } from "../../src/session/session.errors.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

/** 记录 invokeAgentRoute 入参并按配置回包/抛错的会话 mock(PiSession routes 面子集)。 */
class RoutesMockSession extends MockSession {
  agentRoutes: ReadonlyArray<AgentRouteDeclDto> = [];
  readonly invokeCalls: Array<{
    name: string;
    req: { method: AgentRouteMethod; query: Record<string, string>; body?: unknown };
    timeoutMs: number | undefined;
  }> = [];
  invokeResult: AgentRouteResultFrame | Error = okFrame({ ok: true });

  invokeAgentRoute(
    name: string,
    req: { method: AgentRouteMethod; query: Record<string, string>; body?: unknown },
    timeoutMs?: number,
  ): Promise<AgentRouteResultFrame> {
    this.invokeCalls.push({ name, req, timeoutMs });
    if (this.invokeResult instanceof Error) {
      return Promise.reject(this.invokeResult);
    }
    return Promise.resolve(this.invokeResult);
  }
}

function okFrame(result: unknown): AgentRouteResultFrame {
  return { type: "piweb_agent_route_result", id: "req-1", ok: true, result };
}

function failFrame(code: string, message: string): AgentRouteResultFrame {
  return {
    type: "piweb_agent_route_result",
    id: "req-1",
    ok: false,
    error: { code, message },
  };
}

function decl(over: Partial<AgentRouteDeclDto> & { name: string }): AgentRouteDeclDto {
  return { methods: ["GET"], ...over };
}

function setup(routes: ReadonlyArray<AgentRouteDeclDto> = []): {
  handler: (req: Request) => Promise<Response>;
  session: RoutesMockSession;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new RoutesMockSession("sess-1");
  session.agentRoutes = routes;
  store.create(asPiSession(session));
  const handler = createPiWebHandler({ manager, store });
  return { handler, session };
}

function get(path: string, headers?: Record<string, string>): Request {
  return new Request(`http://x${path}`, {
    method: "GET",
    ...(headers !== undefined ? { headers } : {}),
  });
}

function post(
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    ...(body !== undefined ? { body } : {}),
    ...(headers !== undefined ? { headers } : {}),
  });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /sessions/:id/agent-routes(清单)", () => {
  it("返回声明的路由清单(名称与方法,Req 2.5)", async () => {
    const { handler } = setup([
      decl({ name: "gallery-stats", methods: ["GET"], description: "stats" }),
      decl({ name: "submit", methods: ["GET", "POST"] }),
    ]);
    const res = await handler(get("/sessions/sess-1/agent-routes"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      routes: [
        { name: "gallery-stats", methods: ["GET"], description: "stats" },
        { name: "submit", methods: ["GET", "POST"] },
      ],
      protocolVersion: expect.any(String),
    });
  });

  it("无声明 → 200 空数组而非错误(Req 2.5)", async () => {
    const { handler } = setup([]);
    const res = await handler(get("/sessions/sess-1/agent-routes"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { routes: unknown[] }).routes).toEqual([]);
  });

  it("门控关断 → 404(Req 4.3)", async () => {
    vi.stubEnv("PI_WEB_AGENT_ROUTES_DISABLED", "1");
    const { handler } = setup([decl({ name: "gallery-stats" })]);
    const res = await handler(get("/sessions/sess-1/agent-routes"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("会话不存在 → 404(Router 既有语义,Req 2.4)", async () => {
    const { handler } = setup([]);
    const res = await handler(get("/sessions/nope/agent-routes"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("SESSION_NOT_FOUND");
  });
});

describe("GET|POST /sessions/:id/agent-routes/:name(调用)", () => {
  it("GET 200:查询参数透传、无 body、响应体=处理器返回的原始 JSON(Req 2.1/3.1/3.2)", async () => {
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    session.invokeResult = okFrame({ count: 3, kinds: ["png"] });
    const res = await handler(
      get("/sessions/sess-1/agent-routes/gallery-stats?a=1&b=two"),
    );
    expect(res.status).toBe(200);
    // 原始 JSON:不包 jsonResponse 信封(不注入 protocolVersion 体字段)。
    expect((await res.json()) as unknown).toEqual({ count: 3, kinds: ["png"] });
    expect(res.headers.get("X-Pi-Protocol-Version")).toBeTruthy();
    expect(session.invokeCalls).toHaveLength(1);
    expect(session.invokeCalls[0]).toMatchObject({
      name: "gallery-stats",
      req: { method: "GET", query: { a: "1", b: "two" } },
    });
    expect(session.invokeCalls[0]?.req.body).toBeUndefined();
  });

  it("200:非对象结果(数组)原样作为响应体(Req 3.2)", async () => {
    const { handler, session } = setup([decl({ name: "list" })]);
    session.invokeResult = okFrame([1, 2, 3]);
    const res = await handler(get("/sessions/sess-1/agent-routes/list"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual([1, 2, 3]);
  });

  it("POST 200:JSON 请求体解析后传给处理器(Req 3.1)", async () => {
    const { handler, session } = setup([
      decl({ name: "submit", methods: ["GET", "POST"] }),
    ]);
    session.invokeResult = okFrame({ accepted: true });
    const res = await handler(
      post("/sessions/sess-1/agent-routes/submit", JSON.stringify({ x: 1 })),
    );
    expect(res.status).toBe(200);
    expect(session.invokeCalls[0]).toMatchObject({
      name: "submit",
      req: { method: "POST", body: { x: 1 } },
    });
  });

  it("POST 空 body:宽松放行,body 以 undefined 传入(design 3.6 裁量,见模块头注)", async () => {
    const { handler, session } = setup([
      decl({ name: "submit", methods: ["POST"] }),
    ]);
    const res = await handler(post("/sessions/sess-1/agent-routes/submit"));
    expect(res.status).toBe(200);
    expect(session.invokeCalls[0]?.req.body).toBeUndefined();
  });

  it("名称未声明 → 404 ROUTE_NOT_FOUND(Req 2.2)", async () => {
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    const res = await handler(get("/sessions/sess-1/agent-routes/nope"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("ROUTE_NOT_FOUND");
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("方法不在声明集合 → 405 METHOD_NOT_ALLOWED,不转发(Req 2.3)", async () => {
    const { handler, session } = setup([
      decl({ name: "gallery-stats", methods: ["GET"] }),
    ]);
    const res = await handler(
      post("/sessions/sess-1/agent-routes/gallery-stats", "{}"),
    );
    expect(res.status).toBe(405);
    expect(await errorCode(res)).toBe("METHOD_NOT_ALLOWED");
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("非 GET/POST 方法 → 405(Router 层,路径已注册两方法)", async () => {
    const { handler } = setup([decl({ name: "gallery-stats" })]);
    const res = await handler(
      new Request("http://x/sessions/sess-1/agent-routes/gallery-stats", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(405);
  });

  it("POST 非法 JSON → 400 INVALID_BODY,不转发(Req 3.6)", async () => {
    const { handler, session } = setup([
      decl({ name: "submit", methods: ["POST"] }),
    ]);
    const res = await handler(
      post("/sessions/sess-1/agent-routes/submit", "not-json{"),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_BODY");
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("Content-Length 超默认 1 MiB 上限 → 413 提前拒,不转发(Req 4.2)", async () => {
    const { handler, session } = setup([
      decl({ name: "submit", methods: ["POST"] }),
    ]);
    const res = await handler(
      post("/sessions/sess-1/agent-routes/submit", "{}", {
        "content-length": String(2 * 1024 * 1024),
      }),
    );
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("PAYLOAD_TOO_LARGE");
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("上限可经 PI_WEB_AGENT_ROUTE_BODY_LIMIT 覆盖;实际体积兜底复核(Req 4.2)", async () => {
    vi.stubEnv("PI_WEB_AGENT_ROUTE_BODY_LIMIT", "8");
    const { handler, session } = setup([
      decl({ name: "submit", methods: ["POST"] }),
    ]);
    // 无显式 Content-Length(undici 不自动透出)→ 走读后字节数兜底。
    const res = await handler(
      post("/sessions/sess-1/agent-routes/submit", JSON.stringify({ long: "0123456789" })),
    );
    expect(res.status).toBe(413);
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("处理器侧 ok:false → 502 ROUTE_HANDLER_ERROR,含处理器错误消息(Req 3.3)", async () => {
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    session.invokeResult = failFrame("handler_error", "boom from handler");
    const res = await handler(
      get("/sessions/sess-1/agent-routes/gallery-stats"),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ROUTE_HANDLER_ERROR");
    expect(body.error.message).toContain("boom from handler");
  });

  it("转发超时 → 504 ROUTE_TIMEOUT(Req 3.4)", async () => {
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    session.invokeResult = new AgentRouteTimeoutError("gallery-stats", 20_000);
    const res = await handler(
      get("/sessions/sess-1/agent-routes/gallery-stats"),
    );
    expect(res.status).toBe(504);
    expect(await errorCode(res)).toBe("ROUTE_TIMEOUT");
  });

  it("超时值经 PI_WEB_AGENT_ROUTE_TIMEOUT_MS 以参数传入;未设置传 undefined(Req 3.4)", async () => {
    vi.stubEnv("PI_WEB_AGENT_ROUTE_TIMEOUT_MS", "1234");
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    await handler(get("/sessions/sess-1/agent-routes/gallery-stats"));
    expect(session.invokeCalls[0]?.timeoutMs).toBe(1234);

    vi.unstubAllEnvs();
    await handler(get("/sessions/sess-1/agent-routes/gallery-stats"));
    expect(session.invokeCalls[1]?.timeoutMs).toBeUndefined();
  });

  it("门控关断 → 调用端点 404,不转发(Req 4.3)", async () => {
    vi.stubEnv("PI_WEB_AGENT_ROUTES_DISABLED", "1");
    const { handler, session } = setup([decl({ name: "gallery-stats" })]);
    const res = await handler(
      get("/sessions/sess-1/agent-routes/gallery-stats"),
    );
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
    expect(session.invokeCalls).toHaveLength(0);
  });

  it("会话不存在 → 404(Router 既有语义,Req 2.4)", async () => {
    const { handler } = setup([decl({ name: "gallery-stats" })]);
    const res = await handler(get("/sessions/nope/agent-routes/gallery-stats"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("SESSION_NOT_FOUND");
  });
});

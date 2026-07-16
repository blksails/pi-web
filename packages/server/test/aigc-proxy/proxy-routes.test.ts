/**
 * aigc-proxy · proxy-routes 处理器逻辑单测(task 3.1)。
 *
 * 仅注入 `fetchImpl` mock 断言:门控顺序(provider 查表 → token 校验 → 宿主 key 查表 →
 * 转发,任一步失败零上游请求)、headers 过滤(请求侧剔除 host/authorization/
 * content-length/逐跳头 + 注入真实 key;响应侧剔除 content-length/逐跳头)、错误映射
 * (404/401/502/504)、上游 4xx/5xx 状态与体透传。真实 HTTP stub 集成留给下一任务
 * (3.2),此处不做。
 */
import { describe, it, expect, vi } from "vitest";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  createAigcProxyRoutes,
  mintSessionToken,
} from "../../src/aigc-proxy/index.js";

const SECRET = "test-aigc-proxy-secret";

function handlerWith(opts: {
  readonly fetchImpl: typeof fetch;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createAigcProxyRoutes({
      secret: SECRET,
      fetchImpl: opts.fetchImpl,
      env: opts.env ?? {},
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    }),
    authResolver: () => ({ anonymous: true }),
  });
}

function validToken(sessionId = "sess-1"): string {
  return mintSessionToken({ sessionId, ttlMs: 60_000, secret: SECRET });
}

describe("createAigcProxyRoutes — 门控顺序", () => {
  it("未登记 provider → 404,零上游请求", async () => {
    const fetchImpl = vi.fn();
    const res = await handlerWith({ fetchImpl: fetchImpl as unknown as typeof fetch })(
      new Request("http://x/aigc-proxy/unknown-provider/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("缺失 Authorization → 401,零上游请求", async () => {
    const fetchImpl = vi.fn();
    const res = await handlerWith({ fetchImpl: fetchImpl as unknown as typeof fetch })(
      new Request("http://x/aigc-proxy/newapi/images/generations", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("malformed token → 401,零上游请求", async () => {
    const fetchImpl = vi.fn();
    const res = await handlerWith({ fetchImpl: fetchImpl as unknown as typeof fetch })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("篡改签名(不同 secret 签发)→ 401,零上游请求", async () => {
    const fetchImpl = vi.fn();
    const forged = mintSessionToken({
      sessionId: "sess-1",
      ttlMs: 60_000,
      secret: "another-secret",
    });
    const res = await handlerWith({ fetchImpl: fetchImpl as unknown as typeof fetch })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${forged}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("过期 token → 401,零上游请求", async () => {
    const fetchImpl = vi.fn();
    const expired = mintSessionToken({ sessionId: "sess-1", ttlMs: -1, secret: SECRET });
    const res = await handlerWith({ fetchImpl: fetchImpl as unknown as typeof fetch })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${expired}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("token 有效但宿主未配真实 key(env 缺失)→ 502,零上游请求,消息不含 key 值", async () => {
    const fetchImpl = vi.fn();
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(502);
    expect(fetchImpl).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain("sk-");
  });
});

describe("createAigcProxyRoutes — 转发", () => {
  it("成功转发:URL 拼接、headers 过滤(剔除 host/authorization/content-length/逐跳头,注入真实 key,保留 content-type/accept)", async () => {
    const upstreamBody = JSON.stringify({ ok: true });
    const fetchImpl = vi.fn(
      async () =>
        new Response(upstreamBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real-newapi" },
    })(
      new Request(
        "http://x/aigc-proxy/newapi/images/generations?foo=bar",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${validToken()}`,
            host: "sandbox-internal:1234",
            "content-length": "999",
            connection: "keep-alive",
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ prompt: "hi" }),
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(upstreamBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(
      "https://www.apiservices.top/v1/images/generations?foo=bar",
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer sk-real-newapi");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect((init as { duplex?: string }).duplex).toBe("half");
  });

  it("rest 段为空 → 直接打 upstreamBase(不追加多余斜杠)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real" },
    })(
      new Request("http://x/aigc-proxy/newapi/", {
        method: "GET",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://www.apiservices.top/v1");
  });

  it("GET 请求不携带 duplex/body", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { DASHSCOPE_API_KEY: "sk-real-dashscope" },
    })(
      new Request("http://x/aigc-proxy/dashscope/tasks/abc", {
        method: "GET",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://dashscope.aliyuncs.com/api/v1/tasks/abc");
    expect(init.method).toBe("GET");
    expect((init as { duplex?: string }).duplex).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("上游 4xx/5xx 原样透传状态与体", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { SUFY_API_KEY: "sk-real-sufy" },
    })(
      new Request("http://x/aigc-proxy/sufy/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  it("响应 headers 剔除 content-length 与逐跳头", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-length": "2",
            connection: "keep-alive",
            "content-type": "application/json",
          },
        }),
    );
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real" },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.headers.get("connection")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("fetch 网络错误 → 502,体不含上游异常细节", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED at internal-secret-host:443");
    });
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real" },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("internal-secret-host");
  });

  it("超时(timeoutMs 配置且触发)→ 504", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real" },
      timeoutMs: 10,
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(504);
  });
});

describe("createAigcProxyRoutes — 日志脱敏(仅结构性断言,不校验落盘)", () => {
  it("成功路径不抛(日志内部实现细节不在本模块直接可观察,交由 createLogger 既有门控)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await handlerWith({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NEWAPI_API_KEY: "sk-real" },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );
    expect(res.status).toBe(200);
  });
});

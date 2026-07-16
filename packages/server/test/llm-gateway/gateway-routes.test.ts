/**
 * llm-gateway · 网关路由集成测试(design.md LlmGatewayRoutes,Req 3.1-3.3, 3.7)。
 *
 * 路由级(经 Router 分发,mock `fetchImpl`)断言门控顺序——401(无/坏/过期 token)、
 * 403(scope 不符)、404(未登记 provider)、405(非 POST/GET)、502(keyEnv 皆缺)各自
 * **零上游请求**(`fetchImpl` 未被调用);成功路径 `fetchImpl` 被调用且出站
 * `Authorization: Bearer <真实key>`、入站 token 不出现在出站 headers。
 */
import { describe, expect, it, vi } from "vitest";
import { Router } from "../../src/http/router.js";
import type { SessionStore } from "../../src/session/index.js";
import { mintScopedToken } from "../../src/tokens/index.js";
import { createLlmGatewayRoutes } from "../../src/llm-gateway/gateway-routes.js";
import type { LlmGatewayProviderTable } from "../../src/llm-gateway/provider-registry.js";

const SECRET = "test-llm-gateway-secret";

const REGISTRY: LlmGatewayProviderTable = {
  newapi: {
    upstreamBase: "https://upstream.example/newapi/v1",
    keyEnvCandidates: ["NEWAPI_API_KEY", "APISERVICES_API_KEY"],
  },
  sufy: {
    upstreamBase: "https://upstream.example/sufy/v1",
    keyEnvCandidates: ["SUFY_API_KEY"],
  },
};

/** 最小 `SessionStore` stub:本路由不使用 `:id` 段,`get` 恒返回 undefined 即可。 */
const noopStore: SessionStore = {
  get: () => undefined,
} as unknown as SessionStore;

function makeRouter(opts: {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
}): { router: Router; fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn(
    opts.fetchImpl ??
      (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
  );
  const routes = createLlmGatewayRoutes({
    secret: SECRET,
    registry: REGISTRY,
    env: opts.env ?? { NEWAPI_API_KEY: "real-newapi-key" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const router = new Router({ store: noopStore, builtins: [], injected: routes });
  return { router, fetchImpl };
}

function mintFor(provider: string, ttlMs = 60_000): string {
  return mintScopedToken({
    scope: `llm:${provider}`,
    sessionId: "sess-1",
    ttlMs,
    secret: SECRET,
  });
}

describe("createLlmGatewayRoutes — 门控顺序(零上游请求)", () => {
  it("未登记 provider → 404,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/llm-gateway/unknown-provider/chat/completions", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("非 POST/GET(PUT)→ 405,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", { method: "PUT" }),
    );
    expect(res.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("缺失 Authorization → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("malformed token → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("过期 token → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const expired = mintFor("newapi", -1_000);
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${expired}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("scope 不符(llm:sufy token 打 /llm-gateway/newapi)→ 403,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const sufyToken = mintFor("sufy");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${sufyToken}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keyEnvCandidates 皆缺 → 502,零上游请求,文案不含 key", async () => {
    const { router, fetchImpl } = makeRouter({ env: {} });
    const token = mintFor("newapi");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(502);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/key|NEWAPI_API_KEY|real-newapi-key/i);
  });
});

describe("createLlmGatewayRoutes — 成功路径换钥转发", () => {
  it("有效 token + 已配置 key → fetchImpl 被调用,出站 Authorization=真实 key,入站 token 不外泄", async () => {
    let capturedHeaders: Headers | undefined;
    const { router, fetchImpl } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: async (_url, init) => {
        capturedHeaders = new Headers((init as RequestInit).headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const token = mintFor("newapi");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hello: "world" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      "https://upstream.example/newapi/v1/chat/completions",
    );
    expect(capturedHeaders?.get("authorization")).toBe(
      "Bearer sk-real-newapi-secret",
    );
    // 入站 token 不得以任何形式出现在出站 headers 中。
    const outHeaderValues = Array.from(capturedHeaders?.values() ?? []).join(" ");
    expect(outHeaderValues).not.toContain(token);
  });

  it("GET 请求可达且携带 query 透传至上游 URL", async () => {
    const { router, fetchImpl } = makeRouter({
      env: { SUFY_API_KEY: "sk-real-sufy-secret" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    const token = mintFor("sufy");
    const res = await router.route(
      new Request("http://host/llm-gateway/sufy/models?foo=bar", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://upstream.example/sufy/v1/models?foo=bar");
  });

  it("上游 fetch 抛错 → 502,文案不含 key/上游异常细节", async () => {
    const { router, fetchImpl } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: async () => {
        throw new Error("network down: leaked detail sk-real-newapi-secret");
      },
    });
    const token = mintFor("newapi");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain("sk-real-newapi-secret");
    expect(body.error.message).not.toContain("network down");
  });

  it("请求 body 逐字节缓冲转发且出站头无手动 content-length(回归锁)", async () => {
    let capturedInit: RequestInit | undefined;
    const payload = JSON.stringify({ hello: "world", n: 12345 });
    const { router } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: async (_url, init) => {
        capturedInit = init as RequestInit;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const token = mintFor("newapi");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: payload,
      }),
    );

    expect(res.status).toBe(200);
    expect(capturedInit).toBeDefined();
    // body 是缓冲后的 ArrayBuffer,内容逐字节相等。
    expect(capturedInit?.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(capturedInit?.body as ArrayBuffer)).toBe(payload);
    // 回归锁:出站 init 无手动 duplex(缓冲 body 非流,无需 half-duplex),也无手动
    // content-length(fetch 对定长 ArrayBuffer body 自动携带;手动设置会与自动追加重复,
    // undici≥8 混搭下 UND_ERR_INVALID_ARG 502 —— fetch-bridge 血泪教训)。
    expect(capturedInit && "duplex" in capturedInit).toBe(false);
    const outHeaders = new Headers(capturedInit?.headers);
    expect(outHeaders.get("content-length")).toBeNull();
  });

  it("SSE 分块流式到达非整体缓冲(上游流故意不 close 也能立即读到首块)", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: chunk-1\n\n"));
        // 故意不 close:若实现整体缓冲了上游响应体(如内部 await upstream.text()),
        // 下面的 router.route(...) 将永久挂起,与超时竞速的断言会失败。
      },
    });
    const { router } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const token = mintFor("newapi");
    const routePromise = router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const timeoutMarker = Symbol("timeout");
    const timeout = new Promise<typeof timeoutMarker>((resolve) =>
      setTimeout(() => resolve(timeoutMarker), 500),
    );
    const raced = await Promise.race([routePromise, timeout]);
    expect(raced).not.toBe(timeoutMarker);
    const res = raced as Response;
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const { value, done } = await reader!.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toContain("chunk-1");
  });

  it("client abort 传播至上游 fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const { router } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: (_url, init) => {
        capturedSignal = (init as RequestInit).signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          // 由于路由内部在触达 handler 前有 `await`(鉴权解析等),client abort 可能在
          // fetchImpl 被调用**之前**就已发生——故需先同步核对 `aborted`,不能只靠事件。
          if (capturedSignal?.aborted === true) {
            reject(new DOMException("This operation was aborted", "AbortError"));
            return;
          }
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        });
      },
    });
    const token = mintFor("newapi");
    const req = new Request("http://host/llm-gateway/newapi/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const routePromise = router.route(req);
    controller.abort();
    const res = await routePromise;
    expect(res.status).toBe(502);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("上游 4xx 原样透传状态与体", async () => {
    const { router } = makeRouter({
      env: { NEWAPI_API_KEY: "sk-real-newapi-secret" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "bad request upstream" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    });
    const token = mintFor("newapi");
    const res = await router.route(
      new Request("http://host/llm-gateway/newapi/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad request upstream");
  });
});

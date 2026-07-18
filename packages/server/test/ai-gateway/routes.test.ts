/**
 * ai-gateway · 网关路由集成测试(design.md §2.3,Req Story 2)。
 *
 * 路由级(经 Router 分发,mock `fetchImpl`)断言门控顺序——白名单外 404 / 缺 token 401 /
 * scope 不符 403 / 无凭据 502,各自**零上游请求**;成功路径换钥转发(出站 Authorization=
 * 真实 key、入站 token 不外泄)、SSE 逐帧转发、429 限额头标注、abort 联动。
 */
import { describe, expect, it, vi } from "vitest";
import { Router } from "../../src/http/router.js";
import type { SessionStore } from "../../src/session/index.js";
import { mintScopedToken } from "../../src/tokens/index.js";
import { createAiGatewayRoutes } from "../../src/ai-gateway/routes.js";
import type { KeyResolver } from "../../src/ai-gateway/key-resolver.js";

const SECRET = "test-ai-gateway-secret";
const BASE_URL = "https://gw.example.com";

/** 最小 `SessionStore` stub:本路由不使用 `:id` 段。 */
const noopStore: SessionStore = {
  get: () => undefined,
} as unknown as SessionStore;

function fixedKeyResolver(key: string | undefined): KeyResolver {
  return { resolve: async () => key };
}

function makeRouter(opts: {
  readonly keyResolver?: KeyResolver;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): { router: Router; fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn(
    opts.fetchImpl ??
      (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
  );
  const routes = createAiGatewayRoutes({
    baseUrl: BASE_URL,
    secret: SECRET,
    keyResolver: opts.keyResolver ?? fixedKeyResolver("sk-gw-real-key"),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeoutMs: opts.timeoutMs,
  });
  const router = new Router({ store: noopStore, builtins: [], injected: routes });
  return { router, fetchImpl };
}

function mintToken(ttlMs = 60_000, scope = "ai-gateway", sessionId = "sess-1"): string {
  return mintScopedToken({ scope, sessionId, ttlMs, secret: SECRET });
}

describe("createAiGatewayRoutes — 门控顺序(零上游请求)", () => {
  it("白名单外路径 → 404,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/unknown-endpoint", { method: "POST" }),
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("缺失 Authorization → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("malformed token → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("scope 不符(llm:newapi token 打 /ai-gateway/*)→ 403,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const wrongScopeToken = mintToken(60_000, "llm:newapi");
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${wrongScopeToken}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("KeyResolver 无凭据 → 502,零上游请求,文案不含敏感信息", async () => {
    const { router, fetchImpl } = makeRouter({ keyResolver: fixedKeyResolver(undefined) });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(502);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/AI_GATEWAY_API_KEY|sk-gw-/i);
  });
});

describe("createAiGatewayRoutes — 成功路径换钥转发", () => {
  it("有效 token + 已配置 key → 出站 Authorization=真实 key,入站 token 不外泄", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedUrl: string | undefined;
    const { router, fetchImpl } = makeRouter({
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = new Headers((init as RequestInit).headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "doubao-seed-2-0-lite", messages: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`${BASE_URL}/v1/chat/completions`);
    expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-gw-real-key");
    const outHeaderValues = Array.from(capturedHeaders?.values() ?? []).join(" ");
    expect(outHeaderValues).not.toContain(token);
  });

  it("v1/images/ 与 dashscope/api/v1/tasks/ 前缀在白名单内可达", async () => {
    const { router, fetchImpl } = makeRouter({});
    const token = mintToken();
    const imgRes = await router.route(
      new Request("http://host/ai-gateway/v1/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(imgRes.status).toBe(200);
    const taskRes = await router.route(
      new Request("http://host/ai-gateway/dashscope/api/v1/tasks/abc123", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(taskRes.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("SSE 分块流式到达非整体缓冲", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: chunk-1\n\n"));
      },
    });
    const { router } = makeRouter({
      fetchImpl: async () =>
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const token = mintToken();
    const routePromise = router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
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
    const { value, done } = await reader!.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toContain("chunk-1");
  });

  it("429 限额头标注:X-RateLimit-Scope/Period → x-pi-gateway-limit,状态与 body 透传", async () => {
    const { router } = makeRouter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-scope": "org",
            "x-ratelimit-period": "1m",
          },
        }),
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("x-pi-gateway-limit")).toBe("scope=org;period=1m");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rate limited");
  });

  it("402 限额头标注同样生效", async () => {
    const { router } = makeRouter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: { "x-ratelimit-scope": "user", "x-ratelimit-period": "1d" },
        }),
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(402);
    expect(res.headers.get("x-pi-gateway-limit")).toBe("scope=user;period=1d");
  });

  it("非 429/402 状态不附加限额头", async () => {
    const { router } = makeRouter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "x-ratelimit-scope": "org", "x-ratelimit-period": "1m" },
        }),
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-pi-gateway-limit")).toBeNull();
  });

  it("client abort 传播至上游 fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const { router } = makeRouter({
      fetchImpl: (_url, init) => {
        capturedSignal = (init as RequestInit).signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
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
    const token = mintToken();
    const req = new Request("http://host/ai-gateway/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const routePromise = router.route(req);
    controller.abort();
    const res = await routePromise;
    expect(res.status).toBe(502);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("上游 4xx 原样透传状态与体", async () => {
    const { router } = makeRouter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "bad request upstream" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad request upstream");
  });

  it("请求 body 逐字节缓冲转发且出站头无手动 content-length(回归锁)", async () => {
    let capturedInit: RequestInit | undefined;
    const payload = JSON.stringify({ model: "m1", n: 12345 });
    const { router } = makeRouter({
      fetchImpl: async (_url, init) => {
        capturedInit = init as RequestInit;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedInit?.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(capturedInit?.body as ArrayBuffer)).toBe(payload);
    const outHeaders = new Headers(capturedInit?.headers);
    expect(outHeaders.get("content-length")).toBeNull();
  });
});

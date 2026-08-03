/**
 * ai-gateway · 网关路由集成测试(design.md §2.3,Req Story 2;按实例分流见 spec
 * multi-gateway-providers 任务 3.4,Req 1.3)。
 *
 * 路由级(经 Router 分发,mock `fetchImpl`)断言门控顺序——未登记实例 404 / 白名单外
 * 404 / 缺 token 401 / scope 不符(含跨实例 token)403 / 无凭据 502,各自**零上游请求**;
 * 成功路径换钥转发(出站 Authorization=真实 key、入站 token 不外泄)、SSE 逐帧转发、
 * 429 限额头标注、abort 联动;两实例并存时互不串扰(各自 base URL、各自凭据、各自
 * scope,一实例失败不牵连另一实例)。
 */
import { describe, expect, it, vi } from "vitest";
import { Router } from "@blksails/pi-web-core/http/router.js";
import type { SessionStore } from "@blksails/pi-web-core/session/index.js";
import { mintScopedToken } from "../../src/tokens/index.js";
import { createAiGatewayRoutes } from "../../src/ai-gateway/routes.js";
import type {
  AiGatewayInstanceRouteEntry,
  CreateAiGatewayRoutesDeps,
} from "../../src/ai-gateway/routes.js";
import type { KeyResolver } from "../../src/ai-gateway/key-resolver.js";

const SECRET = "test-ai-gateway-secret";
const BASE_URL = "https://gw.example.com";
const INSTANCE = "ai-gateway";

/** 最小 `SessionStore` stub:本路由不使用 `:id` 段。 */
const noopStore: SessionStore = {
  get: () => undefined,
} as unknown as SessionStore;

function fixedKeyResolver(key: string | undefined): KeyResolver {
  return { resolve: async () => key };
}

function makeRouter(opts: {
  readonly instances?: ReadonlyMap<string, AiGatewayInstanceRouteEntry>;
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
  const instances: ReadonlyMap<string, AiGatewayInstanceRouteEntry> =
    opts.instances ??
    new Map([
      [
        INSTANCE,
        { baseUrl: BASE_URL, keyResolver: fixedKeyResolver("sk-gw-real-key") },
      ],
    ]);
  const deps: CreateAiGatewayRoutesDeps = {
    instances,
    secret: SECRET,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  const routes = createAiGatewayRoutes(deps);
  const router = new Router({ store: noopStore, builtins: [], injected: routes });
  return { router, fetchImpl };
}

function mintToken(
  ttlMs = 60_000,
  scope = `ai-gateway:${INSTANCE}`,
  sessionId = "sess-1",
): string {
  return mintScopedToken({ scope, sessionId, ttlMs, secret: SECRET });
}

function path(rest: string, instance = INSTANCE): string {
  return `http://host/ai-gateway/${instance}/${rest}`;
}

describe("createAiGatewayRoutes — 门控顺序(零上游请求)", () => {
  it("未登记的实例标识 → 404,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request(path("v1/chat/completions", "unknown-instance"), { method: "POST" }),
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("白名单外路径 → 404,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request(path("v1/unknown-endpoint"), { method: "POST" }),
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("缺失 Authorization → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request(path("v1/chat/completions"), { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("malformed token → 401,零上游请求", async () => {
    const { router, fetchImpl } = makeRouter({});
    const res = await router.route(
      new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${wrongScopeToken}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("KeyResolver 无凭据 → 502,零上游请求,文案不含敏感信息", async () => {
    const { router, fetchImpl } = makeRouter({
      instances: new Map([
        [INSTANCE, { baseUrl: BASE_URL, keyResolver: fixedKeyResolver(undefined) }],
      ]),
    });
    const token = mintToken();
    const res = await router.route(
      new Request(path("v1/chat/completions"), {
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

describe("createAiGatewayRoutes — 两实例并存互不串扰(Req 1.3)", () => {
  const INSTANCE_A = "blksails-ai";
  const INSTANCE_B = "cloudflare-gw";
  const BASE_URL_A = "https://a.example.com";
  const BASE_URL_B = "https://b.example.com";

  function makeTwoInstanceRouter(opts: {
    readonly keyResolverA?: KeyResolver;
    readonly keyResolverB?: KeyResolver;
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
    const instances = new Map<string, AiGatewayInstanceRouteEntry>([
      [
        INSTANCE_A,
        {
          baseUrl: BASE_URL_A,
          keyResolver: opts.keyResolverA ?? fixedKeyResolver("sk-a-real-key"),
        },
      ],
      [
        INSTANCE_B,
        {
          baseUrl: BASE_URL_B,
          keyResolver: opts.keyResolverB ?? fixedKeyResolver("sk-b-real-key"),
        },
      ],
    ]);
    const routes = createAiGatewayRoutes({
      instances,
      secret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const router = new Router({ store: noopStore, builtins: [], injected: routes });
    return { router, fetchImpl };
  }

  it("各自换钥转发至各自 base URL,互不混用凭据", async () => {
    const capturedUrls: string[] = [];
    const capturedAuths: string[] = [];
    const { router } = makeTwoInstanceRouter({
      fetchImpl: async (url, init) => {
        capturedUrls.push(String(url));
        capturedAuths.push(
          new Headers((init as RequestInit).headers).get("authorization") ?? "",
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    const tokenA = mintToken(60_000, `ai-gateway:${INSTANCE_A}`);
    const resA = await router.route(
      new Request(path("v1/chat/completions", INSTANCE_A), {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(resA.status).toBe(200);

    const tokenB = mintToken(60_000, `ai-gateway:${INSTANCE_B}`);
    const resB = await router.route(
      new Request(path("v1/chat/completions", INSTANCE_B), {
        method: "POST",
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(resB.status).toBe(200);

    expect(capturedUrls).toEqual([
      `${BASE_URL_A}/v1/chat/completions`,
      `${BASE_URL_B}/v1/chat/completions`,
    ]);
    expect(capturedAuths).toEqual(["Bearer sk-a-real-key", "Bearer sk-b-real-key"]);
  });

  it("A 实例的 token 打 B 实例路径 → 403 scope-mismatch,零上游请求", async () => {
    const { router, fetchImpl } = makeTwoInstanceRouter({});
    const tokenA = mintToken(60_000, `ai-gateway:${INSTANCE_A}`);
    const res = await router.route(
      new Request(path("v1/chat/completions", INSTANCE_B), {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("B 实例无凭据 → 仅 B 该请求 502,A 实例不受影响", async () => {
    const { router } = makeTwoInstanceRouter({ keyResolverB: fixedKeyResolver(undefined) });

    const tokenB = mintToken(60_000, `ai-gateway:${INSTANCE_B}`);
    const resB = await router.route(
      new Request(path("v1/chat/completions", INSTANCE_B), {
        method: "POST",
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(resB.status).toBe(502);

    const tokenA = mintToken(60_000, `ai-gateway:${INSTANCE_A}`);
    const resA = await router.route(
      new Request(path("v1/chat/completions", INSTANCE_A), {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(resA.status).toBe(200);
  });
});

describe("createAiGatewayRoutes — 成功路径换钥转发", () => {
  it("有效 token + 已配置 key → 出站 Authorization=真实 key,入站 token 不外泄", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedUrl: string | undefined;
    const { router } = makeRouter({
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
      new Request(path("v1/chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "doubao-seed-2-0-lite", messages: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(`${BASE_URL}/v1/chat/completions`);
    expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-gw-real-key");
    const outHeaderValues = Array.from(capturedHeaders?.values() ?? []).join(" ");
    expect(outHeaderValues).not.toContain(token);
  });

  it("v1/images/ 与 dashscope/api/v1/tasks/ 前缀在白名单内可达", async () => {
    const { router, fetchImpl } = makeRouter({});
    const token = mintToken();
    const imgRes = await router.route(
      new Request(path("v1/images/generations"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(imgRes.status).toBe(200);
    const taskRes = await router.route(
      new Request(path("dashscope/api/v1/tasks/abc123"), {
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
      new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
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
    const req = new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
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
      new Request(path("v1/chat/completions"), {
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

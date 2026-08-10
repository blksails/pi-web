/**
 * 云端出口失效的分类与呈现(spec desktop-aigc-egress 任务 4.1;Req 7.1/7.2/7.3/7.5/8.3)。
 *
 * 分类的意义在于**使用者的下一步动作不同**:凭据过期该去重新登录,配额不足重新登录毫无
 * 用处。不分类时三者在界面上都是 `<url>: 4xx {...}`,只能反复重试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gatewayTransportErrorMessage } from "../../src/aigc/providers/ai-gateway.js";
import { createGatewayImageRoutes } from "../../src/aigc/gateway-image-routes.js";
import { runEndpoint } from "../../src/engine/endpoint-adapter.js";
import type { GatewayImageInstance } from "../../src/aigc/gateway-instances.js";

const INSTANCE: GatewayImageInstance = {
  instanceId: "blksails-cloud",
  baseUrl: "https://c.example/api/desktop/egress",
  apiKey: "desk.cred",
};

describe("gatewayTransportErrorMessage · 失败分类", () => {
  it("★ 401/403 → 提示重新登录", () => {
    for (const status of [401, 403]) {
      const msg = gatewayTransportErrorMessage({
        status,
        url: "https://c.example/v1/images/generations",
        body: "",
        instanceId: "blksails-cloud",
      });
      expect(msg, `status=${status}`).toContain("重新登录");
    }
  });

  it("★ 402/429 → 配额问题,且明说重新登录无助于此(避免用户走错路)", () => {
    for (const status of [402, 429]) {
      const msg = gatewayTransportErrorMessage({
        status,
        url: "https://c.example/v1/images/generations",
        body: "",
        instanceId: "blksails-cloud",
      })!;
      expect(msg, `status=${status}`).toContain("配额");
      expect(msg).toContain("重新登录无助于此");
    }
  });

  it("★ 两类失败可区分(这是 Req 7.2 的全部要求)", () => {
    const auth = gatewayTransportErrorMessage({
      status: 401, url: "u", body: "", instanceId: "i",
    });
    const quota = gatewayTransportErrorMessage({
      status: 429, url: "u", body: "", instanceId: "i",
    });
    expect(auth).not.toBe(quota);
  });

  it("5xx → 上游异常(暂态)", () => {
    const msg = gatewayTransportErrorMessage({
      status: 503, url: "u", body: "", instanceId: "i",
    })!;
    expect(msg).toContain("上游异常");
  });

  it("未接管的状态码 → undefined(沿用默认文案,既有行为不变)", () => {
    expect(
      gatewayTransportErrorMessage({ status: 400, url: "u", body: "", instanceId: "i" }),
    ).toBeUndefined();
  });

  it("★ 文案不含凭据(Req 7.5/8.3)", () => {
    const msg = gatewayTransportErrorMessage({
      status: 401,
      url: "https://c.example/v1/images/generations",
      body: '{"error":"invalid token"}',
      instanceId: "blksails-cloud",
    })!;
    expect(msg).not.toContain("desk.cred");
    expect(msg).not.toContain("sk-gw");
  });
});

describe("经引擎的端到端错误路径", () => {
  /**
   * ★ 必须设置该 env:路由的 `apiKeyVar` 存的是**变量名**,凭据在执行期才由 var-resolver
   * 从 env 取。不设时引擎抛 `Missing env variable: …_KEY` —— 那本身正是"凭据一步都不进
   * 声明层"的证据(首轮跑本文件时就是这样失败的)。
   */
  const KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY";
  beforeEach(() => {
    process.env[KEY_ENV] = "desk.cred";
  });
  afterEach(() => {
    delete process.env[KEY_ENV];
  });

  /** 用桩 fetch 让路由真的跑一次 runEndpoint,验证映射确实被引擎调用。 */
  async function runWithStatus(status: number, body = "{}"): Promise<string> {
    const { generation } = createGatewayImageRoutes(INSTANCE);
    const route = generation[0]!;
    const fetchImpl = vi.fn(async () =>
      new Response(body, { status, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    try {
      await runEndpoint(route, { prompt: "x", model: route.model }, { fetchImpl });
      return "<no error>";
    } catch (e) {
      return (e as Error).message;
    }
  }

  it("★ 401 经引擎抛出的是分类后的文案,而不是 `<url>: 401 ...`", async () => {
    const msg = await runWithStatus(401, '{"error":"unauthorized"}');
    expect(msg).toContain("重新登录");
    // 默认文案的形态是 `<url>: 401 <body>`;分类生效后不应再出现。
    expect(msg).not.toMatch(/^https?:\/\/\S+: 401/);
  });

  it("★ 429 经引擎抛出配额文案", async () => {
    const msg = await runWithStatus(429);
    expect(msg).toContain("配额");
  });

  it("★ 失败即终止,不改用其他供应商重试(Req 7.3)", async () => {
    const { generation } = createGatewayImageRoutes(INSTANCE);
    const route = generation[0]!;
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(
      runEndpoint(route, { prompt: "x", model: route.model }, { fetchImpl }),
    ).rejects.toThrow();
    // 恰好一次上游调用:没有静默重试、没有换 provider 再试。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("400 等未接管状态码 → 仍是默认文案(未被顺手改写)", async () => {
    const msg = await runWithStatus(400, "bad request");
    expect(msg).toContain("400");
  });
});

describe("实际请求的地址与认证头(spec desktop-aigc-egress 任务 5.1)", () => {
  const KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY";
  const CREDENTIAL = "desk.cred.value";
  beforeEach(() => {
    process.env[KEY_ENV] = CREDENTIAL;
  });
  afterEach(() => {
    delete process.env[KEY_ENV];
  });

  it("★ 真正发出的 URL 恰好一个 /v1,认证头是桌面凭据(而非 sk-gw)", async () => {
    const { generation } = createGatewayImageRoutes({
      instanceId: "blksails-cloud",
      baseUrl: "https://pi-cloud.apps.blksails.cn/api/desktop/egress",
      apiKey: CREDENTIAL,
    });
    let seenUrl = "";
    let seenAuth = "";
    const fetchImpl = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(u);
      seenAuth = new Headers((init?.headers ?? {}) as Record<string, string>).get("authorization") ?? "";
      return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await runEndpoint(
      generation[0]!,
      { prompt: "a cat", model: generation[0]!.model },
      { fetchImpl },
    );

    expect(seenUrl).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1/images/generations",
    );
    expect(seenUrl).not.toContain("/v1/v1");
    // 云端出口据此验签并换 sk-gw —— 本地出示的始终只是桌面凭据。
    expect(seenAuth).toBe(`Bearer ${CREDENTIAL}`);
    expect(seenAuth).not.toContain("sk-gw");
  });
});

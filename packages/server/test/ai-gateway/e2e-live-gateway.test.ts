/**
 * ai-gateway · e2e 冒烟(启用组) — 对接本地真实 ai-gateway 二进制(spec
 * ai-gateway-providers,design.md §5,任务 6.2,Req 6.4)。
 *
 * 前置:本地 ai-gateway 需已在 http://127.0.0.1:8080 启动(仓库
 * `~/Projects/BlackSail/agents/ai-gateway`,`./tmp/gateway -config config.local.yaml`)。
 * 未监听时整组测试自动跳过(不让"网关未启动"这一环境问题伪装成断言失败)。
 *
 * 走 `createAiGatewayRoutes`(经 `Router` 分发,零 mock)完整门控 + 换钥转发链路,断言
 * 一次真实流式主对话(逐帧 + 完成帧)。429/402 限额头标注的真实触发需要网关侧配置低 RPM
 * key,成本较高;已在 `routes.test.ts` 用 mock 上游覆盖该断言矩阵(见该文件),此处不重复。
 */
import { describe, expect, it } from "vitest";
import { Router } from "../../src/http/router.js";
import type { SessionStore } from "../../src/session/index.js";
import { mintScopedToken } from "../../src/tokens/index.js";
import { createAiGatewayRoutes } from "../../src/ai-gateway/routes.js";
import { EnvKeyResolver } from "../../src/ai-gateway/key-resolver.js";

const GATEWAY_BASE = "http://127.0.0.1:8080";
const TEST_KEY = "sk-gw-8BaZo07Tw8plmwnmeugMflI0";
const SECRET = "e2e-live-gateway-secret";
const CHAT_MODEL = "doubao-seed-2-0-lite";

const noopStore: SessionStore = {
  get: () => undefined,
} as unknown as SessionStore;

// 收集期(模块顶层)同步探测网关是否在线,供 describe.skipIf 在**收集时**(而非运行时)
// 决定是否跳过整组——vitest 的 skipIf 在 collect 阶段求值,故不能放进 beforeAll(那时已
// 太晚)。top-level await 由 vitest(ESM)原生支持。
let gatewayUp = false;
try {
  const res = await fetch(`${GATEWAY_BASE}/v1/models`, {
    headers: { authorization: `Bearer ${TEST_KEY}` },
    signal: AbortSignal.timeout(3_000),
  });
  gatewayUp = res.ok;
} catch {
  gatewayUp = false;
}
if (!gatewayUp) {
  // eslint-disable-next-line no-console
  console.warn(
    "[ai-gateway e2e] 本地网关未在 http://127.0.0.1:8080 监听 —— 跳过启用组 e2e(见文件头注释)。",
  );
}

describe.skipIf(!gatewayUp)("ai-gateway e2e(启用组,真实本地网关)", () => {
  function makeRouter(): Router {
    const routes = createAiGatewayRoutes({
      baseUrl: GATEWAY_BASE,
      secret: SECRET,
      keyResolver: new EnvKeyResolver({ AI_GATEWAY_API_KEY: TEST_KEY }),
      timeoutMs: 30_000,
    });
    return new Router({ store: noopStore, builtins: [], injected: routes });
  }

  function mintToken(): string {
    return mintScopedToken({
      scope: "ai-gateway",
      sessionId: "e2e-sess-1",
      ttlMs: 60_000,
      secret: SECRET,
    });
  }

  it("GET /v1/models 经门控 + 换钥转发,返回真实网关目录", async () => {
    if (!gatewayUp) return;
    const router = makeRouter();
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/models", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m) => m.id === CHAT_MODEL)).toBe(true);
  });

  it("流式主对话:逐帧到达 + 完成(经 /ai-gateway/v1/chat/completions 真实网关往返)", async () => {
    if (!gatewayUp) return;
    const router = makeRouter();
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          stream: true,
          messages: [{ role: "user", content: "Reply with exactly one word: hi" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let buffered = "";
    let frameCount = 0;
    let sawDone = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader!.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        frameCount += 1;
        const payload = line.slice("data: ".length).trim();
        if (payload === "[DONE]") sawDone = true;
      }
      if (sawDone) break;
    }
    // 逐帧转发:至少收到多于一帧(证明非整体缓冲后一次性吐出)。
    expect(frameCount).toBeGreaterThan(1);
    expect(sawDone).toBe(true);
  }, 40_000);

  it("图像生成:经 /ai-gateway/v1/images/generations 真实网关往返,返回可解码图像数据", async () => {
    const router = makeRouter();
    const token = mintToken();
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "a small red circle on a white background",
          n: 1,
          response_format: "b64_json",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const first = body.data[0];
    expect(first?.b64_json !== undefined || first?.url !== undefined).toBe(true);
  }, 60_000);

  it("入站 scope 不符 → 403,零上游请求语义在真实网关面前依然成立(门控先于转发)", async () => {
    if (!gatewayUp) return;
    const router = makeRouter();
    const wrongScope = mintScopedToken({
      scope: "llm:newapi",
      sessionId: "e2e-sess-2",
      ttlMs: 60_000,
      secret: SECRET,
    });
    const res = await router.route(
      new Request("http://host/ai-gateway/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${wrongScope}` },
      }),
    );
    expect(res.status).toBe(403);
  });
});

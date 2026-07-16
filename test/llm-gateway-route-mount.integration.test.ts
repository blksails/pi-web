/**
 * Integration: pi-handler 路由注册段的 LLM 网关 serve 门控(spec sandbox-credentials-v2,
 * 任务 3.4,Req 3.8)。
 *
 * SERVE 门控开启(`PI_WEB_LLM_GATEWAY_PUBLIC_BASE` 已配置且未显式关闭 SERVE)时,
 * `createLlmGatewayRoutes` 必须经 pi-handler 挂载到 `/api/llm-gateway/:provider/*`
 * ——本测试只断言"路由已挂载且按门控响应"(无 token → 401),不复测网关内部换钥/透传
 * 细节(那是 2.2/2.3 的范围,已在 `packages/server/test/llm-gateway/` 覆盖)。
 *
 * 门控关闭态(路由不注册 → 404)由姊妹文件
 * `llm-gateway-route-mount-disabled.integration.test.ts` 覆盖 —— 配置是否 serve 需要
 * 在模块导入前经 env 决定,而 handler 单例 pin 在 globalThis(pi-web-handler-singleton-restart
 * 教训),两态必须分文件跑以获得各自独立的模块图/单例。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
// SERVE 门控开启:PUBLIC_BASE 非空且 PI_WEB_LLM_GATEWAY_SERVE 未显式关闭(默认即启,3.2)。
process.env.PI_WEB_LLM_GATEWAY_PUBLIC_BASE = "http://localhost:3010";
process.env.PI_WEB_LLM_GATEWAY_SECRET = "test-llm-gateway-secret-abcdef0123456789";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

describe("SERVE 门控开启:/api/llm-gateway/:provider/* 已挂载", () => {
  it("已登记 provider(newapi)+ 无 token → 401(证明路由已挂载并触达鉴权门控,而非 404)", async () => {
    const res = await route.POST(
      req("/api/llm-gateway/newapi/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET 方法同样触达门控(未登记 header → 401,而非路由未注册的 404)", async () => {
    const res = await route.GET(req("/api/llm-gateway/newapi/v1/models"));
    expect(res.status).toBe(401);
  });

  it("未登记 provider → 404(门控顺序:provider 登记先于鉴权,仍证明路由本体已挂载)", async () => {
    const res = await route.POST(
      req("/api/llm-gateway/does-not-exist/v1/x", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("其余既有路由(会话创建)不受网关挂载影响", async () => {
    const res = await route.POST(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
  });
});

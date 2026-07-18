/**
 * Integration: pi-handler 路由注册段的 ai-gateway 挂载 —— 启用态(spec
 * ai-gateway-providers,design.md §2.5,任务 4.1,Req 1.1)。
 *
 * `AI_GATEWAY_BASE_URL` 已配置时,`createAiGatewayRoutes` 必须经 pi-handler 挂载到
 * `/api/ai-gateway/*`——本测试只断言"路由已挂载且按门控响应"(无 token → 401,白名单外
 * → 404),不复测网关内部换钥/透传细节(那是 2.x 的范围,已在
 * `packages/server/test/ai-gateway/` 覆盖)。
 *
 * 关闭态(路由不注册 → 404)由姊妹文件 `ai-gateway-route-mount-disabled.integration.test.ts`
 * 覆盖 —— 配置是否注册需要在模块导入前经 env 决定,而 handler 单例 pin 在 globalThis
 * (pi-web-handler-singleton-restart 教训),两态必须分文件跑以获得各自独立的模块图/单例。
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
// ai-gateway 套件启用:AI_GATEWAY_BASE_URL 已配置(Req 1.1)。
process.env.AI_GATEWAY_BASE_URL = "http://127.0.0.1:8080";
process.env.PI_WEB_AI_GATEWAY_SECRET = "test-ai-gateway-secret-abcdef0123456789";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

describe("AI_GATEWAY_BASE_URL 已配置:/api/ai-gateway/* 已挂载", () => {
  it("白名单内路径 + 无 token → 401(证明路由已挂载并触达鉴权门控,而非 404)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET 方法同样触达门控(未带 token → 401,而非路由未注册的 404)", async () => {
    const res = await route.GET(req("/api/ai-gateway/v1/models"));
    expect(res.status).toBe(401);
  });

  it("白名单外路径 → 404(门控顺序:白名单先于鉴权,仍证明路由本体已挂载)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/v1/does-not-exist", {
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

  it("GET /api/config/models 可达且不因 ai-gateway 目录聚合而报错(网关不可达 → fail-soft 空集)", async () => {
    const res = await route.GET(req("/api/config/models"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; providers: unknown[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
  });
});

/**
 * Integration: pi-handler 路由注册段的 LLM 网关 serve 门控 —— 关闭态(spec
 * sandbox-credentials-v2,任务 3.4,Req 3.8)。
 *
 * 未配置 `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`(网关未启用)时,`createLlmGatewayRoutes`
 * 不得被注册:`/api/llm-gateway/*` 落既有 404 语义,且**不因缺网关配置影响其余装配**
 * ——尤其要断言 `resolveLlmGatewaySecret` 未启用时不会被无条件调用(它在两个 secret
 * env 皆缺时会抛错;若装配段无条件求值,未配置网关的部署会在此处直接崩溃)。本文件全程
 * 不设置 `PI_WEB_LLM_GATEWAY_SECRET`/`PI_WEB_ATTACHMENT_SECRET`,若装配崩溃则该断言必然
 * 通过失败的方式暴露(import 阶段抛错、afterAll 前测试全部不执行)。
 *
 * 开启态(路由已挂载)由姊妹文件 `llm-gateway-route-mount.integration.test.ts` 覆盖。
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
// 显式确保未配置网关:不设置 PUBLIC_BASE,也不设置任一 secret env(验证装配不会因
// 未启用网关而无条件触达 resolveLlmGatewaySecret)。
delete process.env.PI_WEB_LLM_GATEWAY_PUBLIC_BASE;
delete process.env.PI_WEB_LLM_GATEWAY_SECRET;
delete process.env.PI_WEB_ATTACHMENT_SECRET;
delete process.env.PI_WEB_LLM_GATEWAY_SERVE;

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

describe("SERVE 门控关闭(网关未配置):/api/llm-gateway/* 未挂载", () => {
  let sessionId: string;

  beforeAll(async () => {
    const res = await route.POST(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    sessionId = ((await res.json()) as { sessionId: string }).sessionId;
  });

  it("/api/llm-gateway/newapi/foo → 404(路由未注册,非网关内部 404)", async () => {
    const res = await route.POST(
      req("/api/llm-gateway/newapi/foo", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("GET 亦 404", async () => {
    const res = await route.GET(req("/api/llm-gateway/newapi/foo"));
    expect(res.status).toBe(404);
  });

  it("其余装配未受影响:会话创建正常工作", () => {
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("其余装配未受影响:既有只读路由(GET /api/aigc/models)正常工作", async () => {
    const res = await route.GET(req("/api/aigc/models"));
    expect(res.status).toBe(200);
  });
});

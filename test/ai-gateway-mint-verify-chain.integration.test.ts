/**
 * Integration: ai-gateway mint↔verify 链路(spec multi-gateway-providers,任务 3.4,
 * Req 1.3)。
 *
 * 根治点:`lib/app/ai-gateway-assembly.ts`(mint 侧,铸造 `PI_AI_GATEWAY_BASE` /
 * `PI_AI_GATEWAY_TOKEN`)与 `packages/adapters/src/ai-gateway/routes.ts`(verify 侧,
 * pi-handler 挂载的真实路由)各自以字符串字面量拼接路径/scope,tsc 对这类契约看不见——
 * 两侧曾各写各的,互不相遇,直到本文件才第一次真正对上。用 `computeAiGatewaySessionEnv`
 * 产出的 token 与 base 去打经 `lib/app/pi-handler.ts` 挂载的真实路由,断言鉴权门控放行
 * (不是 401/403/404),证明 mint 侧与 verify 侧的路径段/scope 前缀确实同源。
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
delete process.env.PI_WEB_HIDE_PROVIDERS;

// 活体 stub 上游网关:GET /v1/models 200,供换钥转发成功命中(而非因上游不可达 502)。
const gwServer = http.createServer((gwReq, gwRes) => {
  if (gwReq.url === "/v1/models") {
    gwRes.setHeader("content-type", "application/json");
    gwRes.end(JSON.stringify({ data: [{ id: "chain-test-model", owned_by: "openai-compat" }] }));
    return;
  }
  gwRes.statusCode = 404;
  gwRes.end();
});
await new Promise<void>((resolve) => gwServer.listen(0, "127.0.0.1", resolve));
const gwPort = (gwServer.address() as AddressInfo).port;

const SECRET = "test-ai-gateway-secret-abcdef0123456789";
process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${gwPort}`;
process.env.PI_WEB_AI_GATEWAY_SECRET = SECRET;
// 有意不设置 BLKSAILS_GATEWAY_API_KEY/AI_GATEWAY_API_KEY:EnvKeyResolver 解析不出上游
// key 时 handler 在换钥转发**之前**短路返回 502(routes.ts 步骤 5),不会真正调用
// `fetchImpl`/`AbortSignal.any`——本测试只需证明 token 通过了步骤 1–4(路径匹配 + scope
// 校验),502 恰是「已过鉴权、卡在凭据解析」的确凿证据,且不依赖 jsdom test 环境对
// `AbortSignal.any` 的支持(测试环境已知不支持,与本链路缺陷无关)。

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");
const { computeAiGatewaySessionEnv, AI_GATEWAY_SANDBOX_TOKEN_ENV } = await import(
  "@/lib/app/ai-gateway-assembly"
);
const { resolveAiGatewayConfig } = await import("@blksails/pi-web-adapters/ai-gateway/index.js");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  await new Promise<void>((resolve) => gwServer.close(() => resolve()));
});

describe("mint(ai-gateway-assembly) ↔ verify(routes.ts,经 pi-handler 挂载) 链路对齐(Req 1.3)", () => {
  it("computeAiGatewaySessionEnv 铸造的 token 打真实挂载路由 → 鉴权门控放行(非 401/403/404)", async () => {
    const aiGatewayConfig = resolveAiGatewayConfig(process.env);
    const sessionEnv = computeAiGatewaySessionEnv({
      aiGatewayConfig,
      sessionId: "chain-test-session",
      env: process.env,
      publicBase: "http://localhost",
      tokenTtlMs: 3_600_000,
    });
    const token = sessionEnv.env[AI_GATEWAY_SANDBOX_TOKEN_ENV];
    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(0);

    const res = await route.GET(
      req("/api/ai-gateway/ai-gateway/v1/models", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    // 鉴权门控放行的证据:不是 401(token 校验失败)、不是 403(scope 不匹配)、
    // 不是 404(路径/实例未识别)——502 = 已通过步骤 1–4,卡在(有意不配置的)上游凭据
    // 解析,证明 mint 侧铸造的 base/scope 与 verify 侧的路径段/scope 前缀确实同源。
    expect([401, 403, 404]).not.toContain(res.status);
    expect(res.status).toBe(502);
  });
});

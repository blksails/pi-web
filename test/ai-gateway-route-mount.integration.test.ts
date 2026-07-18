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
import { afterAll, describe, expect, it, vi } from "vitest";
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
// 目录断言的确定性:不让宿主环境的 hidden 配置渗入(model-catalog spec 任务 3.1)。
delete process.env.PI_WEB_HIDE_PROVIDERS;

// 活体 stub 网关(model-catalog spec 任务 3.1,Req 1.1/6.2):GatewayModelCatalog 惰性
// stale-while-revalidate,要让 GET /api/config/models 里出现网关条目,必须有可达的
// `GET /v1/models`。用 node:http 起在临时端口,再把 base URL 写进 env(须在 route 模块
// 动态 import **之前**,装配期 resolveAiGatewayConfig 读 env)。
const GW_MODEL_ID = "deepseek-v3-gw";
const GW_CHANNEL = "openai-compat";
const gwServer = http.createServer((gwReq, gwRes) => {
  if (gwReq.url === "/v1/models") {
    gwRes.setHeader("content-type", "application/json");
    gwRes.end(JSON.stringify({ data: [{ id: GW_MODEL_ID, owned_by: GW_CHANNEL }] }));
    return;
  }
  gwRes.statusCode = 404;
  gwRes.end();
});
await new Promise<void>((resolve) => gwServer.listen(0, "127.0.0.1", resolve));
const gwPort = (gwServer.address() as AddressInfo).port;

// ai-gateway 套件启用:AI_GATEWAY_BASE_URL 已配置(Req 1.1)。
process.env.AI_GATEWAY_BASE_URL = `http://127.0.0.1:${gwPort}`;
process.env.PI_WEB_AI_GATEWAY_SECRET = "test-ai-gateway-secret-abcdef0123456789";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  await new Promise<void>((resolve) => gwServer.close(() => resolve()));
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

  it("GET /api/config/models 可达且不因 ai-gateway 目录聚合而报错", async () => {
    const res = await route.GET(req("/api/config/models"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; providers: unknown[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
  });
});

interface ChatModel {
  readonly provider: string;
  readonly id: string;
  readonly source?: string;
  readonly channel?: string;
}

describe("聚合形态:目录端点经组装服务取数(model-catalog spec 任务 3.1)", () => {
  it("GET /api/config/models:providers = 全部 self 归属(无渠道名/无 ai-gateway),models 并入网关条目且 provider 恒为 'ai-gateway'(Req 1.1/6.2)", async () => {
    // 首次调用触发 stale-while-revalidate 后台刷新(返回空快照),轮询直至网关条目并入。
    const body = await vi.waitFor(
      async () => {
        const res = await route.GET(req("/api/config/models"));
        expect(res.status).toBe(200);
        const b = (await res.json()) as { providers: string[]; models: ChatModel[] };
        expect(b.models.some((m) => m.source === "ai-gateway")).toBe(true);
        return b;
      },
      { timeout: 5000, interval: 100 },
    );

    // (a) providers 恢复含**全部** self 归属(providers 集合 = self 条目 provider 集合),
    // 且不含渠道名、不含 "ai-gateway"(Req 1.1/2.2/3.1)。
    const selfProviders = new Set(
      body.models.filter((m) => m.source === "self").map((m) => m.provider),
    );
    expect(new Set(body.providers)).toEqual(selfProviders);
    expect(body.providers).not.toContain("ai-gateway");
    expect(body.providers).not.toContain(GW_CHANNEL);

    // (b) 网关条目 provider 全收敛为 "ai-gateway",渠道名降级为 channel 元数据。
    const gwModels = body.models.filter((m) => m.source === "ai-gateway");
    expect(gwModels.length).toBeGreaterThan(0);
    for (const m of gwModels) {
      expect(m.provider).toBe("ai-gateway");
    }
    const injected = gwModels.find((m) => m.id === GW_MODEL_ID);
    expect(injected).toBeDefined();
    expect(injected!.channel).toBe(GW_CHANNEL);
  });

  it("GET /api/aigc/models:含三条网关条目且 source='ai-gateway',self 条目附 source='self'(Req 4.1/6.2)", async () => {
    const res = await route.GET(req("/api/aigc/models"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ model: string; provider: string; source?: string }>;
    };
    const byId = new Map(body.models.map((m) => [m.model, m]));
    for (const id of ["gpt-image-1", "gpt-image-2-ai-gateway", "qwen-image"]) {
      const entry = byId.get(id);
      expect(entry, `缺网关条目 ${id}`).toBeDefined();
      expect(entry!.source).toBe("ai-gateway");
      expect(entry!.provider).toBe("ai-gateway");
    }
    // self 静态条目在聚合形态附 source="self"(响应只增不改,Req 4.1)。
    const self = byId.get("gpt-image-2");
    expect(self).toBeDefined();
    expect(self!.source).toBe("self");
  });
});

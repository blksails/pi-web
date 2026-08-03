/**
 * Integration: pi-handler 路由注册段的 ai-gateway 挂载 —— 启用态(spec
 * ai-gateway-providers,design.md §2.5,任务 4.1,Req 1.1)。
 *
 * `AI_GATEWAY_BASE_URL` 已配置时,`createAiGatewayRoutes` 必须经 pi-handler 挂载到
 * `/api/ai-gateway/*`——本测试只断言"路由已挂载且按门控响应"(无 token → 401,白名单外
 * → 404),不复测网关内部换钥/透传细节(那是 2.x 的范围,已在
 * `packages/adapters/test/ai-gateway/` 覆盖)。
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
// ★spec cloudflare-chat-provider 给目录加了**默认 provider 白名单**
// (anthropic/openai/google-ai-studio),而本夹具的 owned_by 是 `openai-compat`——
// 不在默认白名单内,会被 filterByOwner 静默滤空,导致网关条目永远不出现。
// 该 spec 引入白名单时漏改了本夹具(是既有回归,非本 spec 所致)。
// 显式放行本夹具的渠道名:GW_CHANNEL 刻意取一个与任何 self provider 都不同的值,
// 用于断言「渠道名不进 providers」,故不能改用 `openai` 代替。
process.env.PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST = GW_CHANNEL;
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

describe("AI_GATEWAY_BASE_URL 已配置:/api/ai-gateway/:instance/* 已挂载(按实例分流,Req 1.3)", () => {
  it("白名单内路径 + 无 token → 401(证明路由已挂载并触达鉴权门控,而非 404)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/ai-gateway/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET 方法同样触达门控(未带 token → 401,而非路由未注册的 404)", async () => {
    const res = await route.GET(req("/api/ai-gateway/ai-gateway/v1/models"));
    expect(res.status).toBe(401);
  });

  it("白名单外路径 → 404(门控顺序:白名单先于鉴权,仍证明路由本体已挂载)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/ai-gateway/v1/does-not-exist", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("不带实例段的旧路径 → 404(契约变更钉住:`/ai-gateway/v1/...` 不再是合法路径,Req 1.3)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/v1/chat/completions", {
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
  // ★spec ai-gateway-session-models Req 6.1/6.4:本用例原断言「providers 不含 ai-gateway」,
  // 那是 model-catalog spec 在网关条目**不可接入会话**时冻结的约定。availability 已翻为
  // "session"(网关模型现在能跑),故 providers 有意追加 ai-gateway —— 否则用户无法把网关
  // 设为默认 Provider。渠道名不进入这一条未变,继续钉住。
  it("GET /api/config/models:providers = 全部 self 归属 + ai-gateway(无渠道名),models 并入网关条目且 provider 恒为 'ai-gateway'(Req 1.1/6.2)", async () => {
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

    // (a) providers 含**全部** self 归属,外加 ai-gateway(网关条目非空时);
    // 渠道名恒不进入(Req 1.1/2.2/3.1 + ai-gateway-session-models Req 6.1)。
    const selfProviders = new Set(
      body.models.filter((m) => m.source === "self").map((m) => m.provider),
    );
    expect(new Set(body.providers)).toEqual(new Set([...selfProviders, "ai-gateway"]));
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

  it("GET /api/aigc/models 已删除(multi-gateway-providers 任务 4.3,Req 3.2)", async () => {
    const res = await route.GET(req("/api/aigc/models"));
    expect(res.status).not.toBe(200);
  });

  it("GET /api/config/models?output=image:含三条网关条目且 source='ai-gateway',self 条目附 source='self'(Req 3.2, 4.1, 6.2 —— 取代已删除的 GET /api/aigc/models)", async () => {
    const res = await route.GET(req("/api/config/models?output=image"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ id: string; provider: string; source?: string }>;
    };
    const byId = new Map(body.models.map((m) => [m.id, m]));
    for (const id of ["gpt-image-1", "gpt-image-2-ai-gateway", "qwen-image"]) {
      const entry = byId.get(id);
      expect(entry, `缺网关条目 ${id}`).toBeDefined();
      expect(entry!.source).toBe("ai-gateway");
      // provider 与 source 故意不同:`source` 记**来源渠道**(网关 compat 通路,恒 ai-gateway),
      // `provider` 是条目自身声明的**归属** —— 2026-08-03 改判为 `cloudflare`(该通路当前
      // 指向 Cloudflare AI Gateway 的 compat 端点),与原生 Cloudflare 图像组同一 provider。
      expect(entry!.provider).toBe("cloudflare");
    }
    // self 静态条目在聚合形态附 source="self"(响应只增不改,Req 4.1)。
    const self = byId.get("gpt-image-2");
    expect(self).toBeDefined();
    expect(self!.source).toBe("self");
  });
});

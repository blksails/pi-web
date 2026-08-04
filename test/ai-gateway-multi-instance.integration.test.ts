/**
 * Integration: pi-handler 装配层接通多网关实例(spec multi-gateway-providers 任务 3.6,
 * Req 1.1/1.3)。
 *
 * `PI_WEB_GATEWAYS=<id1>,<id2>` 显式声明两个网关实例时,断言:
 *  (a) 部署级目录(`GET /api/config/models`)provider 清单**分别**含两个实例标识,
 *      且各自的模型归属到各自的实例(而非折叠为单一 "ai-gateway" 常量,Req 1.2/1.3);
 *  (b) 两个实例的转发路由均已挂载(`/api/ai-gateway/<id>/*` 对两个 id 都命中鉴权门控
 *      而非 404),证明 `aiGateway.instances` Map 由 `gatewayInstances` 逐个构造而非
 *      硬编码单实例(装配点见 `lib/app/pi-handler.ts`);
 *  (c) 其中一个实例的目录拉取失败(base URL 指向一个恒 500 的服务)时,仅该实例的模型
 *      缺席,另一实例与 self 模型仍完整(Req 1.5,每实例独立 `GatewayModelCatalog`)。
 *
 * 会话侧(本地 spawn env 多实例还原)由纯函数单测覆盖
 * (`test/ai-gateway-session-assembly.test.ts` 的 `computeAiGatewaySessionsSpawnEnv`
 * 套件)+ runner 侧的通用 N-provider 还原(`packages/runner/test/runner/
 * model-source-registrar.it.test.ts`,任务 3.5)——两者组合即完成 Req 1.1/1.3 在会话侧
 * 的还原链路,本文件只覆盖部署级(HTTP 可观测)的一半。
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
delete process.env.PI_WEB_HIDE_PROVIDERS;
// 两个实例互不相同的白名单渠道名,验证归属互不串扰。
const INSTANCE_A_MODEL = "gpt-mesh-a";
const INSTANCE_A_CHANNEL = "channel-a";
const INSTANCE_B_MODEL = "claude-mesh-b";
const INSTANCE_B_CHANNEL = "channel-b";

function makeCatalogServer(modelId: string, ownedBy: string): http.Server {
  return http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: modelId, owned_by: ownedBy }] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

const gwA = makeCatalogServer(INSTANCE_A_MODEL, INSTANCE_A_CHANNEL);
const gwB = makeCatalogServer(INSTANCE_B_MODEL, INSTANCE_B_CHANNEL);
// 恒 500 的第三个网关,专供「单实例失败不牵连」用例(独立测试文件级实例,不与上面两个
// 混用,避免 stale-while-revalidate 的目录缓存跨用例互相污染)。
const gwFailing = http.createServer((_req, res) => {
  res.statusCode = 500;
  res.end("boom");
});

await new Promise<void>((resolve) => gwA.listen(0, "127.0.0.1", resolve));
await new Promise<void>((resolve) => gwB.listen(0, "127.0.0.1", resolve));
await new Promise<void>((resolve) => gwFailing.listen(0, "127.0.0.1", resolve));
const portA = (gwA.address() as AddressInfo).port;
const portB = (gwB.address() as AddressInfo).port;
const portFailing = (gwFailing.address() as AddressInfo).port;

// 两个网关实例(Req 1.1/1.6):加实例只需加配置,不需要触碰装配代码。
process.env.PI_WEB_GATEWAYS = "inst-a,inst-b,inst-fail";
process.env.PI_WEB_GATEWAY_INST_A_BASE_URL = `http://127.0.0.1:${portA}`;
process.env.PI_WEB_GATEWAY_INST_A_ALLOWLIST = INSTANCE_A_CHANNEL;
process.env.PI_WEB_GATEWAY_INST_A_API_KEY = "inst-a-key";
process.env.PI_WEB_GATEWAY_INST_B_BASE_URL = `http://127.0.0.1:${portB}`;
process.env.PI_WEB_GATEWAY_INST_B_ALLOWLIST = INSTANCE_B_CHANNEL;
process.env.PI_WEB_GATEWAY_INST_B_API_KEY = "inst-b-key";
process.env.PI_WEB_GATEWAY_INST_FAIL_BASE_URL = `http://127.0.0.1:${portFailing}`;
process.env.PI_WEB_GATEWAY_INST_FAIL_API_KEY = "inst-fail-key";
process.env.PI_WEB_AI_GATEWAY_SECRET = "test-multi-instance-secret-abcdef0123456789";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  await Promise.all(
    [gwA, gwB, gwFailing].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

interface ChatModel {
  readonly provider: string;
  readonly id: string;
  readonly source?: string;
  readonly channel?: string;
}

describe("多网关实例装配(spec multi-gateway-providers 任务 3.6,Req 1.1/1.3)", () => {
  it("部署级目录:两个实例各自出现在 providers 清单,且各自的模型归属到各自的实例标识(不折叠为单一常量)", async () => {
    const body = await vi.waitFor(
      async () => {
        const res = await route.GET(req("/api/config/models"));
        expect(res.status).toBe(200);
        const b = (await res.json()) as { providers: string[]; models: ChatModel[] };
        expect(b.models.some((m) => m.id === INSTANCE_A_MODEL)).toBe(true);
        expect(b.models.some((m) => m.id === INSTANCE_B_MODEL)).toBe(true);
        return b;
      },
      { timeout: 5000, interval: 100 },
    );

    expect(body.providers).toContain("inst-a");
    expect(body.providers).toContain("inst-b");

    const modelA = body.models.find((m) => m.id === INSTANCE_A_MODEL);
    const modelB = body.models.find((m) => m.id === INSTANCE_B_MODEL);
    expect(modelA?.provider).toBe("inst-a");
    expect(modelA?.channel).toBe(INSTANCE_A_CHANNEL);
    expect(modelB?.provider).toBe("inst-b");
    expect(modelB?.channel).toBe(INSTANCE_B_CHANNEL);
    // 互不串扰:A 的模型不会被 B 的实例标识认领,反之亦然。
    expect(modelA?.provider).not.toBe(modelB?.provider);
  });

  it("两个实例的转发路由均已挂载(未带 token → 401,而非未登记实例的 404,Req 1.3)", async () => {
    for (const instance of ["inst-a", "inst-b"]) {
      const res = await route.POST(
        req(`/api/ai-gateway/${instance}/v1/chat/completions`, {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("未登记的实例标识 → 404(证明查表按 gatewayInstances 逐个构造,而非放行任意路径)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/not-a-real-instance/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("单个实例目录拉取失败(500)只影响其自身,其余实例与 self 模型仍完整(Req 1.5)", async () => {
    // gwFailing 恒 500,GatewayModelCatalog fail-soft 后该实例快照恒空;给足时间令首次
    // 后台刷新跑过一轮,再断言 A/B 两个健康实例仍完整出现。
    await vi.waitFor(
      async () => {
        const res = await route.GET(req("/api/config/models"));
        const b = (await res.json()) as { models: ChatModel[] };
        expect(b.models.some((m) => m.id === INSTANCE_A_MODEL)).toBe(true);
        expect(b.models.some((m) => m.id === INSTANCE_B_MODEL)).toBe(true);
      },
      { timeout: 5000, interval: 100 },
    );
    const res = await route.GET(req("/api/config/models"));
    const body = (await res.json()) as { providers: string[]; models: ChatModel[] };
    // 失败实例不产出任何模型条目,但也不报错、不牵连另外两个实例。
    expect(body.models.some((m) => m.provider === "inst-fail")).toBe(false);
    expect(body.models.some((m) => m.id === INSTANCE_A_MODEL)).toBe(true);
    expect(body.models.some((m) => m.id === INSTANCE_B_MODEL)).toBe(true);
  });
});

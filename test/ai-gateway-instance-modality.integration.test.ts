/**
 * Integration: 网关实例声明的模态真正作用于其目录条目(spec multi-gateway-providers
 * 任务 4.5,Req 2.4/2.5/3.3)。
 *
 * 第六批完整性批评 gap 4 的遗留:任务 3.1 已解析逐实例的 `PI_WEB_GATEWAY_<ID>_INPUT` /
 * `_OUTPUT`,但 4.2 给全部网关条目写死 `GATEWAY_DEFAULT_MODALITY = ["text"]` ——
 * 配了 `_INPUT=text,image` 也没有任何可观察效果。本文件断言接线后声明确实生效:
 *
 * - `inst-vision`(声明 `_INPUT=text,image` `_OUTPUT=text`)的模型出现在
 *   `GET /api/config/models?input=image&output=text` 的结果里;
 * - `inst-plain`(未声明,保持缺省 `["text"]`/`["text"]`)的模型**不**出现在同一查询里
 *   ——「撤掉声明即消失」的等价对照(同进程内 handler 单例已按当前 env 装配一次,
 *   不能事后改 env 复验同一进程;改用「声明 vs 不声明」两个并存实例做 A/B 对照,
 *   与 `ai-gateway-multi-instance.integration.test.ts` 的既有验证形态一致);
 * - 两个实例的模型在不带 `input` 筛选的查询里(`?output=text`)都存在,证明 `inst-plain`
 *   的模型确实进了目录,只是被 `input=image` 筛掉,而不是因为别的原因(如白名单)缺席。
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

const VISION_MODEL = "vision-mesh-model";
const VISION_CHANNEL = "channel-vision";
const PLAIN_MODEL = "plain-mesh-model";
const PLAIN_CHANNEL = "channel-plain";

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

const gwVision = makeCatalogServer(VISION_MODEL, VISION_CHANNEL);
const gwPlain = makeCatalogServer(PLAIN_MODEL, PLAIN_CHANNEL);

await new Promise<void>((resolve) => gwVision.listen(0, "127.0.0.1", resolve));
await new Promise<void>((resolve) => gwPlain.listen(0, "127.0.0.1", resolve));
const visionPort = (gwVision.address() as AddressInfo).port;
const plainPort = (gwPlain.address() as AddressInfo).port;

process.env.PI_WEB_GATEWAYS = "inst-vision,inst-plain";
process.env.PI_WEB_GATEWAY_INST_VISION_BASE_URL = `http://127.0.0.1:${visionPort}`;
process.env.PI_WEB_GATEWAY_INST_VISION_ALLOWLIST = VISION_CHANNEL;
process.env.PI_WEB_GATEWAY_INST_VISION_API_KEY = "inst-vision-key";
// ★ 本任务(4.5)的接线对象:实例级模态声明。
process.env.PI_WEB_GATEWAY_INST_VISION_INPUT = "text,image";
process.env.PI_WEB_GATEWAY_INST_VISION_OUTPUT = "text";
process.env.PI_WEB_GATEWAY_INST_PLAIN_BASE_URL = `http://127.0.0.1:${plainPort}`;
process.env.PI_WEB_GATEWAY_INST_PLAIN_ALLOWLIST = PLAIN_CHANNEL;
process.env.PI_WEB_GATEWAY_INST_PLAIN_API_KEY = "inst-plain-key";
// inst-plain 刻意不设 _INPUT/_OUTPUT:未声明模态的实例须保持现有缺省(零配置行为不变)。
process.env.PI_WEB_AI_GATEWAY_SECRET = "test-instance-modality-secret-abcdef0123456789";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string): Request {
  return new Request(`http://localhost${pathname}`);
}

afterAll(async () => {
  await shutdownHandler();
  await Promise.all(
    [gwVision, gwPlain].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

interface ChatModel {
  readonly provider: string;
  readonly id: string;
  readonly input?: readonly string[];
  readonly output?: readonly string[];
}

describe("网关实例声明的模态作用于目录条目(spec multi-gateway-providers 任务 4.5,Req 2.4/2.5/3.3)", () => {
  it("两个实例的模型先在无 input 筛选的查询里都存在(证明均已进入目录,不受白名单等其他因素影响)", async () => {
    const body = await vi.waitFor(
      async () => {
        const res = await route.GET(req("/api/config/models?output=text"));
        expect(res.status).toBe(200);
        const b = (await res.json()) as { models: ChatModel[] };
        expect(b.models.some((m) => m.id === VISION_MODEL)).toBe(true);
        expect(b.models.some((m) => m.id === PLAIN_MODEL)).toBe(true);
        return b;
      },
      { timeout: 5000, interval: 100 },
    );
    // 目录服务当前唯一入口是 GET /api/config/models(未带筛选参数时不调用 query(),
    // 见 pi-handler.ts;此处显式带 output=text 走 query() 路径)。
    expect(body.models.find((m) => m.id === VISION_MODEL)?.provider).toBe("inst-vision");
    expect(body.models.find((m) => m.id === PLAIN_MODEL)?.provider).toBe("inst-plain");
  });

  it("声明 input=text,image 的实例:其模型出现在 GET /api/config/models?input=image&output=text 里", async () => {
    const res = await route.GET(req("/api/config/models?input=image&output=text"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: ChatModel[] };
    const model = body.models.find((m) => m.id === VISION_MODEL);
    expect(model).toBeDefined();
    expect(model?.input).toContain("image");
    expect(model?.output).toContain("text");
  });

  it("未声明模态的实例(缺省 input=[\"text\"]):其模型不出现在 ?input=image&output=text 里(撤掉声明即消失的等价对照)", async () => {
    const res = await route.GET(req("/api/config/models?input=image&output=text"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: ChatModel[] };
    expect(body.models.some((m) => m.id === PLAIN_MODEL)).toBe(false);
  });
});

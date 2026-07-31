/**
 * Integration: pi-handler 路由注册段的 ai-gateway 挂载 —— 关闭态(spec
 * ai-gateway-providers,design.md §2.5,任务 4.1,Req 1.2)。
 *
 * 未配置 `AI_GATEWAY_BASE_URL`(套件未启用)时,`createAiGatewayRoutes` 不得被注册:
 * `/api/ai-gateway/*` 落既有 404 语义,且**不因缺套件配置影响其余装配**——尤其要断言
 * `resolveAiGatewaySecret` 未启用时不会被无条件调用(它在两个 secret env 皆缺时会抛错;
 * 若装配段无条件求值,未配置套件的部署会在此处直接崩溃)。本文件全程不设置
 * `PI_WEB_AI_GATEWAY_SECRET`/`PI_WEB_ATTACHMENT_SECRET`,若装配崩溃则该断言必然通过
 * 失败的方式暴露(import 阶段抛错、afterAll 前测试全部不执行)。
 *
 * 开启态(路由已挂载)由姊妹文件 `ai-gateway-route-mount.integration.test.ts` 覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
// 静态目录单一事实源(零 env 读取、零 pi SDK,import 顺序无害):未启用形态下
// GET /api/config/models?output=image 必须与它逐字节一致(model-catalog spec 任务 3.1;
// 独立的 GET /api/aigc/models 已随 multi-gateway-providers 任务 4.3 删除,Req 3.2)。
import { AIGC_MODEL_CATALOG } from "@blksails/pi-web-tool-kit";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
// 显式确保未启用套件:不设置 AI_GATEWAY_BASE_URL,也不设置任一 secret env(验证装配
// 不会因未启用套件而无条件触达 resolveAiGatewaySecret)。
delete process.env.AI_GATEWAY_BASE_URL;
delete process.env.PI_WEB_AI_GATEWAY_SECRET;
delete process.env.PI_WEB_ATTACHMENT_SECRET;
// 目录断言的确定性:不让宿主环境的 hidden 配置渗入(model-catalog spec 任务 3.1)。
delete process.env.PI_WEB_HIDE_PROVIDERS;

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

describe("AI_GATEWAY_BASE_URL 未配置:/api/ai-gateway/* 未挂载", () => {
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

  it("/api/ai-gateway/ai-gateway/v1/chat/completions → 404(路由未注册,非网关内部 404;Req 1.3 新路径形态)", async () => {
    const res = await route.POST(
      req("/api/ai-gateway/ai-gateway/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("GET 亦 404", async () => {
    const res = await route.GET(req("/api/ai-gateway/ai-gateway/v1/models"));
    expect(res.status).toBe(404);
  });

  it("其余装配未受影响:会话创建正常工作", () => {
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("其余装配未受影响:GET /api/config/models 正常工作且模型条目不带 source/channel/availability 字段(与主干逐字节一致,Req 1.2/6.3)", async () => {
    const res = await route.GET(req("/api/config/models"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<Record<string, unknown>> };
    expect(Array.isArray(body.models)).toBe(true);
    for (const m of body.models) {
      expect(m.source).toBeUndefined();
      expect(m.channel).toBeUndefined();
      expect(m.availability).toBeUndefined();
    }
  });

  it("GET /api/aigc/models 已删除(★ 已承认的破坏性变更,multi-gateway-providers 任务 4.3,Req 3.2):独立端点不再注册,能力改由 GET /api/config/models?output=image 覆盖", async () => {
    const res = await route.GET(req("/api/aigc/models"));
    expect(res.status).not.toBe(200);
  });

  it("GET /api/config/models?output=image 与旧 GET /aigc/models 的静态目录输出等价(Req 3.2,任务 4.2 的 input/output 字段随目录条目一并出现)", async () => {
    const res = await route.GET(req("/api/config/models?output=image"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ id: string; name: string; provider: string; input: string[]; output: string[] }>;
    };
    expect(body.models.length).toBe(AIGC_MODEL_CATALOG.length);
    const byId = new Map(body.models.map((m) => [m.id, m]));
    for (const old of AIGC_MODEL_CATALOG) {
      const found = byId.get(old.model);
      expect(found, `缺少旧目录条目 ${old.model}`).toBeDefined();
      expect(found!.name).toBe(old.label);
      expect(found!.provider).toBe(old.provider);
      // 非空断言(multi-gateway-providers 任务 4.2 完成判据:三类来源的条目均有
      // 非空的输入与输出类型)。
      expect(found!.input.length).toBeGreaterThan(0);
      expect(found!.output).toContain("image");
    }
  });
});

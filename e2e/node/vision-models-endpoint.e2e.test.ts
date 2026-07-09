/**
 * Node 级 e2e — GET /api/vision/models(spec canvas-vision-readout,Req 3.1/3.6)。
 *
 * 经 `lib/app/api-route` 驱动真实单例 `createPiWebHandler`，与宿主
 * (`server/index.ts` 的 `app.all("/api/*")`)走同一条路，免去起 HTTP 服务。
 *
 * 断言：端点可达、只返回支持图像输入的模型、`value` 形如 `provider/id`、不泄漏凭据。
 *
 * ⚠ 历史注记：本测试原先直接 `import("@/app/api/vision/[[...path]]/route")`，
 * 用以守护「新顶层 API 段漏建 Next catch-all 转发器 → 静默 404」这个坑。
 * 随 spec `vite-spa-migration` 删除 Next（`app/api/**` 下 11 个转发器整体消失，
 * 改由 Hono 的一条 `app.all("/api/*")` 转发），**该坑已不复存在**，
 * 故此处不再声称守护它。
 */
import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// 隔离 agentDir:一个视觉模型 + 一个纯文本模型,凭据只在 models.json。
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-endpoint-"));
fs.writeFileSync(
  path.join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      e2eprov: {
        name: "E2E",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "sk-e2e",
        api: "openai-completions",
        models: [
          {
            id: "sees-images",
            name: "Sees Images",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          {
            id: "text-only",
            name: "Text Only",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  }),
);
fs.writeFileSync(path.join(agentDir, "auth.json"), "{}\n");
process.env.PI_CODING_AGENT_DIR = agentDir;

// 框架无关的 `/api/*` 方法级入口（与宿主共享同一单例 handler）。
const api = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
  fs.rmSync(agentDir, { recursive: true, force: true });
});

interface Body {
  models: Array<{ value: string; label: string; provider: string }>;
}

const get = (): Promise<Response> =>
  api.GET(new Request("http://localhost/api/vision/models"));

describe("GET /api/vision/models(经真实 handler)", () => {
  it("端点可达,返回 200", async () => {
    const res = await get();
    expect(res.status).toBe(200);
  });

  it("只返回支持图像输入的模型,value 形如 provider/id(3.1)", async () => {
    const body = (await (await get()).json()) as Body;

    expect(Array.isArray(body.models)).toBe(true);
    const values = body.models.map((m) => m.value);
    expect(values).toContain("e2eprov/sees-images");
    expect(values).not.toContain("e2eprov/text-only");

    for (const m of body.models) {
      expect(m.value.startsWith(`${m.provider}/`)).toBe(true);
    }
  });

  it("返回体不泄漏凭据 / baseUrl", async () => {
    const raw = JSON.stringify(await (await get()).json());

    expect(raw).not.toContain("sk-e2e");
    expect(raw).not.toContain("baseUrl");
  });
});

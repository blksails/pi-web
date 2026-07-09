/**
 * Node 级 e2e — GET /api/vision/models(spec canvas-vision-readout,Req 3.1/3.6)。
 *
 * ★ 本测试的首要价值是**验证 Next catch-all 转发器存在**:
 *   它直接 `import("@/app/api/vision/[[...path]]/route")`。若该文件缺失,import 就失败;
 *   若存在但未导出 GET,调用就失败。新顶层 API 段漏建转发器会导致 `/api/vision/*` **静默 404**
 *   —— 这是本 spec 最易漏的一项(见 `app/api/aigc/[[...path]]/route.ts` 的同款警告)。
 *
 * 其次验证端点经真实单例 handler 可达,且在隔离 agentDir 下返回预期形状。
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

// ★ 直接 import 转发器文件 —— 缺失则本行即失败。
const vision = await import("@/app/api/vision/[[...path]]/route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
  fs.rmSync(agentDir, { recursive: true, force: true });
});

interface Body {
  models: Array<{ value: string; label: string; provider: string }>;
}

describe("GET /api/vision/models(经真实 handler + Next 转发器)", () => {
  it("★ 转发器存在且导出 GET —— 端点可达,返回 200(缺转发器则静默 404)", async () => {
    expect(typeof vision.GET).toBe("function");

    const res = await vision.GET(new Request("http://localhost/api/vision/models"));
    expect(res.status).toBe(200);
  });

  it("只返回支持图像输入的模型,value 形如 provider/id(3.1)", async () => {
    const res = await vision.GET(new Request("http://localhost/api/vision/models"));
    const body = (await res.json()) as Body;

    expect(Array.isArray(body.models)).toBe(true);
    const values = body.models.map((m) => m.value);
    expect(values).toContain("e2eprov/sees-images");
    expect(values).not.toContain("e2eprov/text-only");

    for (const m of body.models) {
      expect(m.value.startsWith(`${m.provider}/`)).toBe(true);
    }
  });

  it("返回体不泄漏凭据 / baseUrl", async () => {
    const res = await vision.GET(new Request("http://localhost/api/vision/models"));
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain("sk-e2e");
    expect(raw).not.toContain("baseUrl");
  });
});

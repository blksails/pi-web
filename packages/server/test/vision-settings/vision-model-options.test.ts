/**
 * 单元:listVisionModelOptions —— 枚举「已配置凭证且支持图像输入」的模型(Req 3.1)。
 *
 * 用真实 pi SDK 的 ModelRegistry 读一个临时 agentDir(models.json + auth.json),
 * 断言 `input` 过滤与 `provider/id` 取值格式。
 *
 * 关键回归锁:过滤必须与 tool-kit `select-model.ts` 的 `listVisionModels` 同源
 * (`getAvailable()` ∩ `input` 含 `"image"`),否则下拉里的模型工具选不到。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVisionModelOptions } from "../../src/vision-settings/vision-model-options.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 造一个临时 agentDir:一个视觉模型 + 一个纯文本模型,凭据均在 models.json。 */
function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vision-opts-"));
  dirs.push(dir);
  const models = {
    providers: {
      testprov: {
        name: "Test",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "sk-secret-should-not-leak",
        api: "openai-completions",
        models: [
          {
            id: "vlm-one",
            name: "VLM One",
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
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

describe("listVisionModelOptions", () => {
  it("只保留支持图像输入的模型,过滤掉纯文本模型(3.1)", () => {
    const { models } = listVisionModelOptions(makeAgentDir());
    const values = models.map((m) => m.value);

    expect(values).toContain("testprov/vlm-one");
    expect(values).not.toContain("testprov/text-only");
  });

  it("value 形如 provider/modelId —— 与工具 model 参数格式一致", () => {
    const { models } = listVisionModelOptions(makeAgentDir());
    const hit = models.find((m) => m.value === "testprov/vlm-one");

    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("testprov");
    expect(hit?.label).toBe("VLM One");
  });

  it("结果只含 value/label/provider 三个字段,不泄漏 apiKey / baseUrl", () => {
    const { models } = listVisionModelOptions(makeAgentDir());
    const hit = models.find((m) => m.value === "testprov/vlm-one");

    expect(Object.keys(hit ?? {}).sort()).toEqual(["label", "provider", "value"]);
    expect(JSON.stringify(models)).not.toContain("sk-secret-should-not-leak");
    expect(JSON.stringify(models)).not.toContain("baseUrl");
  });
});

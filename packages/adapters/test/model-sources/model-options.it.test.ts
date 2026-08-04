/**
 * 单元:listModelOptions —— 本地模型来源携带非空的输入/输出类型信息
 * (spec multi-gateway-providers 任务 4.2,design.md「输入/输出取值域」表
 * 「pi SDK Model(对话)」行;Req 2.4, 4.1, 4.3)。
 *
 * ★边界补充:4.2 的目标文件列表未列出本文件(现有 `packages/adapters/test/
 * model-sources` 目录此前只有 `vision-model-options.it.test.ts`,没有直接覆盖
 * `listModelOptions` 的测试文件)——但 4.2 要求本地模型来源的条目均补齐非空的
 * `input`/`output`,而 `service.test.ts` 用手写 fixture(`SELF_CHAT`)测试
 * `ModelCatalogService` 的组装逻辑,并不途经真实的 `listModelOptions`,故无法
 * 证明本文件(`model-options.ts`)的改动确实生效。真正的证据只能来自本文件:
 * 用真实 pi SDK 的 `ModelRegistry` 读一个临时 agentDir,断言 `input`/`output`
 * 均非空。命名为 `.it.test.ts`(而非 `.test.ts`)是因为本文件值导入 pi SDK,
 * 跨包分档守卫会把值导入 pi SDK 的测试判为 it 档(见 tasks.md Implementation
 * Notes 第一批的分档守卫踩坑记录)。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listModelOptions } from "../../src/model-sources/model-options.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 造一个临时 agentDir:两个自定义 provider 模型,凭据均在 models.json。 */
function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "model-opts-"));
  dirs.push(dir);
  const models = {
    providers: {
      testprov: {
        name: "Test",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "sk-secret",
        api: "openai-completions",
        models: [
          {
            id: "text-only",
            name: "Text Only",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          {
            id: "vision-model",
            name: "Vision Model",
            reasoning: false,
            input: ["text", "image"],
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

describe("listModelOptions — 本地模型条目均携带非空的 input/output(spec multi-gateway-providers 任务 4.2)", () => {
  it("每个模型条目均带非空 input(直接映射自 pi SDK Model.input,Req 4.1)", () => {
    const { models } = listModelOptions(makeAgentDir());
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.input?.length ?? 0, `${m.provider}/${m.id} 的 input 为空`).toBeGreaterThan(0);
    }
  });

  it("每个模型条目均带非空 output(pi SDK Model 无 output 声明,按对话缺省补齐 ['text'],Req 4.3)", () => {
    const { models } = listModelOptions(makeAgentDir());
    for (const m of models) {
      expect(m.output?.length ?? 0, `${m.provider}/${m.id} 的 output 为空`).toBeGreaterThan(0);
      expect(m.output).toEqual(["text"]);
    }
  });

  it("input 如实反映模型声明(纯文本模型不含 image,视觉模型含 image)", () => {
    const { models } = listModelOptions(makeAgentDir());
    const textOnly = models.find((m) => m.id === "text-only");
    const vision = models.find((m) => m.id === "vision-model");
    expect(textOnly?.input).toEqual(["text"]);
    expect(vision?.input).toEqual(["text", "image"]);
  });
});

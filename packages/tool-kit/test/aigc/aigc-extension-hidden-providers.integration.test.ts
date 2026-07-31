/**
 * aigcExtension 隐藏 provider 名单集成测试(multi-gateway-providers spec 任务 4.4,
 * design.md「core / ModelCatalogService(重构)」/「隐藏名单彻底禁用」;Req 5.1–5.4)。
 *
 * 隐藏名单语义统一为**彻底禁用**:`PI_WEB_HIDE_PROVIDERS` 命中的 provider,其模型
 * 不但要从部署级目录(`ModelCatalogService`,已在 `packages/server/test/model-catalog/
 * service.test.ts` 覆盖)消失,工具侧派生的可用模型同样不得包含 —— 使用者不应能通过
 * 工具选用一个"设置里已隐藏"的模型。
 *
 * 覆盖:
 * 1. 隐藏某 provider 后,其模型从两工具的 LLM 枚举 / 描述、以及下发清单
 *    `aigc.models`/`modelLabels`/`modelProviders` 三处均消失,其余 provider 的模型保留。
 * 2. 与既有的用户级 `disabledModels`(`aigc.json`)是**并集**关系,互不覆盖。
 * 3. 未配置隐藏名单时行为与今天逐字节一致(零侵入)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aigcExtension } from "../../src/aigc/extension.js";
import { SESSION_STATE_SEAM_KEY } from "../../src/session-state.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Collected {
  name: string;
  description: string;
  parameters: unknown;
}

function installStateSeam(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY] = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    delete: (k: string) => store.delete(k),
    snapshot: () => Object.fromEntries(store),
  };
  return store;
}

function runExtension(): { tools: Collected[]; state: Map<string, unknown> } {
  const tools: Collected[] = [];
  const pi = {
    registerTool: (def: Collected) => tools.push(def),
    registerCommand: () => {},
  } as unknown as ExtensionAPI;
  const state = installStateSeam();
  aigcExtension(pi);
  return { tools, state };
}

let dir: string;
let prevAgentDir: string | undefined;
let prevHideProviders: string | undefined;

beforeEach(async () => {
  dir = join(tmpdir(), `aigc-ext-hidden-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  prevAgentDir = process.env.PI_WEB_AGENT_DIR;
  process.env.PI_WEB_AGENT_DIR = dir;
  prevHideProviders = process.env.PI_WEB_HIDE_PROVIDERS;
});

afterEach(async () => {
  if (prevAgentDir === undefined) delete process.env.PI_WEB_AGENT_DIR;
  else process.env.PI_WEB_AGENT_DIR = prevAgentDir;
  if (prevHideProviders === undefined) delete process.env.PI_WEB_HIDE_PROVIDERS;
  else process.env.PI_WEB_HIDE_PROVIDERS = prevHideProviders;
  delete (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY];
  await fs.rm(dir, { recursive: true, force: true });
});

// openrouter 在本地静态目录(model-catalog.ts)下有 6 条模型;这里只断言其中一条即可。
const OPENROUTER_MODEL = "gemini-3.1-flash-image";
const NEWAPI_MODEL = "gpt-image-2";
const DASHSCOPE_MODEL = "wan2.7-image-pro";

describe("aigcExtension — 隐藏 provider 名单彻底禁用工具侧模型(任务 4.4,Req 5.2)", () => {
  it("PI_WEB_HIDE_PROVIDERS=openrouter → openrouter 模型从 LLM 枚举与下发清单三处均消失,其余 provider 保留", () => {
    process.env.PI_WEB_HIDE_PROVIDERS = "openrouter";

    const { tools, state } = runExtension();

    const gen = tools.find((t) => t.name === "image_generation");
    expect(gen).toBeDefined();
    expect(gen?.description).not.toContain(`\`${OPENROUTER_MODEL}\``);
    expect(JSON.stringify(gen?.parameters)).not.toContain(`"${OPENROUTER_MODEL}"`);
    // 未隐藏的 provider 仍在枚举里。
    expect(gen?.description).toContain(NEWAPI_MODEL);

    const models = state.get("aigc.models") as string[];
    const labels = state.get("aigc.modelLabels") as Record<string, string>;
    const providers = state.get("aigc.modelProviders") as Record<string, string>;
    expect(models).not.toContain(OPENROUTER_MODEL);
    expect(Object.keys(labels)).not.toContain(OPENROUTER_MODEL);
    expect(Object.keys(providers)).not.toContain(OPENROUTER_MODEL);
    // 未隐藏 provider 的模型悉数保留。
    expect(models).toContain(NEWAPI_MODEL);
    expect(models).toContain(DASHSCOPE_MODEL);
    expect(Object.values(providers)).not.toContain("openrouter");
  });

  it("隐藏名单与用户自设 disabledModels(aigc.json)是并集,互不覆盖", async () => {
    process.env.PI_WEB_HIDE_PROVIDERS = "openrouter";
    await fs.writeFile(
      join(dir, "aigc.json"),
      JSON.stringify({ disabledModels: [DASHSCOPE_MODEL], enablePromptOptimization: false }),
      "utf8",
    );

    const { state } = runExtension();
    const models = state.get("aigc.models") as string[];
    // 两者均缺席:一个来自隐藏名单,一个来自用户自设禁用。
    expect(models).not.toContain(OPENROUTER_MODEL);
    expect(models).not.toContain(DASHSCOPE_MODEL);
    // 既未被隐藏、也未被用户禁用的模型仍保留。
    expect(models).toContain(NEWAPI_MODEL);
  });

  it("未配置 PI_WEB_HIDE_PROVIDERS 时行为与今天逐字节一致(零侵入)", () => {
    delete process.env.PI_WEB_HIDE_PROVIDERS;

    const { tools, state } = runExtension();
    const gen = tools.find((t) => t.name === "image_generation");
    expect(gen?.description).toContain(OPENROUTER_MODEL);
    const models = state.get("aigc.models") as string[];
    expect(models).toContain(OPENROUTER_MODEL);
    expect(models).toContain(NEWAPI_MODEL);
    expect(models).toContain(DASHSCOPE_MODEL);
  });
});

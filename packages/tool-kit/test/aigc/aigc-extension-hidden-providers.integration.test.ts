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
import {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  CLOUDFLARE_AIGC_CATALOG,
} from "../../src/aigc/model-catalog.js";

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

// ── 键空间一致性(第七批完整性批评 gap 1)────────────────────────────────────────
// 不变式:工具侧 hiddenModelIds() 用来比对 PI_WEB_HIDE_PROVIDERS 的 provider 键空间,
// 必须与目录端点 query() 投影出去的键空间**同源**。曾经一个比归一后、一个比归一前,
// 同一份名单在两处给出相反结果:隐藏 A 时「界面看不见但工具照常能跑」,隐藏 B 时反过来。
// 归一表现已清空(源头改对),但机制保留 —— 本组用例即是表再加映射时的闸门。
describe("★ 隐藏名单的键空间须与目录端点一致", () => {
  /** 网关 compat 通路的一条图像模型(2026-08-03 起归属 cloudflare)。 */
  const GW_COMPAT_MODEL = "gpt-image-1";
  let prevGatewayBase: string | undefined;

  beforeEach(() => {
    prevGatewayBase = process.env.BLKSAILS_GATEWAY_BASE_URL;
    // 启用网关 compat 路由组,否则其三条图像模型根本不进可用集,断言无从判别。
    process.env.BLKSAILS_GATEWAY_BASE_URL = "http://127.0.0.1:9/gw";
  });
  afterEach(() => {
    if (prevGatewayBase === undefined) delete process.env.BLKSAILS_GATEWAY_BASE_URL;
    else process.env.BLKSAILS_GATEWAY_BASE_URL = prevGatewayBase;
  });

  it("基线:不隐藏时,网关 compat 通路的图像模型在工具侧可用", () => {
    delete process.env.PI_WEB_HIDE_PROVIDERS;
    const { state } = runExtension();
    expect(state.get("aigc.models") as string[]).toContain(GW_COMPAT_MODEL);
  });

  it("隐藏 cloudflare → compat 与原生两组图像模型**一并**禁用(同 provider 即同命运)", () => {
    process.env.PI_WEB_HIDE_PROVIDERS = "cloudflare";
    const { state, tools } = runExtension();
    const models = state.get("aigc.models") as string[];
    expect(models).not.toContain(GW_COMPAT_MODEL);
    // 原生 Cloudflare 组同属 cloudflare,同样缺席。
    for (const m of CLOUDFLARE_AIGC_CATALOG) expect(models).not.toContain(m.model);
    const gen = tools.find((t) => t.name === "image_generation");
    expect(JSON.stringify(gen?.parameters)).not.toContain(`"${GW_COMPAT_MODEL}"`);
  });

  it("★ 工具侧过滤所用的键 = 静态目录条目声明的 provider(逐 provider 全覆盖,不遗漏任一组)", () => {
    // 遍历三张静态目录里出现的每个 provider:隐藏它,则它名下条目全部消失、其余条目不受影响。
    // 这条比「隐藏某个具体名字」更强:任何一组的 provider 键与过滤键脱节都会立刻报红。
    const all = [...AIGC_MODEL_CATALOG, ...AI_GATEWAY_AIGC_CATALOG, ...CLOUDFLARE_AIGC_CATALOG];
    delete process.env.PI_WEB_HIDE_PROVIDERS;
    const baseline = new Set(runExtension().state.get("aigc.models") as string[]);
    expect(baseline.size).toBeGreaterThan(0);

    for (const provider of new Set(all.map((e) => e.provider))) {
      process.env.PI_WEB_HIDE_PROVIDERS = provider;
      const after = new Set(runExtension().state.get("aigc.models") as string[]);
      const ownIds = all.filter((e) => e.provider === provider).map((e) => e.model);
      for (const id of ownIds) {
        expect(after.has(id), `隐藏 ${provider} 后 ${id} 仍在`).toBe(false);
      }
      for (const id of baseline) {
        if (ownIds.includes(id)) continue;
        expect(after.has(id), `隐藏 ${provider} 误伤了 ${id}`).toBe(true);
      }
    }
  });
});

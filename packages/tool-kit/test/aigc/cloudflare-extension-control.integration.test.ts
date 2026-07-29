/**
 * Cloudflare 图像路由组条件并入 — 对照组 vs 启用组集成测试
 * (spec cloudflare-aigc-provider,任务 4.2,Req 4.3/5.2/5.5/7.1)。
 *
 * 对照组:三个 `CLOUDFLARE_*` env 未齐备时,`aigcExtension` 注册的工具枚举 / 下发清单
 * **不含**任何 Cloudflare 条目,且既有 provider 的模型枚举与「本特性引入前」逐字节一致
 * ——这里的「逐字节一致」以完整快照比对实证,而非仅断言 CF 不在(Req 5.5/7.1)。
 *
 * 启用组:三 env 齐备后 `gpt-image-2-cf` 出现在两工具的 LLM 枚举与下发清单中,且与既有
 * provider 条目取并集而非替换。
 *
 * ★ 缺一不可:三个 env 只配两个时**不得**启用(Req 5.2 —— 缺配就不提供该模型,而不是
 * 让用户选中后在调用时才失败)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { aigcExtension } from "../../src/aigc/extension.js";
import { CLOUDFLARE_AIGC_CATALOG } from "../../src/aigc/model-catalog.js";
import { SESSION_STATE_SEAM_KEY } from "../../src/session-state.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Collected {
  name: string;
  description: string;
  parameters: unknown;
}

const CF_ENV = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AIG_GATEWAY_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

const CF_VALUES: Record<string, string> = {
  CLOUDFLARE_ACCOUNT_ID: "acct-test",
  CLOUDFLARE_AIG_GATEWAY_ID: "gw-test",
  CLOUDFLARE_API_TOKEN: "tok-test",
};

/**
 * 从目录派生而非硬编码 —— 任务 5.4 会随真机探针结果增删 CF 模型,硬编码会让本套件
 * 每次都要手工跟改(且漏改时「剔除 CF 后应逐项不变」那条会假红)。
 */
const CF_MODELS = CLOUDFLARE_AIGC_CATALOG.map((e) => e.model);
/** 既有 provider 的代表性模型,用于「不回归」断言。 */
const BASELINE_MODELS = ["gpt-image-2", "gpt-image-2-sufy", "wan2.7-image-pro"];

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

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of CF_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // 网关 env 一并清:避免其启用状态混入本用例的枚举快照。
  saved.BLKSAILS_GATEWAY_BASE_URL = process.env.BLKSAILS_GATEWAY_BASE_URL;
  saved.AI_GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL;
  delete process.env.BLKSAILS_GATEWAY_BASE_URL;
  delete process.env.AI_GATEWAY_BASE_URL;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY];
});

describe("对照组:CLOUDFLARE_* 未配置", () => {
  it("下发清单不含任何 Cloudflare 条目,基线模型悉数保留", () => {
    const { tools, state } = runExtension();
    const models = state.get("aigc.models") as string[];
    for (const m of CF_MODELS) expect(models).not.toContain(m);
    for (const m of BASELINE_MODELS) expect(models).toContain(m);

    const gen = tools.find((t) => t.name === "image_generation");
    expect(JSON.stringify(gen?.parameters)).not.toContain("gpt-image-2-cf");
    expect(gen?.description).not.toContain("Cloudflare");
  });

  it("★ 既有 provider 的模型枚举逐项不变(完整快照比对,非仅断言 CF 不在)", () => {
    const { state: stateOff } = runExtension();
    const modelsOff = [...(stateOff.get("aigc.models") as string[])];

    // 启用 CF 后,把 CF 条目剔除,剩余部分必须与未启用时**完全相同**(顺序也一致)。
    for (const k of CF_ENV) process.env[k] = CF_VALUES[k] as string;
    const { state: stateOn } = runExtension();
    const modelsOnWithoutCf = (stateOn.get("aigc.models") as string[]).filter(
      (m) => !CF_MODELS.includes(m),
    );

    expect(modelsOnWithoutCf).toEqual(modelsOff);
  });

  it("★ 三个 env 缺任意一个都不启用(Req 5.2:缺配不提供,而非调用时才失败)", () => {
    for (const missing of CF_ENV) {
      for (const k of CF_ENV) process.env[k] = CF_VALUES[k] as string;
      delete process.env[missing];

      const { state } = runExtension();
      const models = state.get("aigc.models") as string[];
      expect(models, `缺 ${missing} 时不应启用 Cloudflare`).not.toContain("gpt-image-2-cf");
    }
  });

  it("★ env 存在但为空串/空白同样不启用", () => {
    for (const k of CF_ENV) process.env[k] = CF_VALUES[k] as string;
    process.env.CLOUDFLARE_API_TOKEN = "   ";

    const { state } = runExtension();
    expect(state.get("aigc.models") as string[]).not.toContain("gpt-image-2-cf");
  });
});

describe("启用组:CLOUDFLARE_* 三项齐备", () => {
  beforeEach(() => {
    for (const k of CF_ENV) process.env[k] = CF_VALUES[k] as string;
  });

  it("下发清单与两工具枚举含 Cloudflare 条目,且与既有 provider 取并集", () => {
    const { tools, state } = runExtension();
    const models = state.get("aigc.models") as string[];
    for (const m of CF_MODELS) expect(models).toContain(m);
    for (const m of BASELINE_MODELS) expect(models).toContain(m);

    const providers = state.get("aigc.modelProviders") as Record<string, string>;
    expect(providers["gpt-image-2-cf"]).toBe("cloudflare");

    const gen = tools.find((t) => t.name === "image_generation");
    expect(JSON.stringify(gen?.parameters)).toContain("gpt-image-2-cf");
    const edit = tools.find((t) => t.name === "image_edit");
    expect(JSON.stringify(edit?.parameters)).toContain("gpt-image-2-cf");
  });

  it("★ 与 BlackSail 自建网关是两条独立通路:CF 启用不会带出 ai-gateway 条目", () => {
    const { state } = runExtension();
    const models = state.get("aigc.models") as string[];
    expect(models).toContain("gpt-image-2-cf");
    // BLKSAILS_GATEWAY_BASE_URL 未配 → 自建网关条目不应出现。
    expect(models).not.toContain("gpt-image-2-ai-gateway");
    expect(models).not.toContain("gpt-image-1");
  });

  it("两套 provider 同时启用时取并集,互不排斥", () => {
    process.env.BLKSAILS_GATEWAY_BASE_URL = "http://127.0.0.1:8080";
    const { state } = runExtension();
    const models = state.get("aigc.models") as string[];
    expect(models).toContain("gpt-image-2-cf");
    expect(models).toContain("gpt-image-2-ai-gateway");
    for (const m of BASELINE_MODELS) expect(models).toContain(m);
  });
});

describe("disabledModels 对 Cloudflare 模型同样生效(Req 4.3)", () => {
  // disabledModels 的真实来源是 `<agentDir>/aigc.json`(非 env),故此处真写一份配置文件
  // 并经 PI_WEB_AGENT_DIR 指向它,让链路完整跑通 —— 而不是伪造一个设置对象。
  let tmpDir: string;

  beforeEach(() => {
    for (const k of CF_ENV) process.env[k] = CF_VALUES[k] as string;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-aigc-"));
    saved.PI_WEB_AGENT_DIR = process.env.PI_WEB_AGENT_DIR;
    process.env.PI_WEB_AGENT_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("被禁的 CF 模型从工具枚举与下发清单中同源移除", () => {
    fs.writeFileSync(
      path.join(tmpDir, "aigc.json"),
      JSON.stringify({ disabledModels: ["gpt-image-2-cf"] }),
    );

    const { tools, state } = runExtension();
    const models = state.get("aigc.models") as string[];
    expect(models).not.toContain("gpt-image-2-cf");

    const gen = tools.find((t) => t.name === "image_generation");
    expect(JSON.stringify(gen?.parameters)).not.toContain("gpt-image-2-cf");
    // 未被禁的既有模型不受影响(同源移除只针对被禁项)。
    expect(models).toContain("gpt-image-2");
  });

  it("未禁时 CF 模型正常出现(与上一条构成对照,证明是 disabledModels 起的作用)", () => {
    fs.writeFileSync(path.join(tmpDir, "aigc.json"), JSON.stringify({ disabledModels: [] }));

    const { state } = runExtension();
    expect(state.get("aigc.models") as string[]).toContain("gpt-image-2-cf");
  });
});

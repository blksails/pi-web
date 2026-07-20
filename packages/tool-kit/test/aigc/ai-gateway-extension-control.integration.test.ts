/**
 * ai-gateway 图像路由组条件并入 — 对照组 vs 启用组集成测试(spec ai-gateway-providers,
 * design.md §3/§6,任务 6.1,Req 1.2/5.3)。
 *
 * 对照组:未配置 `AI_GATEWAY_BASE_URL` 时,`aigcExtension` 注册的工具枚举 / 下发清单
 * **不含**任何 ai-gateway 条目,且与主干基线(newapi/sufy/openrouter/dashscope 现有模型)
 * 逐一致——防回归(Req 1.2/5.3:图像工具的模型枚举与行为与今天一致)。
 *
 * 启用组:配置 `AI_GATEWAY_BASE_URL` 后,ai-gateway 条目(`gpt-image-1`/
 * `gpt-image-2-ai-gateway`/`qwen-image`)出现在两工具的 LLM 枚举与下发清单中,且不影响
 * 既有 provider 条目(并集,而非替换)。
 */
import { describe, it, expect, afterEach } from "vitest";
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

const AI_GATEWAY_MODELS = ["gpt-image-1", "gpt-image-2-ai-gateway", "qwen-image"];
const BASELINE_MODELS = ["gpt-image-2", "gpt-image-2-sufy", "wan2.7-image-pro"];

let prevBaseUrl: string | undefined;

afterEach(() => {
  if (prevBaseUrl === undefined) delete process.env.AI_GATEWAY_BASE_URL;
  else process.env.AI_GATEWAY_BASE_URL = prevBaseUrl;
  // ★新名也必须清:runtime 层的旧→新归一化会**写入** BLKSAILS_GATEWAY_BASE_URL,
  // 只清旧名会把启用状态泄漏给后续用例(对照组假绿)。
  delete process.env.BLKSAILS_GATEWAY_BASE_URL;
  delete (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY];
});

describe("对照组:网关 base URL 未配置", () => {
  it("下发清单 aigc.models 不含任何 ai-gateway 条目,基线模型悉数保留(Req 1.2/5.3)", () => {
    prevBaseUrl = process.env.AI_GATEWAY_BASE_URL;
    delete process.env.AI_GATEWAY_BASE_URL;
    delete process.env.BLKSAILS_GATEWAY_BASE_URL;

    const { tools, state } = runExtension();
    const models = state.get("aigc.models") as string[];
    for (const m of AI_GATEWAY_MODELS) {
      expect(models).not.toContain(m);
    }
    for (const m of BASELINE_MODELS) {
      expect(models).toContain(m);
    }

    const gen = tools.find((t) => t.name === "image_generation");
    expect(gen?.description).not.toContain("ai-gateway");
    expect(JSON.stringify(gen?.parameters)).not.toContain("gpt-image-1");
  });
});

describe("启用组:网关 base URL 已配置", () => {
  // 旧名 AI_GATEWAY_BASE_URL 经 runtime 层归一化搬到新名后仍启用(存量部署兼容),
  // 这条用例同时是兼容层的活证据;新名直配见下一条。
  it("下发清单与工具枚举含 ai-gateway 条目,且与既有 provider 条目并集(不替换)", () => {
    prevBaseUrl = process.env.AI_GATEWAY_BASE_URL;
    process.env.AI_GATEWAY_BASE_URL = "http://127.0.0.1:8080";

    const { tools, state } = runExtension();
    const models = state.get("aigc.models") as string[];
    for (const m of AI_GATEWAY_MODELS) {
      expect(models).toContain(m);
    }
    for (const m of BASELINE_MODELS) {
      expect(models).toContain(m);
    }

    const providers = state.get("aigc.modelProviders") as Record<string, string>;
    expect(providers["gpt-image-1"]).toBe("ai-gateway");

    const gen = tools.find((t) => t.name === "image_generation");
    expect(JSON.stringify(gen?.parameters)).toContain("gpt-image-1");
    const edit = tools.find((t) => t.name === "image_edit");
    expect(JSON.stringify(edit?.parameters)).toContain("qwen-image");
  });

  it("新名 BLKSAILS_GATEWAY_BASE_URL 直配即启用(不依赖旧名)", () => {
    prevBaseUrl = process.env.AI_GATEWAY_BASE_URL;
    delete process.env.AI_GATEWAY_BASE_URL;
    process.env.BLKSAILS_GATEWAY_BASE_URL = "http://127.0.0.1:8080";

    const { state } = runExtension();
    const models = state.get("aigc.models") as string[];
    for (const m of AI_GATEWAY_MODELS) {
      expect(models).toContain(m);
    }
  });

  it("旧名归一化到新名:配旧名后新名可被占位符解析到同值", () => {
    prevBaseUrl = process.env.AI_GATEWAY_BASE_URL;
    delete process.env.BLKSAILS_GATEWAY_BASE_URL;
    process.env.AI_GATEWAY_BASE_URL = "http://gw.example:9090";

    runExtension();
    expect(process.env.BLKSAILS_GATEWAY_BASE_URL).toBe("http://gw.example:9090");
  });
});

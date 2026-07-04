/**
 * aigcExtension 装配期读持久设置→过滤 集成测试(aigc-tool-settings task 3.1 / Req 2.1/2.2/2.3/3.1/7.1)。
 *
 * 经 PI_WEB_AGENT_DIR 指向含 `aigc.json`(禁用某模型 + 开优化)的临时目录 + 安装 state seam,
 * 调用 aigcExtension:断言注册工具的 model 枚举/描述,以及下发的 aigc.models/modelLabels/modelProviders
 * **四处均不含**被禁模型、且含其余模型。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aigcExtension } from "../../src/aigc/extension.js";
import { SESSION_STATE_SEAM_KEY } from "../../src/session-state.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DISABLED = "gpt-image-2";
let dir: string;
let prevAgentDir: string | undefined;

interface Collected {
  name: string;
  description: string;
  parameters: unknown;
}

/** 安装捕获式 state seam,返回捕获的 set 记录 map。 */
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

beforeEach(async () => {
  dir = join(tmpdir(), `aigc-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, "aigc.json"),
    JSON.stringify({ disabledModels: [DISABLED], enablePromptOptimization: true }),
    "utf8",
  );
  prevAgentDir = process.env.PI_WEB_AGENT_DIR;
  process.env.PI_WEB_AGENT_DIR = dir;
});

afterEach(async () => {
  if (prevAgentDir === undefined) delete process.env.PI_WEB_AGENT_DIR;
  else process.env.PI_WEB_AGENT_DIR = prevAgentDir;
  delete (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY];
  await fs.rm(dir, { recursive: true, force: true });
});

describe("aigcExtension 装配期模型过滤", () => {
  it("被禁模型从 LLM 枚举、aigc.models/labels/providers 四处均移除,其余保留", () => {
    const { tools, state } = runExtension();

    const gen = tools.find((t) => t.name === "image_generation");
    expect(gen).toBeDefined();
    // ① LLM 枚举/描述不含被禁模型
    expect(gen?.description).not.toContain(`\`${DISABLED}\``);
    expect(JSON.stringify(gen?.parameters)).not.toContain(`"${DISABLED}"`);
    // 其余模型仍在
    expect(gen?.description).toContain("wan2.7-image-pro");

    // ② 下发清单三处均不含被禁模型
    const models = state.get("aigc.models") as string[];
    const labels = state.get("aigc.modelLabels") as Record<string, string>;
    const providers = state.get("aigc.modelProviders") as Record<string, string>;
    expect(models).not.toContain(DISABLED);
    expect(Object.keys(labels)).not.toContain(DISABLED);
    expect(Object.keys(providers)).not.toContain(DISABLED);
    // 其余模型仍下发
    expect(models).toContain("wan2.7-image-pro");

    // ③ 提示词优化开关(持久值)publish 到会话状态,供 run-image-tool 读取
    expect(state.get("aigc.enablePromptOptimization")).toBe(true);
  });
});

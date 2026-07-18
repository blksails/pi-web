/**
 * model-config 单元测试(aigc-tool-settings task 1.1)。
 *
 * 覆盖:resolveAigcToolSettings 的 fail-soft(缺文件/坏 JSON/字段非法 → 空集,Req 1.5/1.6)、
 * filterRoutes 纯过滤(剔除子集/未禁顺序与标签不变/全禁保留默认/未知 id 忽略,Req 2.5/2.6/1.6)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAigcToolSettings,
  filterRoutes,
  AIGC_TOOL_SETTINGS_FILE,
} from "../../src/aigc/model-config.js";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `aigc-mc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeSettings(body: string): Promise<void> {
  await fs.writeFile(join(dir, AIGC_TOOL_SETTINGS_FILE), body, "utf8");
}

const ROUTES = [
  { model: "a", label: "A" },
  { model: "b", label: "B" },
  { model: "c", label: "C" },
] as const;

describe("resolveAigcToolSettings", () => {
  it("缺文件 → 空集(fail-soft)", () => {
    expect(resolveAigcToolSettings(dir).disabledModels.size).toBe(0);
  });

  it("坏 JSON → 空集(不抛)", async () => {
    await writeSettings("{ not json");
    expect(resolveAigcToolSettings(dir).disabledModels.size).toBe(0);
  });

  it("disabledModels 非数组 → 空集", async () => {
    await writeSettings(JSON.stringify({ disabledModels: "x" }));
    expect(resolveAigcToolSettings(dir).disabledModels.size).toBe(0);
  });

  it("合法 → 对应集合(丢非字符串/空串)", async () => {
    await writeSettings(JSON.stringify({ disabledModels: ["b", "", 3, "c"] }));
    const s = resolveAigcToolSettings(dir).disabledModels;
    expect([...s].sort()).toEqual(["b", "c"]);
  });

  it("enablePromptOptimization:true→true,缺省/非布尔→false", async () => {
    await writeSettings(JSON.stringify({ enablePromptOptimization: true }));
    expect(resolveAigcToolSettings(dir).enablePromptOptimization).toBe(true);
    await writeSettings(JSON.stringify({ disabledModels: ["a"] }));
    expect(resolveAigcToolSettings(dir).enablePromptOptimization).toBe(false);
    await writeSettings(JSON.stringify({ enablePromptOptimization: "yes" }));
    expect(resolveAigcToolSettings(dir).enablePromptOptimization).toBe(false);
  });

  it("缺文件 → 优化默认 false", () => {
    expect(resolveAigcToolSettings(dir).enablePromptOptimization).toBe(false);
  });
});

describe("filterRoutes", () => {
  it("空集 → 原样返回(同引用)", () => {
    expect(filterRoutes(ROUTES, new Set(), "a")).toBe(ROUTES);
  });

  it("剔除被禁子集,未禁顺序与对象不变(Req 2.6)", () => {
    const out = filterRoutes(ROUTES, new Set(["b"]), "a");
    expect(out.map((r) => r.model)).toEqual(["a", "c"]);
    expect(out[0]).toBe(ROUTES[0]); // 未重排、未复制对象
  });

  it("全禁 → 保留默认模型对应 route(Req 2.5)", () => {
    const out = filterRoutes(ROUTES, new Set(["a", "b", "c"]), "b");
    expect(out.map((r) => r.model)).toEqual(["b"]);
  });

  it("全禁且默认不在列表 → 退回首项(仍非空)", () => {
    const out = filterRoutes(ROUTES, new Set(["a", "b", "c"]), "zzz");
    expect(out).toHaveLength(1);
    expect(out[0]?.model).toBe("a");
  });

  it("未知模型 id 不命中任何 route → 自然忽略(Req 1.6)", () => {
    const out = filterRoutes(ROUTES, new Set(["ghost"]), "a");
    expect(out.map((r) => r.model)).toEqual(["a", "b", "c"]);
  });

  it("disabledModels 对内置路由 ∪ ai-gateway extraRoutes 拼接后统一生效,不区分来源(Req 5.4)", () => {
    const aiGatewayRoutes = [
      { model: "gpt-image-1", label: "GPT Image 1 · ai-gateway" },
      { model: "qwen-image", label: "Qwen Image · ai-gateway" },
    ] as const;
    const combined = [...ROUTES, ...aiGatewayRoutes];
    // 同时禁用一个内置模型与一个 ai-gateway 模型:两者均应被剔除,其余(含另一 ai-gateway
    // 模型)保留——证明过滤对拼接后的路由集统一生效,不因来源(newapi/sufy/dashscope 还是
    // ai-gateway)而有差异对待。
    const out = filterRoutes(combined, new Set(["b", "gpt-image-1"]), "a");
    expect(out.map((r) => r.model)).toEqual(["a", "c", "qwen-image"]);
  });
});

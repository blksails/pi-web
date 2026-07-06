/**
 * registerPluginBundles 单测(task 1.3,Req 2.1/2.3/2.4/3.1/3.2/3.4;裁定 B)。
 *
 * 覆盖(design「canvas-kit · layers-plugin.ts(核心契约)」CanvasPluginBundle/
 * registerPluginBundles + 「裁定书 B」):
 * - 命名空间前缀化:namespace 存在时 tools/layers/actions 的 id/type 施加 <ns>: 前缀;
 *   浅拷贝不 mutate 作者只读入参;requires 依赖名不前缀化(全局名);无 namespace 原样;
 * - 拓扑校验:requires 齐备(内置 op kind / 同捆 / 他捆 layer)→ 全部正常注册无禁用;
 *   缺失 → 捆内 tools 仍进 registry.tools 但列入 disabledPluginTools、actions 不注册、
 *   diagnostics 追加 kind:"plugin"(toolId=捆前缀化 id,error 含缺失项);
 * - 命名空间隔离:不同 ns 下同名 tool/layer 各自前缀化互不冲突;
 * - 聚合退订:注销本次注册的全部 tools/layers/actions;退订幂等。
 */
import { describe, it, expect } from "vitest";
import { createCanvasRegistry } from "../src/index.js";
import {
  defineCanvasLayer,
  registerPluginBundles,
  type CanvasLayerPlugin,
  type CanvasPluginBundle,
} from "../src/layers-plugin.js";
import { defineCanvasTool, type CanvasTool } from "../src/registry.js";
import { defineCanvasAction, type CanvasActionPlugin } from "../src/actions.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const makeLayer = (type: string): CanvasLayerPlugin =>
  defineCanvasLayer({ type, Render: () => null, bake: () => {} });

const makeTool = (id: string): CanvasTool => defineCanvasTool({ id, label: id, icon: null });

const makeAction = (id: string): CanvasActionPlugin =>
  defineCanvasAction({
    id,
    label: id,
    match: () => 1,
    buildArgs: () => ({}),
    execution: { via: "prompt", buildOp: () => ({}) },
  });

// ── 命名空间前缀化(2.1)──────────────────────────────────────────────────────

describe("registerPluginBundles 命名空间前缀化", () => {
  it("namespace 存在:tools/layers/actions 的 id/type 都带 <ns>: 前缀", () => {
    const r = createCanvasRegistry();
    const bundle: CanvasPluginBundle = {
      id: "stickers",
      requires: ["acme:sticker"],
      tools: [makeTool("sticker-tool")],
      layers: [makeLayer("sticker")],
      actions: [makeAction("style")],
    };
    registerPluginBundles(r, [bundle], { namespace: "acme" });
    expect(r.tools.map((t) => t.id)).toEqual(["acme:sticker-tool"]);
    expect(r.layers.map((l) => l.type)).toEqual(["acme:sticker"]);
    expect(r.actions.map((a) => a.id)).toEqual(["acme:style"]);
  });

  it("入参插件对象未被 mutate(浅拷贝前缀化;作者只读声明)", () => {
    const tool = makeTool("sticker-tool");
    const layer = makeLayer("sticker");
    const action = makeAction("style");
    const bundle: CanvasPluginBundle = {
      id: "stickers",
      tools: [tool],
      layers: [layer],
      actions: [action],
    };
    registerPluginBundles(createCanvasRegistry(), [bundle], { namespace: "acme" });
    expect(tool.id).toBe("sticker-tool"); // 原对象 id 未被改
    expect(layer.type).toBe("sticker");
    expect(action.id).toBe("style");
  });

  it("无 namespace:id/type 原样不前缀", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(r, [
      { id: "b", tools: [makeTool("t")], layers: [makeLayer("l")], actions: [makeAction("a")] },
    ]);
    expect(r.tools.map((t) => t.id)).toEqual(["t"]);
    expect(r.layers.map((l) => l.type)).toEqual(["l"]);
    expect(r.actions.map((a) => a.id)).toEqual(["a"]);
  });
});

// ── 拓扑校验:齐备(3.4)───────────────────────────────────────────────────────

describe("registerPluginBundles 拓扑校验 · 依赖齐备", () => {
  it("requires 命中内置 op kind:全部正常注册无禁用无诊断", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(r, [
      { id: "b", requires: ["stroke"], tools: [makeTool("t")], actions: [makeAction("a")] },
    ]);
    expect(r.tools.map((t) => t.id)).toEqual(["t"]);
    expect(r.actions.map((a) => a.id)).toEqual(["a"]);
    expect(r.disabledPluginTools.size).toBe(0);
    expect(r.diagnostics).toHaveLength(0);
  });

  it("requires 由同捆 layer 满足(前缀化后名)", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(
      r,
      [
        {
          id: "b",
          requires: ["acme:sticker"],
          tools: [makeTool("t")],
          layers: [makeLayer("sticker")],
        },
      ],
      { namespace: "acme" },
    );
    expect(r.disabledPluginTools.size).toBe(0);
    expect(r.layers.map((l) => l.type)).toEqual(["acme:sticker"]);
    expect(r.tools.map((t) => t.id)).toEqual(["acme:t"]);
  });

  it("requires 由他捆 layer 满足(先注册全部捆 layers 再逐捆校验)", () => {
    const r = createCanvasRegistry();
    const consumer: CanvasPluginBundle = {
      id: "app",
      requires: ["base"],
      tools: [makeTool("t")],
    };
    const provider: CanvasPluginBundle = { id: "lib", layers: [makeLayer("base")] };
    // consumer 在前 provider 在后:layers 先全注册,故 consumer.requires 仍满足。
    registerPluginBundles(r, [consumer, provider]);
    expect(r.disabledPluginTools.size).toBe(0);
    expect(r.tools.map((t) => t.id)).toEqual(["t"]);
    expect(r.layers.map((l) => l.type)).toEqual(["base"]);
  });
});

// ── 拓扑校验:缺失(3.1/3.2,裁定 B)────────────────────────────────────────────

describe("registerPluginBundles 拓扑校验 · 依赖缺失", () => {
  it("缺依赖:tools 仍进工具轨+列入禁用集;actions 不注册;diagnostics kind:plugin 含缺失项", () => {
    const r = createCanvasRegistry();
    const bundle: CanvasPluginBundle = {
      id: "stickers",
      requires: ["acme:missing-layer"],
      tools: [makeTool("sticker-tool")],
      actions: [makeAction("style")],
    };
    registerPluginBundles(r, [bundle], { namespace: "acme" });

    // 裁定 B:工具仍注册进轨(置灰而非消失)。
    expect(r.tools.map((t) => t.id)).toEqual(["acme:sticker-tool"]);
    expect(r.disabledPluginTools.has("acme:sticker-tool")).toBe(true);
    // 动作不参与决策(不注册)。
    expect(r.actions).toHaveLength(0);
    // 诊断:kind:"plugin",toolId=捆前缀化 id,error 含缺失项。
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.kind).toBe("plugin");
    expect(d.toolId).toBe("acme:stickers");
    expect(d.error).toContain("acme:missing-layer");
  });

  it("多缺失项全部进 error;多工具全部列入禁用集", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(r, [
      {
        id: "b",
        requires: ["x", "y"],
        tools: [makeTool("t1"), makeTool("t2")],
      },
    ]);
    expect(r.disabledPluginTools.has("t1")).toBe(true);
    expect(r.disabledPluginTools.has("t2")).toBe(true);
    const d = r.diagnostics[0]!;
    expect(d.error).toContain("x");
    expect(d.error).toContain("y");
  });
});

// ── 命名空间隔离(2.1)──────────────────────────────────────────────────────────

describe("registerPluginBundles 命名空间隔离", () => {
  it("不同 ns 下同名 tool/layer 各自前缀化互不冲突", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(
      r,
      [{ id: "b", tools: [makeTool("dup")], layers: [makeLayer("dupL")] }],
      { namespace: "ns1" },
    );
    registerPluginBundles(
      r,
      [{ id: "b", tools: [makeTool("dup")], layers: [makeLayer("dupL")] }],
      { namespace: "ns2" },
    );
    expect(r.tools.map((t) => t.id)).toEqual(["ns1:dup", "ns2:dup"]);
    expect(r.layers.map((l) => l.type)).toEqual(["ns1:dupL", "ns2:dupL"]);
    expect(r.diagnostics).toHaveLength(0); // 不同 ns 无冲突
  });

  it("同 ns 下同 id 重复:后注册被底层 registerX 拒绝并记诊断(冲突语义复用)", () => {
    const r = createCanvasRegistry();
    registerPluginBundles(r, [{ id: "b1", tools: [makeTool("dup")] }], { namespace: "ns" });
    registerPluginBundles(r, [{ id: "b2", tools: [makeTool("dup")] }], { namespace: "ns" });
    expect(r.tools.map((t) => t.id)).toEqual(["ns:dup"]); // 先注册者保持
    expect(r.diagnostics.some((d) => d.kind === "tool" || d.error.includes("ns:dup"))).toBe(true);
  });
});

// ── 聚合退订(2.3)──────────────────────────────────────────────────────────────

describe("registerPluginBundles 聚合退订", () => {
  it("退订注销本次注册的全部 tools/layers/actions", () => {
    const r = createCanvasRegistry();
    const off = registerPluginBundles(
      r,
      [
        {
          id: "b",
          requires: ["stroke"],
          tools: [makeTool("t")],
          layers: [makeLayer("l")],
          actions: [makeAction("a")],
        },
      ],
      { namespace: "ns" },
    );
    expect(r.tools).toHaveLength(1);
    expect(r.layers).toHaveLength(1);
    expect(r.actions).toHaveLength(1);
    off();
    expect(r.tools).toHaveLength(0);
    expect(r.layers).toHaveLength(0);
    expect(r.actions).toHaveLength(0);
  });

  it("退订幂等(重复调用安全)", () => {
    const r = createCanvasRegistry();
    const off = registerPluginBundles(r, [{ id: "b", tools: [makeTool("t")] }]);
    off();
    off(); // 幂等:第二次不抛不再动别人
    expect(r.tools).toHaveLength(0);
  });
});

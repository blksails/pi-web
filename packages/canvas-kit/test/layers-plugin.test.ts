/**
 * layers-plugin + registry 图层/禁用面 单测(task 1.1,Req 1.1/1.5/2.2/2.3;裁定 B)。
 *
 * 覆盖(design「canvas-kit · layers-plugin.ts(核心契约)」+「裁定书 B」):
 * - defineCanvasLayer 恒等(defineCanvasTool/defineCanvasAction 先例);
 * - registerLayer 冲突拒绝(同 type 后注册者被拒 + diagnostics kind:"layer",先注册者
 *   保持;被拒注册退订为 no-op)——与 M1/M2 registerTool/registerAction 同构;
 * - 退订幂等 / 注册序稳定 / per-instance 隔离(layers 与 disabledPluginTools 互不串扰);
 * - disabledPluginTools 初始为空 + 内部登记 API registerDisabledPluginTool 生效
 *   (裁定 B 禁用集登记面;1.3 拓扑校验填充)。
 */
import { describe, it, expect } from "vitest";
import { defineCanvasLayer, type CanvasLayerPlugin } from "../src/layers-plugin.js";
import { createCanvasRegistry, createCanvasKernel } from "../src/index.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const makeLayer = (type: string, extra: Partial<CanvasLayerPlugin> = {}): CanvasLayerPlugin =>
  defineCanvasLayer({
    type,
    Render: () => null,
    bake: () => {},
    ...extra,
  });

// ── defineCanvasLayer 恒等(6.1 先例)──────────────────────────────────────────

describe("defineCanvasLayer", () => {
  it("恒等:原样返回同一对象引用", () => {
    const layer = makeLayer("sticker");
    expect(defineCanvasLayer(layer)).toBe(layer);
  });

  it("契约形状:type/Render/bake 必填,Inspector 可选", () => {
    const Inspector: CanvasLayerPlugin["Inspector"] = () => null;
    const layer = makeLayer("sticker", { Inspector });
    expect([typeof layer.type, typeof layer.Render, typeof layer.bake, typeof layer.Inspector]).toEqual([
      "string",
      "function",
      "function",
      "function",
    ]);
  });
});

// ── registerLayer(注册序 / 枚举 / 退订)────────────────────────────────────────

describe("createCanvasRegistry.registerLayer", () => {
  it("注册序稳定枚举(1.1 图层驱动源)", () => {
    const r = createCanvasRegistry();
    r.registerLayer(makeLayer("a"));
    r.registerLayer(makeLayer("b"));
    r.registerLayer(makeLayer("c"));
    expect(r.layers.map((l) => l.type)).toEqual(["a", "b", "c"]);
  });

  it("退订移除对应图层;幂等(重复退订安全)", () => {
    const r = createCanvasRegistry();
    r.registerLayer(makeLayer("a"));
    const off = r.registerLayer(makeLayer("b"));
    expect(r.layers.map((l) => l.type)).toEqual(["a", "b"]);
    off();
    expect(r.layers.map((l) => l.type)).toEqual(["a"]);
    off(); // 幂等:第二次退订不再动别人
    expect(r.layers.map((l) => l.type)).toEqual(["a"]);
  });
});

// ── 同 type 冲突拒绝 + diagnostics kind:"layer"(2.2/2.3,Error Handling「注册冲突」)─

describe("createCanvasRegistry.registerLayer 冲突语义", () => {
  it("同 type 后注册者被拒:先注册者保持 + diagnostics(toolId=type/kind:layer)", () => {
    const r = createCanvasRegistry();
    const first = makeLayer("sticker", { bake: () => {} });
    const second = makeLayer("sticker", { bake: () => {} });
    r.registerLayer(first);
    r.registerLayer(second);
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]).toBe(first); // 先注册者保持,不被顶替
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.toolId).toBe("sticker");
    expect(d.kind).toBe("layer");
    expect(d.error).toContain("sticker");
  });

  it("被拒注册返回的退订为 no-op(不误删先注册者)", () => {
    const r = createCanvasRegistry();
    const first = makeLayer("sticker");
    r.registerLayer(first);
    const offRejected = r.registerLayer(makeLayer("sticker"));
    offRejected(); // no-op:不得删掉先注册者
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]).toBe(first);
  });

  it("工具面与图层面各自独立 id 空间(同名跨面不构成冲突)", () => {
    const r = createCanvasRegistry();
    r.registerTool({ id: "sticker", label: "sticker", icon: null });
    r.registerLayer(makeLayer("sticker"));
    expect(r.tools).toHaveLength(1);
    expect(r.layers).toHaveLength(1);
    expect(r.diagnostics).toHaveLength(0); // 跨面同名不冲突
  });
});

// ── disabledPluginTools 登记面(裁定 B;1.3 拓扑校验填充)──────────────────────

describe("createCanvasRegistry.disabledPluginTools", () => {
  it("初始为空集", () => {
    const r = createCanvasRegistry();
    expect(r.disabledPluginTools.size).toBe(0);
  });

  it("registerDisabledPluginTool 登记后 disabledPluginTools 含该工具 id", () => {
    const r = createCanvasRegistry();
    r.registerDisabledPluginTool("acme:sticker-tool", "missing dependency \"acme:sticker\"");
    expect(r.disabledPluginTools.has("acme:sticker-tool")).toBe(true);
    expect(r.disabledPluginTools.size).toBe(1);
  });

  it("重复登记同一 id 幂等(集合仍单元素)", () => {
    const r = createCanvasRegistry();
    r.registerDisabledPluginTool("acme:t", "r1");
    r.registerDisabledPluginTool("acme:t", "r2");
    expect(r.disabledPluginTools.size).toBe(1);
    expect(r.disabledPluginTools.has("acme:t")).toBe(true);
  });
});

// ── per-instance 隔离(2.3;实例间图层/禁用集互不串扰)──────────────────────────

describe("createCanvasRegistry per-instance 隔离(图层/禁用面)", () => {
  it("实例间 layers 互不串扰", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerLayer(makeLayer("a-only"));
    expect(a.layers).toHaveLength(1);
    expect(b.layers).toHaveLength(0);
  });

  it("实例间 disabledPluginTools 互不串扰", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerDisabledPluginTool("a:t", "r");
    expect(a.disabledPluginTools.size).toBe(1);
    expect(b.disabledPluginTools.size).toBe(0);
  });
});

// ── disabledPluginToolReason 只读查询(task 3.1 消费;裁定 B tooltip 显缺失项)──────
// 禁用集(1.1)只出 ReadonlySet,原因存私有 disabledReasons Map 无读面。canvas-ui 装配层
// (工具轨 tooltip 经 resolveToolRailTitle 显缺失项)需按 toolId 取回原因串;而 1.3 拓扑校验
// 的诊断条目 toolId=**捆前缀化 id** 非工具 id、kind:"plugin",故 resolveToolRailTitle 按工具 id
// 匹配 diagnostics 取不到 —— 补此纯只读 getter 作原因读面(接口既有骨架的语义补全,零诊断改动,
// 既有 287 测试零影响)。
describe("createCanvasRegistry.disabledPluginToolReason", () => {
  it("登记后按 toolId 取回原因串", () => {
    const r = createCanvasRegistry();
    r.registerDisabledPluginTool("acme:sticker-tool", "缺少依赖: acme:sticker");
    expect(r.disabledPluginToolReason("acme:sticker-tool")).toBe("缺少依赖: acme:sticker");
  });

  it("未登记的 toolId → undefined", () => {
    const r = createCanvasRegistry();
    expect(r.disabledPluginToolReason("nobody")).toBeUndefined();
  });

  it("重复登记以最新原因为准(与集合幂等并存)", () => {
    const r = createCanvasRegistry();
    r.registerDisabledPluginTool("acme:t", "r1");
    r.registerDisabledPluginTool("acme:t", "r2");
    expect(r.disabledPluginToolReason("acme:t")).toBe("r2");
  });
});

// ── kernel-facade 直通(1.2/M2 先例;门面透传新成员)──────────────────────────

describe("createCanvasKernel registry 直通图层/禁用面", () => {
  it("经门面 registerLayer/registerDisabledPluginTool 可达且读面一致", () => {
    const k = createCanvasKernel({ getRect: () => null, getNaturalSize: () => null });
    k.registry.registerLayer(makeLayer("x"));
    k.registry.registerDisabledPluginTool("x:tool", "missing x");
    expect(k.registry.layers.map((l) => l.type)).toEqual(["x"]);
    expect(k.registry.disabledPluginTools.has("x:tool")).toBe(true);
  });

  it("门面 disabledPluginToolReason 直通读回原因(task 3.1 tooltip 读面)", () => {
    const k = createCanvasKernel({ getRect: () => null, getNaturalSize: () => null });
    k.registry.registerDisabledPluginTool("x:tool", "缺少依赖: x:layer");
    expect(k.registry.disabledPluginToolReason("x:tool")).toBe("缺少依赖: x:layer");
  });
});

/**
 * registry + defineCanvasTool + CanvasToolContext(L2)单测(task 2.6,
 * Req 6.1/6.5/3.3)。
 *
 * 覆盖(design「defineCanvasTool / CanvasRegistry」+ Error Handling「注册冲突」):
 * - per-instance 隔离(6.5):registry 实例间 tools/diagnostics 互不串扰;
 * - 注册冲突拒绝(Error Handling):同 id 后注册者被拒 + 记 diagnostics,先注册者
 *   保持;被拒注册返回的退订函数为 no-op(不得误删先注册者);
 * - Context 能力面形状(6.1/3.3):经 CanvasTool→RuntimeTool 适配层接真 ToolRuntime,
 *   工具回调收 ToolGestureEvent(natural 已换算/命中描述符/无 capture 接缝泄漏)与
 *   CanvasToolContext(draft/history.commit/stage.panBy/layers 读面/prefs/defer);
 * - capture 声明化:capturePointer 缺省 true(down 首行设 capture,:1109 语义),
 *   text 特例 false 不捕获(:1142);
 * - 共享 diagnostics 收集器:registry 冲突条目与 runtime 错误边界条目汇于一处
 *   (2.5 留账:registry.diagnostics 直读收集器 entries)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  defineCanvasTool,
  createCanvasRegistry,
  createToolAdapter,
  createPrefsStore,
  type CanvasTool,
  type CanvasToolContext,
  type ToolGestureEvent,
} from "../src/registry.js";
import type { CanvasOp, MaskStroke } from "../src/index.js";
import {
  createToolRuntime,
  createDiagnosticsCollector,
  type ToolPointerEvent,
  type ToolRuntimeEnv,
  type LayersReadApi,
} from "../src/kernel/tool-runtime.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const makeTool = (id: string, extra: Partial<CanvasTool> = {}): CanvasTool =>
  defineCanvasTool({ id, label: id, icon: null, ...extra });

const emptyLayers: LayersReadApi = { layers: [], selectedId: null, get: () => undefined };

const makeRuntimeEnv = (over: Partial<ToolRuntimeEnv> = {}): ToolRuntimeEnv & {
  committed: CanvasOp[];
  pans: Array<[number, number]>;
} => {
  const committed: CanvasOp[] = [];
  const pans: Array<[number, number]> = [];
  return {
    committed,
    pans,
    history: { commit: (op) => committed.push(op) },
    stage: { panBy: (dx, dy) => pans.push([dx, dy]) },
    layers: emptyLayers,
    ...over,
  };
};

/** ToolPointerEvent 构造(2.4 路由载荷形状;capture 缺省 spy)。 */
const pev = (
  phase: ToolPointerEvent["phase"],
  over: Partial<ToolPointerEvent> = {},
): ToolPointerEvent => ({
  phase,
  hit: { kind: "overlay" },
  pointerId: 1,
  client: { x: 100, y: 60 },
  natural: { x: 50, y: 30 },
  deltaClient: { dx: 0, dy: 0 },
  deltaNatural: { dx: 0, dy: 0 },
  expandDelta: null,
  capture: () => {},
  ...over,
});

// ── per-instance 隔离(6.5)────────────────────────────────────────────────────

describe("createCanvasRegistry per-instance 隔离", () => {
  it("实例间 tools 互不串扰", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerTool(makeTool("builtin:draw"));
    expect(a.tools.map((t) => t.id)).toEqual(["builtin:draw"]);
    expect(b.tools).toEqual([]);
  });

  it("实例间 diagnostics 互不串扰(A 的冲突不见于 B)", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerTool(makeTool("builtin:draw"));
    a.registerTool(makeTool("builtin:draw")); // 冲突 → A 记 1 条
    expect(a.diagnostics).toHaveLength(1);
    expect(b.diagnostics).toHaveLength(0);
  });
});

// ── 注册与冲突拒绝(Error Handling「注册冲突」)───────────────────────────────

describe("registerTool 注册与冲突拒绝", () => {
  it("tools 按注册序稳定枚举", () => {
    const r = createCanvasRegistry();
    r.registerTool(makeTool("builtin:move"));
    r.registerTool(makeTool("builtin:draw"));
    r.registerTool(makeTool("ext:foo"));
    expect(r.tools.map((t) => t.id)).toEqual(["builtin:move", "builtin:draw", "ext:foo"]);
  });

  it("同 id 后注册者被拒:先注册者保持 + diagnostics 记录(toolId/error/at)", () => {
    const r = createCanvasRegistry();
    const first = makeTool("builtin:draw", { label: "first" });
    const second = makeTool("builtin:draw", { label: "second" });
    r.registerTool(first);
    r.registerTool(second);
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toBe(first); // 先注册者保持(不覆盖)
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.toolId).toBe("builtin:draw");
    expect(d.error).toContain("builtin:draw");
    expect(typeof d.at).toBe("number");
  });

  it("被拒注册返回的退订函数是 no-op(不误删先注册者)", () => {
    const r = createCanvasRegistry();
    const first = makeTool("builtin:draw");
    r.registerTool(first);
    const disposeRejected = r.registerTool(makeTool("builtin:draw"));
    disposeRejected();
    expect(r.tools).toEqual([first]);
  });

  it("退订移除该工具且幂等;移除后同 id 可再注册", () => {
    const r = createCanvasRegistry();
    const dispose = r.registerTool(makeTool("builtin:draw"));
    r.registerTool(makeTool("builtin:mask"));
    dispose();
    dispose(); // 幂等
    expect(r.tools.map((t) => t.id)).toEqual(["builtin:mask"]);
    r.registerTool(makeTool("builtin:draw"));
    expect(r.tools.map((t) => t.id)).toEqual(["builtin:mask", "builtin:draw"]);
    expect(r.diagnostics).toHaveLength(0); // 全程无冲突
  });

  it("共享收集器注入:registry 冲突条目落进共享 entries(2.5 留账直读语义)", () => {
    const collector = createDiagnosticsCollector();
    const r = createCanvasRegistry({ diagnostics: collector });
    r.registerTool(makeTool("builtin:draw"));
    r.registerTool(makeTool("builtin:draw"));
    expect(collector.entries).toHaveLength(1);
    expect(r.diagnostics).toBe(collector.entries); // 直读同一列表引用
  });
});

// ── defineCanvasTool ─────────────────────────────────────────────────────────

describe("defineCanvasTool", () => {
  it("恒等返回(纯类型收窄,web-kit defineXxx 先例)", () => {
    const decl: CanvasTool<MaskStroke> = {
      id: "builtin:mask",
      label: "mask",
      icon: null,
      onMove: (ev, ctx) => {
        // TDraft 泛型收窄:draft 读面为 MaskStroke | null(编译期守护)
        const d: MaskStroke | null = ctx.draft.get();
        if (d !== null && ev.natural !== null) {
          ctx.draft.set({ ...d, points: [...d.points, ev.natural] });
        }
      },
    };
    expect(defineCanvasTool(decl)).toBe(decl);
  });
});

// ── Context 能力面 + ToolGestureEvent(经适配层接真 ToolRuntime,6.1/3.3)──────

describe("CanvasTool→RuntimeTool 适配层 + CanvasToolContext 能力面", () => {
  it("适配缓存:同 tool 恒得同 RuntimeTool 引用(setActiveTool 幂等前提)", () => {
    const adapt = createToolAdapter({ getNaturalSize: () => null, prefs: createPrefsStore() });
    const tool = makeTool("builtin:draw");
    expect(adapt(tool)).toBe(adapt(tool));
    expect(adapt(tool).id).toBe("builtin:draw");
  });

  it("ToolGestureEvent:natural/hit/client/delta 载荷透传 + naturalSize 注入,capture 接缝不泄漏", () => {
    const seen: ToolGestureEvent[] = [];
    const tool = makeTool("builtin:draw", {
      onDown: (ev) => seen.push(ev),
      onMove: (ev) => seen.push(ev),
    });
    const adapt = createToolAdapter({
      getNaturalSize: () => ({ w: 800, h: 600 }),
      prefs: createPrefsStore(),
    });
    const runtime = createToolRuntime(makeRuntimeEnv());
    runtime.setActiveTool(adapt(tool));
    runtime.dispatch(pev("down"));
    runtime.dispatch(
      pev("move", {
        client: { x: 110, y: 70 },
        natural: { x: 55, y: 35 },
        deltaClient: { dx: 10, dy: 10 },
        deltaNatural: { dx: 5, dy: 5 },
      }),
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]!.natural).toEqual({ x: 50, y: 30 });
    expect(seen[0]!.naturalSize).toEqual({ w: 800, h: 600 });
    expect(seen[0]!.hit).toEqual({ kind: "overlay" });
    expect(seen[1]!.client).toEqual({ x: 110, y: 70 });
    expect(seen[1]!.deltaClient).toEqual({ dx: 10, dy: 10 });
    expect(seen[1]!.deltaNatural).toEqual({ dx: 5, dy: 5 });
    expect(seen[1]!.expandDelta).toBeNull();
    expect("capture" in seen[0]!).toBe(false); // L2 事件零 DOM 接缝(3.3)
  });

  it("expand-handle 命中:边名=ExpandEdges 键(top/right/bottom/left)+ expandDelta 透传", () => {
    const seen: ToolGestureEvent[] = [];
    const tool = makeTool("builtin:expand", { onMove: (ev) => seen.push(ev) });
    const adapt = createToolAdapter({ getNaturalSize: () => null, prefs: createPrefsStore() });
    const runtime = createToolRuntime(makeRuntimeEnv());
    runtime.setActiveTool(adapt(tool));
    runtime.dispatch(pev("down", { hit: { kind: "expand-handle", edge: "left" } }));
    runtime.dispatch(
      pev("move", { hit: { kind: "expand-handle", edge: "left" }, expandDelta: 24 }),
    );
    expect(seen[0]!.hit).toEqual({ kind: "expand-handle", edge: "left" });
    expect(seen[0]!.expandDelta).toBe(24);
  });

  it("capturePointer 缺省 true:down 设 capture;false(text 特例)不设", () => {
    const capture = vi.fn();
    const adapt = createToolAdapter({ getNaturalSize: () => null, prefs: createPrefsStore() });

    const capturing = createToolRuntime(makeRuntimeEnv());
    capturing.setActiveTool(adapt(makeTool("builtin:draw", { onDown: () => {} })));
    capturing.dispatch(pev("down", { capture }));
    expect(capture).toHaveBeenCalledTimes(1);

    capture.mockClear();
    const noCapture = createToolRuntime(makeRuntimeEnv());
    noCapture.setActiveTool(adapt(makeTool("builtin:text", { capturePointer: false, onDown: () => {} })));
    noCapture.dispatch(pev("down", { capture }));
    expect(capture).not.toHaveBeenCalled();
  });

  it("Context 能力面:draft 双通道/history.commit/stage.panBy/layers 读面/prefs 注入初值", () => {
    const env = makeRuntimeEnv();
    const prefs = createPrefsStore({ annoColor: "#ff4d4f" });
    const adapt = createToolAdapter({ getNaturalSize: () => ({ w: 10, h: 10 }), prefs });
    const runtime = createToolRuntime(env);
    let ctxSeen: CanvasToolContext | null = null;
    const tool = makeTool("builtin:draw", {
      onDown: (_ev, ctx) => {
        ctxSeen = ctx;
        ctx.draft.set({ mode: "paint", size: 4, points: [] });
      },
      onUp: (_ev, ctx) => {
        const d = ctx.draft.get();
        ctx.history.commit({ kind: "stroke", item: d });
        ctx.draft.set(null);
        ctx.stage.panBy(3, -2);
      },
    });
    runtime.setActiveTool(adapt(tool));
    runtime.dispatch(pev("down"));
    // draft 双通道:ctx.draft.set 后 runtime ref 通道同步可读(2.2 证明点)
    expect(runtime.getDraft()).toEqual({ mode: "paint", size: 4, points: [] });
    expect(ctxSeen!.draft.get()).toEqual({ mode: "paint", size: 4, points: [] });
    expect(ctxSeen!.layers).toBe(emptyLayers); // layers 读面直通(Req 5.1)
    expect(ctxSeen!.prefs.get<string>("annoColor")).toBe("#ff4d4f"); // 装配注入初值
    ctxSeen!.prefs.set("annoColor", "#00ff00");
    expect(prefs.get("annoColor")).toBe("#00ff00"); // 写回同一 KV
    runtime.dispatch(pev("up"));
    expect(env.committed).toEqual([{ kind: "stroke", item: { mode: "paint", size: 4, points: [] } }]);
    expect(env.pans).toEqual([[3, -2]]);
    expect(runtime.getDraft()).toBeNull();
  });

  it("defer 经能力面直通:up 回调入队的动作在 onUp 返回后执行(text 特例通道)", () => {
    const order: string[] = [];
    const adapt = createToolAdapter({ getNaturalSize: () => null, prefs: createPrefsStore() });
    const runtime = createToolRuntime(makeRuntimeEnv());
    const tool = makeTool("builtin:text", {
      capturePointer: false,
      onUp: (_ev, ctx) => {
        ctx.defer(() => order.push("deferred"));
        order.push("onUp");
      },
    });
    runtime.setActiveTool(adapt(tool));
    runtime.dispatch(pev("down"));
    runtime.dispatch(pev("up"));
    expect(order).toEqual(["onUp", "deferred"]);
  });

  it("错误边界闭环:工具回调抛错 → runtime 禁用 + 共享收集器条目经 registry.diagnostics 可见", () => {
    const collector = createDiagnosticsCollector();
    const registry = createCanvasRegistry({ diagnostics: collector });
    const tool = makeTool("ext:bad", {
      onDown: () => {
        throw new Error("boom");
      },
    });
    registry.registerTool(tool);
    const adapt = createToolAdapter({ getNaturalSize: () => null, prefs: createPrefsStore() });
    const runtime = createToolRuntime(makeRuntimeEnv({ diagnostics: collector }));
    runtime.setActiveTool(adapt(tool));
    expect(() => runtime.dispatch(pev("down"))).not.toThrow(); // 画布不崩(6.4)
    expect(runtime.isToolDisabled("ext:bad")).toBe(true);
    expect(registry.diagnostics).toHaveLength(1);
    expect(registry.diagnostics[0]!.toolId).toBe("ext:bad");
    expect(registry.diagnostics[0]!.error).toBe("boom");
  });
});

// ── prefs store ──────────────────────────────────────────────────────────────

describe("createPrefsStore", () => {
  it("初值注入/get-set 往返/未知键 undefined", () => {
    const prefs = createPrefsStore({ brushRatio: 0.05 });
    expect(prefs.get<number>("brushRatio")).toBe(0.05);
    expect(prefs.get("unknown")).toBeUndefined();
    prefs.set("brushRatio", 0.1);
    expect(prefs.get<number>("brushRatio")).toBe(0.1);
  });

  it("订阅通知:实效变更通知一次,等值 set 不通知(useSyncExternalStore 前提)", () => {
    const prefs = createPrefsStore({ annoColor: "#fff" });
    const listener = vi.fn();
    prefs.subscribe(listener);
    const before = prefs.getSnapshot();
    prefs.set("annoColor", "#fff"); // 等值:不通知、快照引用稳定
    expect(listener).not.toHaveBeenCalled();
    expect(prefs.getSnapshot()).toBe(before);
    prefs.set("annoColor", "#000");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prefs.getSnapshot()).not.toBe(before);
  });
});

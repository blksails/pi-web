/**
 * kernel/tool-runtime 单测(task 2.5,Req 2.2/4.2/6.4;design.md「Testing Strategy
 * / Unit Tests #4」的 tool-runtime 份额)。
 *
 * 锚定三组行为(golden 期望按**旧实现时序**手写,不从新实现反推):
 * - draft 槽 ref+state 双写时序(workbench :1120-:1209):down 内 capture 先于
 *   draft 首写(:1109-:1115 顺序);move 经 ref 通道同步读上一笔(不依赖渲染,
 *   :1159-:1162);up 时 commit 进 history(push+清 redo,:1188-:1189)+ 清 draft;
 * - defer 队列(design `ctx.defer`):down/move/up 中注册的回调在 onUp 返回后按
 *   FIFO 执行(text「up 时才挂编辑器防 blur」特例的承载,:1176-:1181);
 *   pointercancel 相位映射 onUp(2.4 留账:旧 onPointerCancel={onOverlayPointerUp}
 *   提交语义,:1214 附近);
 * - L2 错误边界(6.4)三态:工具回调抛错 → 禁用该工具(后续手势 no-op)+
 *   diagnostics(toolId/error/时机)+ 中止当前手势(清 draft/释放 capture),
 *   runtime 自身状态一致、其他工具照常(画布不崩)。
 *
 * 另:接入 2.4 dispatch 接缝的真分派集成(真 createPointerRouter → runtime.dispatch,
 * natural 坐标按旧公式 ((client-rect.left)/rect.width)×natural.w 手算)。
 *
 * 注意:kernel/ 是 L1,不从包根出口导出 —— 本测试走内部路径 import。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createDiagnosticsCollector,
  createToolRuntime,
  type RuntimeTool,
  type RuntimeToolContext,
  type ToolRuntimeEnv,
} from "../src/kernel/tool-runtime.js";
import { createHistoryStore } from "../src/kernel/history.js";
import { createStageController, type RectLike } from "../src/kernel/stage.js";
import { createLayersStore } from "../src/kernel/layers.js";
import {
  HIT_MARKERS,
  createPointerRouter,
  type ElementLike,
  type RouterPointerEvent,
  type ToolPointerEvent,
} from "../src/kernel/pointer.js";
import type { CanvasOp, MaskStroke } from "../src/types.js";

// ── 测试环境(与 pointer.test 同款:rect 500×400 @ (100,50) ↔ natural 1000×800)──

const BASE_RECT: RectLike = { left: 100, top: 50, width: 500, height: 400 };
const NATURAL = { w: 1000, h: 800 };

function makeRuntime(over?: Partial<ToolRuntimeEnv>): {
  runtime: ReturnType<typeof createToolRuntime>;
  history: ReturnType<typeof createHistoryStore>;
  release: ReturnType<typeof vi.fn<(pointerId: number) => void>>;
} {
  const history = createHistoryStore();
  const stage = createStageController({
    getRect: () => BASE_RECT,
    getNaturalSize: () => NATURAL,
  });
  const layers = createLayersStore();
  const release = vi.fn<(pointerId: number) => void>();
  const runtime = createToolRuntime({
    history,
    stage,
    layers,
    releasePointerCapture: release,
    ...over,
  });
  return { runtime, history, release };
}

/** 直喂 dispatch 的工具通道事件(overlay 命中缺省;单测最小载荷)。 */
const tev = (
  phase: ToolPointerEvent["phase"],
  over?: Partial<ToolPointerEvent>,
): ToolPointerEvent => ({
  phase,
  hit: { kind: "overlay" },
  pointerId: 1,
  client: { x: 0, y: 0 },
  natural: { x: 10, y: 20 },
  deltaClient: { dx: 0, dy: 0 },
  deltaNatural: { dx: 0, dy: 0 },
  expandDelta: null,
  capture: () => undefined,
  ...over,
});

const nat = (ev: ToolPointerEvent): { x: number; y: number } => {
  if (ev.natural === null) throw new Error("test event missing natural");
  return ev.natural;
};

/** mask 族测试工具:down=capture→draft 首写;move=ref 读+累积;up=commit+清 draft。 */
const makeMaskTool = (log: string[]): RuntimeTool => ({
  id: "builtin:mask",
  onDown: (ev, ctx) => {
    ev.capture(); // :1109 capture 设置点:先于 draft 首写
    log.push("capture");
    const d: MaskStroke = { mode: "paint", size: 4, points: [nat(ev)] };
    ctx.draft.set(d);
    log.push("draft");
  },
  onMove: (ev, ctx) => {
    const d = ctx.draft.get() as MaskStroke; // ref 通道同步读(:1159)
    ctx.draft.set({ ...d, points: [...d.points, nat(ev)] });
  },
  onUp: (_ev, ctx) => {
    const d = ctx.draft.get() as MaskStroke | null;
    if (d !== null) {
      ctx.history.commit({ kind: "stroke", item: d }); // :1188 push+清 redo
    }
    ctx.draft.set(null); // :1186/:1190 清 draft
  },
});

describe("kernel/tool-runtime draft 槽(ref+state 双写时序)", () => {
  it("down 写入 draft:ref 通道(getDraft)与 state 通道(快照)一致,通知时 ref 已就绪", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTool(makeMaskTool([]));
    const seen: Array<{ ref: unknown; snap: unknown }> = [];
    runtime.subscribe(() => {
      seen.push({ ref: runtime.getDraft(), snap: runtime.getSnapshot().draft });
    });
    runtime.dispatch(tev("down"));
    const d = runtime.getDraft() as MaskStroke;
    expect(d.points).toEqual([{ x: 10, y: 20 }]);
    expect(runtime.getSnapshot().draft).toBe(d);
    // 通知回调里两通道均已是新值(ref 先行,state 不落后)。
    expect(seen.at(-1)).toEqual({ ref: d, snap: d });
  });

  it("capture 设置点:down 内 capture 先于 draft 首写(:1109-:1115 顺序),经事件接缝生效", () => {
    const { runtime } = makeRuntime();
    const log: string[] = [];
    runtime.setActiveTool(makeMaskTool(log));
    const capture = vi.fn();
    runtime.dispatch(tev("down", { capture }));
    expect(log).toEqual(["capture", "draft"]);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("move 高频:onMove 经 ref 同步读上一笔 draft,points 逐帧累积", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTool(makeMaskTool([]));
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("move", { natural: { x: 11, y: 21 } }));
    runtime.dispatch(tev("move", { natural: { x: 12, y: 22 } }));
    const d = runtime.getDraft() as MaskStroke;
    expect(d.points).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
      { x: 12, y: 22 },
    ]);
  });

  it("快照引用稳定:无变更同引用;draft set 换新引用(useSyncExternalStore 前提)", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTool(makeMaskTool([]));
    const s0 = runtime.getSnapshot();
    expect(runtime.getSnapshot()).toBe(s0);
    runtime.dispatch(tev("down"));
    const s1 = runtime.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(runtime.getSnapshot()).toBe(s1);
  });

  it("up 提交:commit 进 history(push+清 redo,4.2/4.3 时机)且 draft 双通道清空", () => {
    const { runtime, history } = makeRuntime();
    // 预置重做栈:commit + undo → redo 非空,验证手势提交清 redo 的时机。
    history.commit({ kind: "anno", item: "seed" });
    history.undo();
    expect(history.canRedo).toBe(true);
    runtime.setActiveTool(makeMaskTool([]));
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("move", { natural: { x: 11, y: 21 } }));
    runtime.dispatch(tev("up"));
    expect(history.ops).toHaveLength(1);
    const op = history.ops[0] as CanvasOp;
    expect(op.kind).toBe("stroke");
    expect((op.item as MaskStroke).points).toHaveLength(2);
    expect(history.canRedo).toBe(false); // 清 redo 时机 = 提交时
    expect(runtime.getDraft()).toBeNull();
    expect(runtime.getSnapshot().draft).toBeNull();
  });
});

describe("kernel/tool-runtime defer 队列(up 后执行)", () => {
  const makeDeferTool = (log: string[]): RuntimeTool => ({
    id: "builtin:text",
    onDown: (_ev, ctx) => {
      ctx.defer(() => log.push("deferred-down"));
      log.push("down");
    },
    onUp: (_ev, ctx) => {
      ctx.defer(() => log.push("deferred-up"));
      log.push("up");
    },
  });

  it("down/up 中注册的 defer 回调在 onUp 返回后按 FIFO 执行(text 编辑器挂载特例时序)", () => {
    const { runtime } = makeRuntime();
    const log: string[] = [];
    runtime.setActiveTool(makeDeferTool(log));
    runtime.dispatch(tev("down"));
    expect(log).toEqual(["down"]); // up 前不执行
    runtime.dispatch(tev("move"));
    expect(log).toEqual(["down"]);
    runtime.dispatch(tev("up"));
    expect(log).toEqual(["down", "up", "deferred-down", "deferred-up"]);
  });

  it("cancel 相位映射 onUp(2.4 留账:旧 onPointerCancel=onPointerUp 提交语义),defer 一并冲刷", () => {
    const { runtime } = makeRuntime();
    const log: string[] = [];
    runtime.setActiveTool(makeDeferTool(log));
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("cancel"));
    expect(log).toEqual(["down", "up", "deferred-down", "deferred-up"]);
  });

  it("手势结束后(deferred 回调内)再 defer:立即执行(已在「up 后」)", () => {
    const { runtime } = makeRuntime();
    const log: string[] = [];
    let heldCtx: RuntimeToolContext | null = null;
    runtime.setActiveTool({
      id: "builtin:text",
      onUp: (_ev, ctx) => {
        heldCtx = ctx;
        ctx.defer(() => {
          log.push("outer");
          ctx.defer(() => log.push("inner"));
        });
      },
    });
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("up"));
    expect(log).toEqual(["outer", "inner"]);
    expect(heldCtx).not.toBeNull();
  });
});

describe("kernel/tool-runtime L2 错误边界(6.4:禁用/诊断/不崩)", () => {
  const boomTool = (phase: "down" | "move" | "up"): RuntimeTool => ({
    id: "ext:boom",
    onDown: (ev, ctx) => {
      ev.capture();
      ctx.draft.set({ mode: "paint", size: 1, points: [] } satisfies MaskStroke);
      if (phase === "down") throw new Error("boom-down");
    },
    onMove: () => {
      if (phase === "move") throw new Error("boom-move");
    },
    onUp: () => {
      if (phase === "up") throw new Error("boom-up");
    },
  });

  it("onDown 抛错:禁用工具+diagnostics(toolId/error/时机)+清 draft+释放 capture", () => {
    const { runtime, release } = makeRuntime();
    runtime.setActiveTool(boomTool("down"));
    runtime.dispatch(tev("down", { pointerId: 7 }));
    expect(runtime.isToolDisabled("ext:boom")).toBe(true);
    expect(runtime.getSnapshot().disabledTools).toContain("ext:boom");
    const diag = runtime.diagnostics;
    expect(diag).toHaveLength(1);
    expect(diag[0]).toMatchObject({ toolId: "ext:boom", phase: "down" });
    expect(diag[0]!.error).toContain("boom-down");
    expect(diag[0]!.at).toBeTypeOf("number");
    expect(runtime.getDraft()).toBeNull(); // 中止手势清 draft
    expect(release).toHaveBeenCalledWith(7); // capture 已设 → 释放
  });

  it("禁用后续手势对肇事工具 no-op(down 不再进入回调)", () => {
    const { runtime } = makeRuntime();
    const tool = boomTool("down");
    const onDown = vi.spyOn(tool, "onDown");
    runtime.setActiveTool(tool);
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("up"));
    runtime.dispatch(tev("down"));
    expect(onDown).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics).toHaveLength(1); // 不重复记账
  });

  it("onMove 抛错:中止当前手势(draft 清/capture 释放/后续 up 不派发)", () => {
    const { runtime, release } = makeRuntime();
    const tool = boomTool("move");
    const onUp = vi.spyOn(tool, "onUp");
    runtime.setActiveTool(tool);
    runtime.dispatch(tev("down"));
    expect(runtime.getDraft()).not.toBeNull();
    runtime.dispatch(tev("move"));
    expect(runtime.getDraft()).toBeNull();
    expect(release).toHaveBeenCalledWith(1);
    runtime.dispatch(tev("up"));
    expect(onUp).not.toHaveBeenCalled();
    expect(runtime.diagnostics[0]).toMatchObject({ toolId: "ext:boom", phase: "move" });
  });

  it("onUp 抛错:禁用+diagnostics(phase=up)+清 draft+释放 capture,deferred 随会话弃置,不崩", () => {
    const { runtime, release } = makeRuntime();
    const deferred = vi.fn();
    const base = boomTool("up");
    runtime.setActiveTool({
      ...base,
      onDown: (ev, ctx) => {
        base.onDown!(ev, ctx); // capture + draft 首写(boom 工厂 down 路径不抛)
        ctx.defer(deferred); // 手势期入队:正常 up 后应执行;onUp 抛错则须弃置
      },
    });
    runtime.dispatch(tev("down", { pointerId: 7 }));
    expect(runtime.getDraft()).not.toBeNull();
    expect(() => runtime.dispatch(tev("up", { pointerId: 7 }))).not.toThrow();
    expect(runtime.isToolDisabled("ext:boom")).toBe(true);
    expect(runtime.diagnostics).toHaveLength(1);
    expect(runtime.diagnostics[0]).toMatchObject({ toolId: "ext:boom", phase: "up" });
    expect(runtime.diagnostics[0]!.error).toContain("boom-up");
    expect(runtime.getDraft()).toBeNull(); // 中止手势清 draft(双通道)
    expect(runtime.getSnapshot().draft).toBeNull();
    expect(release).toHaveBeenCalledWith(7); // capture 已设 → 释放
    expect(deferred).not.toHaveBeenCalled(); // 错误中止:defer 队列随会话弃置
  });

  it("cancel 相位 onUp 抛错:诊断锚定 phase=cancel(与 up 相位区分记账)", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTool(boomTool("up"));
    runtime.dispatch(tev("down"));
    expect(() => runtime.dispatch(tev("cancel"))).not.toThrow();
    expect(runtime.isToolDisabled("ext:boom")).toBe(true);
    expect(runtime.diagnostics[0]).toMatchObject({ toolId: "ext:boom", phase: "cancel" });
  });

  it("defer 回调抛错:同样禁用+诊断(phase=defer),剩余 deferred 弃置,不崩", () => {
    const { runtime } = makeRuntime();
    const ran: string[] = [];
    runtime.setActiveTool({
      id: "ext:boom",
      onUp: (_ev, ctx) => {
        ctx.defer(() => {
          throw new Error("boom-defer");
        });
        ctx.defer(() => ran.push("after"));
      },
    });
    runtime.dispatch(tev("down"));
    expect(() => runtime.dispatch(tev("up"))).not.toThrow();
    expect(runtime.isToolDisabled("ext:boom")).toBe(true);
    expect(runtime.diagnostics[0]).toMatchObject({ toolId: "ext:boom", phase: "defer" });
    expect(ran).toEqual([]); // 后续 deferred 弃置
  });

  it("画布不崩:禁用只及肇事工具,切换健康工具后完整手势照常提交", () => {
    const { runtime, history } = makeRuntime();
    runtime.setActiveTool(boomTool("down"));
    runtime.dispatch(tev("down"));
    expect(runtime.isToolDisabled("ext:boom")).toBe(true);
    runtime.setActiveTool(makeMaskTool([]));
    expect(runtime.isToolDisabled("builtin:mask")).toBe(false);
    runtime.dispatch(tev("down"));
    runtime.dispatch(tev("move", { natural: { x: 11, y: 21 } }));
    runtime.dispatch(tev("up"));
    expect(history.ops).toHaveLength(1);
    expect(runtime.getDraft()).toBeNull();
  });

  it("共享 diagnostics 收集器注入(2.6 registry 复用接缝):错误记入注入的收集器", () => {
    const collector = createDiagnosticsCollector();
    const { runtime } = makeRuntime({ diagnostics: collector });
    runtime.setActiveTool(boomTool("down"));
    runtime.dispatch(tev("down"));
    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0]).toMatchObject({ toolId: "ext:boom" });
    expect(runtime.diagnostics).toBe(collector.entries);
  });
});

describe("kernel/tool-runtime 激活工具与守卫", () => {
  it("无激活工具:down/up no-op 不崩,无 draft 无诊断", () => {
    const { runtime } = makeRuntime();
    expect(() => {
      runtime.dispatch(tev("down"));
      runtime.dispatch(tev("move"));
      runtime.dispatch(tev("up"));
    }).not.toThrow();
    expect(runtime.getDraft()).toBeNull();
    expect(runtime.diagnostics).toHaveLength(0);
  });

  it("setActiveTool 反映到快照;重复设同一工具不通知(StrictMode 幂等)", () => {
    const { runtime } = makeRuntime();
    const tool = makeMaskTool([]);
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.setActiveTool(tool);
    expect(runtime.getActiveTool()).toBe(tool);
    expect(runtime.getSnapshot().activeToolId).toBe("builtin:mask");
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.setActiveTool(tool); // 幂等:无实效变更不通知
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("非会话 pointerId 的 move/up 忽略;会话中二次 down 忽略(独占幂等)", () => {
    const { runtime, history } = makeRuntime();
    runtime.setActiveTool(makeMaskTool([]));
    runtime.dispatch(tev("down", { pointerId: 1 }));
    const d0 = runtime.getDraft();
    runtime.dispatch(tev("down", { pointerId: 2 })); // 二次 down:忽略
    expect(runtime.getDraft()).toBe(d0);
    runtime.dispatch(tev("move", { pointerId: 2, natural: { x: 99, y: 99 } })); // 异指针:忽略
    expect((runtime.getDraft() as MaskStroke).points).toHaveLength(1);
    runtime.dispatch(tev("up", { pointerId: 2 })); // 异指针 up:不提交
    expect(history.ops).toHaveLength(0);
    runtime.dispatch(tev("up", { pointerId: 1 }));
    expect(history.ops).toHaveLength(1);
  });

  it("订阅退订幂等(StrictMode 双执行安全)", () => {
    const { runtime } = makeRuntime();
    const listener = vi.fn();
    const off = runtime.subscribe(listener);
    off();
    off(); // 双退订安全
    runtime.setActiveTool(makeMaskTool([]));
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── 接入 2.4 dispatch 接缝:真 PointerRouter → runtime.dispatch 集成 ─────────────

class FakeEl implements ElementLike {
  constructor(
    private readonly attrs: Record<string, string>,
    private readonly parent: FakeEl | null = null,
  ) {}
  getAttribute(name: string): string | null {
    return name in this.attrs ? (this.attrs[name] ?? null) : null;
  }
  closest(selector: string): ElementLike | null {
    const attr = selector.slice(1, -1);
    let cur: FakeEl | null = this;
    while (cur !== null) {
      if (attr in cur.attrs) return cur;
      cur = cur.parent;
    }
    return null;
  }
}

describe("kernel/tool-runtime × pointer 路由集成(2.4 dispatch 接缝真分派)", () => {
  const overlayEl = new FakeEl({ [HIT_MARKERS.overlay]: "" });
  const pe = (x: number, y: number, pointerId = 1): RouterPointerEvent => ({
    pointerId,
    clientX: x,
    clientY: y,
    target: overlayEl,
  });

  function makeWired(): {
    router: ReturnType<typeof createPointerRouter>;
    runtime: ReturnType<typeof createToolRuntime>;
    history: ReturnType<typeof createHistoryStore>;
    capturePointer: ReturnType<typeof vi.fn<(target: ElementLike, pointerId: number) => void>>;
  } {
    const stage = createStageController({
      getRect: () => BASE_RECT,
      getNaturalSize: () => NATURAL,
    });
    const layers = createLayersStore();
    const history = createHistoryStore();
    const runtime = createToolRuntime({ history, stage, layers });
    const capturePointer = vi.fn<(target: ElementLike, pointerId: number) => void>();
    const router = createPointerRouter({
      stage,
      layers,
      dispatch: runtime.dispatch,
      capturePointer,
    });
    return { router, runtime, history, capturePointer };
  }

  it("overlay 手势全程:down/move/up 经路由分派,natural 按旧公式换算,up 提交进 history", () => {
    const { router, runtime, history, capturePointer } = makeWired();
    runtime.setActiveTool(makeMaskTool([]));
    // (150,90) → x=((150-100)/500)*1000=100, y=((90-50)/400)*800=80(旧 :852-:861 公式手算)
    router.onPointerDown(pe(150, 90));
    expect(capturePointer).toHaveBeenCalledWith(overlayEl, 1); // 工具 ev.capture() → 路由接缝
    router.onPointerMove(pe(200, 130)); // → (200,160)
    router.onPointerUp(pe(200, 130));
    expect(history.ops).toHaveLength(1);
    const item = history.ops[0]!.item as MaskStroke;
    expect(item.points).toEqual([
      { x: 100, y: 80 },
      { x: 200, y: 160 },
    ]);
    expect(runtime.getDraft()).toBeNull();
  });

  it("pointercancel 经路由 → cancel 相位 → onUp 提交语义(2.4 留账收口)", () => {
    const { router, runtime, history } = makeWired();
    runtime.setActiveTool(makeMaskTool([]));
    router.onPointerDown(pe(150, 90));
    router.onPointerCancel(pe(160, 98));
    expect(history.ops).toHaveLength(1); // cancel 与 up 同提交(旧 onPointerCancel=onPointerUp)
    expect(runtime.getDraft()).toBeNull();
  });
});

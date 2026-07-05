/**
 * kernel/pointer — 舞台指针唯一路由(L1,**不从包根出口导出**;task 2.4,Req 3.1/3.2)。
 *
 * design.md「L1 集成核 / pointer」:`createPointerRouter({ stage, layers, dispatch })`,
 * 单入口接收舞台容器的 pointer 事件;命中判定(layer/handle DOM 经 data-* 标记上交,
 * 不再各自挂 mousedown 阻断);层拖拽/缩放为工具无关内核手势(现状一致);双事件守卫
 * 内建(根治 workbench :1589/:1647 的 onMouseDown stopPropagation 散点补丁族)。
 *
 * 结构性根治(3.2):旧世界层/手柄的 pointerdown 与舞台的 mousedown 平移监听是**两套
 * 并存事件流**,只能靠散点 stopPropagation 苟活;本路由是唯一入口 —— 每次 down 经
 * hitTest 得到**互斥**的命中描述符,建立独占会话(session),move/up/cancel 一律路由到
 * 当前会话(不再重复命中判定),层/手柄命中时舞台平移(stage 命中 → 工具通道)在结构上
 * 不可能触发,无须任何 DOM 级阻断。
 *
 * 命中优先级(design「System Flows」,与现状 DOM 层叠一致):
 *   expand-handle > layer-resize > layer > overlay > stage(回退)。
 *
 * 行为语义原样迁移自 canvas-workbench:
 * - 层手势(:976-:1011):down = find(未知 id → no-op)→ select → capture → 记
 *   `{id, mode, orig}`;move = 客户端位移 × (natural/rect) 换算为底图像素后交 2.3
 *   `layers.applyGesture`(rect/natural 不可得 → 该帧丢弃);up/cancel = 清会话。
 *   位移经 toNatural 差分计算(current-rect 语义),与旧公式
 *   `((clientX-startX)/rect.width)*natural.w` 逐点等价(rect.left 抵消)。
 * - 扩图手柄(:1016-:1051):命中载荷 = 边(top/right/bottom/left,即 ExpandEdges 键)
 *   + 向外为正的位移 `expandDelta`(底图像素;旧公式 deltaClient×(nat.w/rect.width),
 *   本实现以 toNatural 差分等价换算 —— rect 与 natural 同源线性映射,横纵比例因子
 *   恒等);`max(0, round(orig+delta))` 的扩图**状态**归工具/装配层(3.2 任务),路由
 *   只派发。down 时 rect/natural 不可得 → 手势不启动(:1022-:1024)。
 * - overlay(:1105-:1207):down 时 toNatural 失败 → 手势不启动(现状语义);capture
 *   是否设置由工具决定(text 不捕获)→ 以事件上的 `capture()` 接缝上交 2.5(研究稿
 *   「capture 由 RT 管」);pointercancel 按现状绑定语义派发 phase="cancel"(2.5 映射
 *   到工具 onUp,与旧 onPointerCancel={onOverlayPointerUp} 一致)。
 * - 舞台平移(:1241-:1252):现状**仅 move 工具**下空白处可平移,且平移消费的是
 *   **客户端位移**(offset 为屏幕 px,natural 换算反而随 rect 移动漂移)—— 故 stage
 *   命中事件不要求 natural(可为 null),`deltaClient` 为 pan 载荷;是否平移由工具
 *   (builtin:move,task 3.2)经 dispatch 决定,路由保持工具无关。
 *
 * 分派目标 = 注入接缝 `dispatch`(本模块自定义;真 ToolRuntime 在 2.5 接入)——
 * **本模块不得 import tool-runtime**(防循环,task 2.4 边界)。
 * DOM 依赖被压到最小 `ElementLike`(closest/getAttribute)与注入的 capture 回调,
 * 路由本体零 DOM 全局、零 addEventListener(React 无关,纯 TS)。
 */
import type { StageController } from "./stage.js";
import type { LayerGesture, LayersStore } from "./layers.js";
import type { ExpandEdges } from "../types.js";

// ── 命中标记(workbench 既有 DOM data-* 锚点,design「Modified Files」:锚点保持)──

/** 命中判定消费的 data-* 标记名(装配层的层/手柄/overlay 元素既有锚点)。 */
export const HIT_MARKERS = {
  /** 图层根元素(workbench :1567)。 */
  layer: "data-canvas-layer",
  /** 图层 id(与 layer 标记同元素,:1568)。 */
  layerId: "data-layer-id",
  /** 图层右下角缩放手柄(层内嵌套,:1601)。 */
  layerResize: "data-canvas-layer-resize",
  /** 扩图手柄(值 = 边,:1644)。 */
  expandHandle: "data-canvas-expand-handle",
  /** 工具画布 overlay(:1615)。 */
  overlay: "data-canvas-mask-overlay",
} as const;

// ── 最小事件/元素形状(jsdom/stub 单测友好,不依赖真实 DOM 类型)────────────────

/** 命中判定所需的最小元素面(DOM Element 结构性满足)。 */
export interface ElementLike {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
}

/** 路由入口收的最小指针事件形状(装配层从 React.PointerEvent 摘取)。 */
export interface RouterPointerEvent {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: ElementLike | null;
}

// ── 命中描述符 ────────────────────────────────────────────────────────────────

/** 扩图边(= ExpandEdges 键;与既有 data-canvas-expand-handle 值一致)。 */
export type ExpandEdge = keyof ExpandEdges;

/** 命中描述符(四类互斥;layer 命中由内核消化,不进工具通道)。 */
export type PointerHit =
  | { readonly kind: "overlay" }
  | { readonly kind: "stage" }
  | { readonly kind: "layer"; readonly layerId: string; readonly mode: "move" | "resize" }
  | { readonly kind: "expand-handle"; readonly edge: ExpandEdge };

/** 工具通道可见的命中子集(层手势为内核手势,恒不外派)。 */
export type ToolPointerHit = Exclude<PointerHit, { kind: "layer" }>;

const EXPAND_EDGES: readonly string[] = ["top", "right", "bottom", "left"] satisfies readonly ExpandEdge[];

const sel = (attr: string): string => `[${attr}]`;

/**
 * DOM 命中判定(纯函数):target 经 data-* 标记上交命中描述符。
 * 防御回退:标记值非法(未知扩图边/层缺 id)→ stage(不启动错误手势)。
 */
export function hitTest(target: ElementLike | null): PointerHit {
  if (target === null) return { kind: "stage" };
  const handle = target.closest(sel(HIT_MARKERS.expandHandle));
  if (handle !== null) {
    const edge = handle.getAttribute(HIT_MARKERS.expandHandle);
    if (edge !== null && EXPAND_EDGES.includes(edge)) {
      return { kind: "expand-handle", edge: edge as ExpandEdge };
    }
    return { kind: "stage" };
  }
  const layerEl = target.closest(sel(HIT_MARKERS.layer));
  if (layerEl !== null) {
    const layerId = layerEl.getAttribute(HIT_MARKERS.layerId);
    if (layerId !== null && layerId !== "") {
      const mode = target.closest(sel(HIT_MARKERS.layerResize)) !== null ? "resize" : "move";
      return { kind: "layer", layerId, mode };
    }
    return { kind: "stage" };
  }
  if (target.closest(sel(HIT_MARKERS.overlay)) !== null) return { kind: "overlay" };
  return { kind: "stage" };
}

// ── 工具通道事件(dispatch 接缝载荷)──────────────────────────────────────────

/**
 * 路由派发给工具通道(2.5 ToolRuntime)的语义化手势事件:
 * - `natural`:已换算底图像素坐标(rect/natural 不可得 → null;stage 命中允许 null);
 * - `deltaNatural`:自 down 起的底图像素位移(current-rect 语义);
 * - `deltaClient`:自 down 起的客户端位移(舞台平移消费,:1241-:1248);
 * - `expandDelta`:扩图手柄命中时边向外为正的底图像素位移(其余命中恒 null);
 * - `capture()`:对 down 目标设 pointer capture 的接缝(是否调用由工具/RT 决定)。
 */
export interface ToolPointerEvent {
  readonly phase: "down" | "move" | "up" | "cancel";
  readonly hit: ToolPointerHit;
  readonly pointerId: number;
  readonly client: { readonly x: number; readonly y: number };
  readonly natural: { readonly x: number; readonly y: number } | null;
  readonly deltaClient: { readonly dx: number; readonly dy: number };
  readonly deltaNatural: { readonly dx: number; readonly dy: number } | null;
  readonly expandDelta: number | null;
  readonly capture: () => void;
}

/** 分派接缝(2.4 注入 stub;2.5 接真 ToolRuntime)。 */
export type PointerDispatch = (ev: ToolPointerEvent) => void;

// ── 路由 ─────────────────────────────────────────────────────────────────────

export interface PointerRouterEnv {
  /** 坐标换算(2.1;current-rect 语义经 env 每次现取)。 */
  readonly stage: Pick<StageController, "toNatural">;
  /** 层内核手势消费面(2.3)。 */
  readonly layers: Pick<LayersStore, "get" | "select" | "applyGesture">;
  /** 工具通道分派接缝。 */
  readonly dispatch: PointerDispatch;
  /** pointer capture 接缝(装配层实现 setPointerCapture;缺省 no-op)。 */
  readonly capturePointer?: (target: ElementLike, pointerId: number) => void;
}

/** 当前会话快照(诊断/测试用;null = 空闲)。 */
export interface RouterSessionSnapshot {
  readonly kind: "layer" | "tool";
  readonly pointerId: number;
  readonly hit: PointerHit;
}

/** 舞台指针唯一入口(装配层把容器的 pointerdown/move/up/cancel 全量喂入)。 */
export interface PointerRouter {
  onPointerDown(ev: RouterPointerEvent): void;
  onPointerMove(ev: RouterPointerEvent): void;
  onPointerUp(ev: RouterPointerEvent): void;
  onPointerCancel(ev: RouterPointerEvent): void;
  getSession(): RouterSessionSnapshot | null;
}

interface LayerSession {
  readonly kind: "layer";
  readonly pointerId: number;
  readonly hit: PointerHit;
  readonly gesture: LayerGesture;
  readonly start: { readonly x: number; readonly y: number };
}

interface ToolSession {
  readonly kind: "tool";
  readonly pointerId: number;
  readonly hit: ToolPointerHit;
  readonly start: { readonly x: number; readonly y: number };
  readonly capture: () => void;
}

type RouterSession = LayerSession | ToolSession;

/** 边向外为正的位移投影(:1032-:1039 的方向语义)。 */
const outwardDelta = (edge: ExpandEdge, delta: { dx: number; dy: number }): number => {
  switch (edge) {
    case "right":
      return delta.dx;
    case "left":
      return -delta.dx;
    case "bottom":
      return delta.dy;
    case "top":
      return -delta.dy;
  }
};

export function createPointerRouter(env: PointerRouterEnv): PointerRouter {
  let session: RouterSession | null = null;

  /**
   * down 起点 → 当前点的底图像素差分(两端都用**当前** rect 换算)。
   * 与旧逐帧公式等价:rect.left/top 在差分中抵消,余 (Δclient/rect.size)×natural
   * —— 即 :996-:997(层)与 :1031(扩图 perPx)的换算;rect/natural 不可得 → null
   * (该帧丢弃,:993-:995/:1029-:1030 语义)。
   */
  const naturalAt = (
    s: { start: { x: number; y: number } },
    ev: RouterPointerEvent,
  ): { now: { x: number; y: number }; delta: { dx: number; dy: number } } | null => {
    const p0 = env.stage.toNatural(s.start.x, s.start.y);
    const p1 = env.stage.toNatural(ev.clientX, ev.clientY);
    if (p0 === null || p1 === null) return null;
    return { now: p1, delta: { dx: p1.x - p0.x, dy: p1.y - p0.y } };
  };

  const buildToolEvent = (
    phase: ToolPointerEvent["phase"],
    s: ToolSession,
    ev: RouterPointerEvent,
  ): ToolPointerEvent => {
    const conv = naturalAt(s, ev);
    return {
      phase,
      hit: s.hit,
      pointerId: s.pointerId,
      client: { x: ev.clientX, y: ev.clientY },
      natural: conv?.now ?? null,
      deltaClient: { dx: ev.clientX - s.start.x, dy: ev.clientY - s.start.y },
      deltaNatural: conv?.delta ?? null,
      expandDelta: s.hit.kind === "expand-handle" && conv !== null ? outwardDelta(s.hit.edge, conv.delta) : null,
      capture: s.capture,
    };
  };

  const endSession = (phase: "up" | "cancel", ev: RouterPointerEvent): void => {
    const s = session;
    if (s === null || s.pointerId !== ev.pointerId) return; // 非会话指针:忽略
    session = null;
    if (s.kind === "layer") return; // 层手势收束不外派(:1009-:1011 layerDrag=null)
    // 工具通道 up/cancel 无条件派发(overlay 提交不依赖坐标可得,:1175-:1207)。
    env.dispatch(buildToolEvent(phase, s, ev));
  };

  return {
    onPointerDown: (ev) => {
      if (session !== null) return; // 守卫:会话独占(二次 down/多指不夺手势)
      const hit = hitTest(ev.target);
      if (hit.kind === "layer") {
        // 工具无关内核手势(:976-:989;现状 onLayerPointerDown 不看 tool)。
        const l = env.layers.get(hit.layerId);
        if (l === undefined) return; // :978-:979 未知层:no-op(不选中不捕获)
        env.layers.select(hit.layerId); // :980
        if (ev.target !== null) env.capturePointer?.(ev.target, ev.pointerId); // :981
        session = {
          kind: "layer",
          pointerId: ev.pointerId,
          hit,
          gesture: { id: hit.layerId, mode: hit.mode, orig: { x: l.x, y: l.y, w: l.w, h: l.h } },
          start: { x: ev.clientX, y: ev.clientY },
        };
        return;
      }
      const target = ev.target;
      const pointerId = ev.pointerId;
      const s: ToolSession = {
        kind: "tool",
        pointerId,
        hit,
        start: { x: ev.clientX, y: ev.clientY },
        capture: () => {
          if (target !== null) env.capturePointer?.(target, pointerId);
        },
      };
      // overlay/expand-handle:换算不可得 → 手势不启动(:1106-:1107/:1022-:1024);
      // stage:平移消费 deltaClient,natural 允许缺席(:1241-:1248 不量 natural)。
      const down = buildToolEvent("down", s, ev);
      if (hit.kind !== "stage" && down.natural === null) return;
      session = s;
      env.dispatch(down);
    },
    onPointerMove: (ev) => {
      const s = session;
      if (s === null || s.pointerId !== ev.pointerId) return;
      if (s.kind === "layer") {
        const conv = naturalAt(s, ev);
        if (conv === null) return; // :993-:995 该帧丢弃
        env.layers.applyGesture(s.gesture, conv.delta.dx, conv.delta.dy);
        return;
      }
      const move = buildToolEvent("move", s, ev);
      if (s.hit.kind !== "stage" && move.natural === null) return; // :1157-:1158/:1029-:1030
      env.dispatch(move);
    },
    onPointerUp: (ev) => endSession("up", ev),
    onPointerCancel: (ev) => endSession("cancel", ev),
    getSession: () =>
      session === null ? null : { kind: session.kind, pointerId: session.pointerId, hit: session.hit },
  };
}

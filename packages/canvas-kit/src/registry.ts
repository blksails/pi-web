/**
 * registry — defineCanvasTool / createCanvasRegistry / CanvasToolContext(L2 开发者面;
 * task 2.6,Req 6.1/6.5/3.3)。
 *
 * design.md「defineCanvasTool / CanvasRegistry」:工具声明式定义与 per-instance 注册;
 * 工具轨/overlay/选项条/指针分派的驱动源(6.3 装配在 4.2)。本模块同时承载
 * CanvasTool→RuntimeTool 适配层(design「与 runtime 的桥接」):ToolGestureEvent 的
 * 已换算坐标与命中描述符正是在适配层组装 —— L2 工具只见语义化事件与能力面,
 * 零视口数学/零 DOM 监听/零栈管理(2.2/3.3/4.2 不可见化)。
 *
 * 封装线(task 2.6 边界):本模块只 import
 * - `./types.js` / `./bitmap-io.js`(L2 同层类型),
 * - `./kernel/tool-runtime.js` 的**公开接缝**(RuntimeTool 适配面 + 其再导出的
 *   ToolPointerEvent/LayersReadApi)——不得直接 import stage/pointer/history/layers
 *   内部(L1 能力经 RuntimeToolContext 转交)。
 *
 * 与 design 接口清单的显式裁定(2.4/2.5 留账,tasks.md Implementation Notes):
 * 1. **命中描述符边名 = top/right/bottom/left**(ExpandEdges 键):design 罗盘边
 *    n/e/s/w/ne/… 是幻影 —— DOM 只有四条边手柄(data-canvas-expand-handle 值即
 *    DOM 边名,workbench :1644),扩图状态 canonical 家 ExpandEdges 亦以此为键;
 *    L2 直用同一词汇表零映射成本,罗盘形不落地。
 * 2. **pan 载荷:L2 事件直接携带 client/deltaClient**(design ToolGestureEvent 无
 *    client,但 move 工具需屏幕 px 平移量,:1241-:1248 实证 offset 消费客户端位移)
 *    —— 诚实反映能力面;「零视口数学」纪律由 4.3 grep 线守(携带屏幕位移 ≠ 工具做
 *    视口换算)。连带:`natural` 声明为可空(stage 命中不要求换算可得;up/cancel
 *    无条件派发,rect 失效时坐标缺席但提交语义照旧,2.4 路由现状)。
 * 3. **hit 无 "layer" 分支**:design 片段含 layer 命中,但层拖拽/缩放是工具无关
 *    内核手势(design System Flows/research 决策),路由结构上恒不外派 layer 命中
 *    (2.4 ToolPointerHit = Exclude<…, layer>)—— L2 类型如实收窄,不给作者写
 *    永不可达的分支。
 * 4. **capture 声明化**:是否 pointer capture 由工具决定(text 不捕获,:1142),
 *    但 L2 事件不泄漏 capture() 接缝(工具零 DOM);以声明字段 `capturePointer`
 *    (缺省 true)表达,适配层在 down 首行代为设置(:1109/:1119/:1128 时序)。
 */
import type { ReactNode } from "react";
import type { CanvasOp, ExpandEdges } from "./types.js";
import type { Ctx2DLike } from "./bitmap-io.js";
import {
  createDiagnosticsCollector,
  type DiagnosticsCollector,
  type LayersReadApi,
  type RuntimeTool,
  type RuntimeToolContext,
  type ToolDiagnostic,
  type ToolPointerEvent,
} from "./kernel/tool-runtime.js";

// L2 面复用的接缝类型(index.ts 自本模块统一转发)。
export type { DiagnosticsCollector, LayersReadApi, ToolDiagnostic } from "./kernel/tool-runtime.js";

// ── ToolGestureEvent(L2 语义化手势事件,3.3)────────────────────────────────

/**
 * L2 命中描述符(与 2.4 ToolPointerHit 结构一致,独立声明防 L1 重构外溢):
 * 边名 = ExpandEdges 键(裁定 1);无 layer 分支(裁定 3)。
 */
export type ToolGestureHit =
  | { readonly kind: "overlay" }
  | { readonly kind: "stage" }
  | { readonly kind: "expand-handle"; readonly edge: keyof ExpandEdges };

/**
 * 手势事件:坐标恒为底图像素(L1 已换算,2.2);命中描述符语义化(3.3);
 * client/delta 载荷见头注裁定 2。
 */
export interface ToolGestureEvent {
  /** 已换算底图像素坐标(stage 命中或 rect/natural 不可得的 up/cancel → null)。 */
  readonly natural: { readonly x: number; readonly y: number } | null;
  /** 原始尺寸上下文(笔刷=短边×ratio 类计算所需;未量到 → null;不暴露视口数学)。 */
  readonly naturalSize: { readonly w: number; readonly h: number } | null;
  readonly hit: ToolGestureHit;
  /** 客户端(屏幕 px)坐标(move 平移消费;工具不得据此做视口换算,4.3 grep 线)。 */
  readonly client: { readonly x: number; readonly y: number };
  /** 自 down 起的客户端位移(舞台平移载荷,:1241-:1248)。 */
  readonly deltaClient: { readonly dx: number; readonly dy: number };
  /** 自 down 起的底图像素位移(不可得 → null)。 */
  readonly deltaNatural: { readonly dx: number; readonly dy: number } | null;
  /** 扩图手柄命中:边向外为正的底图像素位移(其余命中恒 null)。 */
  readonly expandDelta: number | null;
}

// ── CanvasToolContext(L1 能力面,design :215)────────────────────────────────

/** 工具本地偏好 KV(annoColor/brushRatio 类;M1 由装配方注入初值,4.2)。 */
export interface CanvasPrefs {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

/** 工具上下文:L1 能力面(工具不触 DOM 事件、不自管栈、不做坐标换算)。 */
export interface CanvasToolContext<TDraft = unknown> {
  readonly draft: {
    get(): TDraft | null;
    set(d: TDraft | null): void; // ref+state 双写由 L1 承担(2.5)
  };
  readonly history: { commit(op: CanvasOp): void }; // push + 清 redo(4.2)
  readonly stage: { panBy(dx: number, dy: number): void };
  readonly layers: LayersReadApi;
  /** up 后延迟动作(text 编辑器挂载防 blur 特例)。 */
  defer(fn: () => void): void;
  readonly prefs: CanvasPrefs;
}

// ── CanvasTool / defineCanvasTool(6.1)───────────────────────────────────────

export interface CanvasTool<TDraft = unknown> {
  readonly id: string; // 内置恒为 `builtin:<name>`(6.2)
  readonly label: string;
  readonly icon: ReactNode;
  readonly cursor?: string;
  /**
   * 手势面是否为 overlay 画布(装配层据此开启 overlay 命中(pointer-events)并施加
   * `cursor`;缺省 false —— move/expand 类舞台级工具不夺 overlay 命中,4.2 装配的
   * overlayInteractive 门控声明化;3.1 绘制族无 overlay 命中守卫,门控是行为前提)。
   */
  readonly overlayInteractive?: boolean;
  /** down 时是否设 pointer capture(缺省 true;text 特例 false —— 裁定 4)。 */
  readonly capturePointer?: boolean;
  onDown?(ev: ToolGestureEvent, ctx: CanvasToolContext<TDraft>): void;
  onMove?(ev: ToolGestureEvent, ctx: CanvasToolContext<TDraft>): void;
  onUp?(ev: ToolGestureEvent, ctx: CanvasToolContext<TDraft>): void;
  /** draft 光栅化(overlay 实时预览);已提交 op 的光栅化经 opKinds 注册。 */
  rasterizeDraft?(ctx2d: Ctx2DLike, draft: TDraft, size: { w: number; h: number }): void;
  /** 选项条贡献(既有 data-* 锚点由内置实现保持)。 */
  optionsBar?(ctx: CanvasToolContext<TDraft>): ReactNode;
  /** DOM 叠层贡献(text 编辑器等)。 */
  overlayReact?(ctx: CanvasToolContext<TDraft>): ReactNode;
  /** 本工具注册的 op 光栅化(开放 CanvasOpKind,4.1/4.4;形状=history OpRasterizer)。 */
  readonly opKinds?: Readonly<
    Record<string, (ctx2d: Ctx2DLike, item: unknown, size: { w: number; h: number }) => void>
  >;
}

/** 声明式定义(恒等 + TDraft 类型收窄;web-kit defineXxx 先例)。 */
export function defineCanvasTool<TDraft = unknown>(tool: CanvasTool<TDraft>): CanvasTool<TDraft> {
  return tool;
}

// ── CanvasRegistry(per-instance,6.5)────────────────────────────────────────

export interface CanvasRegistry {
  /** 注册工具;返回退订。同 id 冲突被拒(先注册者保持)+ 记 diagnostics,退订为 no-op。 */
  registerTool(tool: CanvasTool): () => void;
  /** 工具轨驱动源(注册序稳定枚举,6.3)。 */
  readonly tools: readonly CanvasTool[];
  /** 插件错误诊断(6.4;共享收集器时含 runtime 错误边界条目)。 */
  readonly diagnostics: readonly ToolDiagnostic[];
}

export interface CanvasRegistryOptions {
  /**
   * 诊断收集器(装配层与 ToolRuntime **共用一个**注入,2.5 留账;缺省自建)。
   * registry.diagnostics 直读收集器 entries —— registry 侧追加不 bump runtime
   * 快照(注册发生在装配期而非手势中,UI 按渲染时读取即可)。
   */
  readonly diagnostics?: DiagnosticsCollector;
}

/** per-instance 注册表(同页多画布实例互不串扰,6.5)。 */
export function createCanvasRegistry(options: CanvasRegistryOptions = {}): CanvasRegistry {
  const collector = options.diagnostics ?? createDiagnosticsCollector();
  let tools: readonly CanvasTool[] = [];

  return {
    registerTool: (tool) => {
      if (tools.some((t) => t.id === tool.id)) {
        // design Error Handling「注册冲突」:后注册者被拒并记 diagnostics
        // (不覆盖,防意外顶替内置);冲突条目不带 phase(2.5 留账)。
        collector.add({
          toolId: tool.id,
          error: `duplicate tool id "${tool.id}": registration rejected (first registration kept)`,
          at: Date.now(),
        });
        return () => {};
      }
      tools = [...tools, tool];
      let registered = true;
      return () => {
        if (!registered) return; // 幂等
        registered = false;
        tools = tools.filter((t) => t !== tool);
      };
    },
    get tools() {
      return tools;
    },
    get diagnostics() {
      return collector.entries;
    },
  };
}

// ── prefs store(装配层建店注入初值;ctx.prefs 的承载)────────────────────────

/** prefs 店(get/set 之上加订阅面,供装配层 useSyncExternalStore 适配选项条重渲)。 */
export interface PrefsStore extends CanvasPrefs {
  subscribe(listener: () => void): () => void;
  /** 当前快照(不可变;实效变更即换引用)。 */
  getSnapshot(): Readonly<Record<string, unknown>>;
}

export function createPrefsStore(initial?: Readonly<Record<string, unknown>>): PrefsStore {
  let snapshot: Readonly<Record<string, unknown>> = { ...(initial ?? {}) };
  const listeners = new Set<() => void>();
  return {
    get: <T,>(key: string) => snapshot[key] as T | undefined,
    set: (key, value) => {
      if (key in snapshot && Object.is(snapshot[key], value)) return; // 等值:引用稳定不通知
      snapshot = { ...snapshot, [key]: value };
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

// ── CanvasTool → RuntimeTool 适配层(registry↔runtime 桥,包内装配用)─────────

/** 适配层环境(装配层注入;4.1/4.2 接线)。 */
export interface ToolAdapterEnv {
  /** 源图自然尺寸(ToolGestureEvent.naturalSize 来源;未量到 → null)。 */
  getNaturalSize(): { readonly w: number; readonly h: number } | null;
  /** 工具偏好 KV(createPrefsStore;初值由装配方注入,4.2)。 */
  readonly prefs: CanvasPrefs;
}

/**
 * RuntimeToolContext → CanvasToolContext(L1 能力面加 prefs;4.2 装配的渲染期
 * ctx 亦经此建 —— optionsBar/overlayReact 贡献与手势回调看到**同一** KV/draft 槽,
 * 只是 ctx 包装实例可各建;能力全部直通委托,无状态)。
 */
export function createToolContext(rt: RuntimeToolContext, env: ToolAdapterEnv): CanvasToolContext {
  return {
    draft: {
      get: () => rt.draft.get(),
      set: (d) => rt.draft.set(d),
    },
    history: { commit: (op) => rt.history.commit(op) },
    stage: { panBy: (dx, dy) => rt.stage.panBy(dx, dy) },
    layers: rt.layers,
    defer: (fn) => rt.defer(fn),
    prefs: env.prefs,
  };
}

/**
 * 建适配器:CanvasTool(L2 声明)→ RuntimeTool(2.5 运行时消费面)。
 * - ToolGestureEvent 在此组装(natural 已换算坐标 + 语义化命中,capture 接缝不外泄);
 * - CanvasToolContext 在 RuntimeToolContext 之上加 prefs(其余能力直通);
 * - WeakMap 缓存:同 tool 恒得同 RuntimeTool 引用(setActiveTool 幂等/会话绑定前提);
 * - 错误边界不在此层:工具回调抛错原样穿透,由 ToolRuntime 捕获(6.4 落点唯一)。
 */
export function createToolAdapter(env: ToolAdapterEnv): (tool: CanvasTool) => RuntimeTool {
  const toolCache = new WeakMap<CanvasTool, RuntimeTool>();
  const ctxCache = new WeakMap<RuntimeToolContext, CanvasToolContext>();

  const toGesture = (ev: ToolPointerEvent): ToolGestureEvent => ({
    natural: ev.natural,
    naturalSize: env.getNaturalSize(),
    hit: ev.hit,
    client: ev.client,
    deltaClient: ev.deltaClient,
    deltaNatural: ev.deltaNatural,
    expandDelta: ev.expandDelta,
  });

  const toCtx = (rt: RuntimeToolContext): CanvasToolContext => {
    const cached = ctxCache.get(rt);
    if (cached !== undefined) return cached;
    const ctx = createToolContext(rt, env);
    ctxCache.set(rt, ctx);
    return ctx;
  };

  return (tool) => {
    const cached = toolCache.get(tool);
    if (cached !== undefined) return cached;
    const phase = (
      fn: ((ev: ToolGestureEvent, ctx: CanvasToolContext) => void) | undefined,
    ): ((ev: ToolPointerEvent, rtCtx: RuntimeToolContext) => void) | undefined =>
      fn === undefined ? undefined : (ev, rtCtx) => fn.call(tool, toGesture(ev), toCtx(rtCtx));
    const runtimeTool: RuntimeTool = {
      id: tool.id,
      // down 恒有包装:capture 代设在首行(:1109/:1119/:1128 时序;text 特例不捕获)。
      onDown: (ev, rtCtx) => {
        if (tool.capturePointer !== false) ev.capture();
        tool.onDown?.call(tool, toGesture(ev), toCtx(rtCtx));
      },
      onMove: phase(tool.onMove),
      onUp: phase(tool.onUp),
    };
    toolCache.set(tool, runtimeTool);
    return runtimeTool;
  };
}

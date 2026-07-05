/**
 * kernel/tool-runtime — 工具手势运行时(L1,**不从包根出口导出**;task 2.5,
 * Req 2.2/4.2/6.4)。
 *
 * design.md「L1 集成核 / tool-runtime」:draft 槽 ref+state 双写(复刻 workbench
 * :1120-:1209 时序,含 pointer capture 设置点)、`defer` 队列(up 后执行)、
 * L2 错误边界(抛错 → 禁用工具 + diagnostics + 中止手势,画布不崩)。
 * 本模块同时是 2.4 pointer 路由 `dispatch` 接缝的**真分派实现**:把 ToolPointerEvent
 * 按激活工具映射到工具回调(down→onDown / move→onMove / up **与 cancel**→onUp ——
 * 2.4 留账:旧 `onPointerCancel={onOverlayPointerUp}` 提交语义,workbench :1214 附近)。
 *
 * 行为语义原样迁移自 canvas-workbench(:1105-:1207 手势骨架):
 * - **draft 槽 ref+state 双写**:旧世界 draftRef.current = d; setDraft(d) 成对出现
 *   (:1114-:1115/:1161-:1162 等)—— ref 供 move 高频同步读(React 渲染滞后于指针
 *   事件),state 供渲染订阅。本运行时把双写收进单一 `draft.set()`:先写 ref 通道
 *   (`getDraft()` 同步可读),再换快照并通知(state 通道);工具代码只见一个槽,
 *   双写复杂性不可见化(2.2 证明点)。per-runtime 单槽(现状一次只有一个手势 draft)。
 * - **capture 设置点**:旧代码在 down 分支首行 setPointerCapture(:1109/:1119/:1128),
 *   且 text 工具**不**捕获(:1142-:1153)—— 是否捕获由工具决定,故 capture 经
 *   ToolPointerEvent.capture() 接缝暴露给工具;运行时包装该接缝以**记账**(错误中止
 *   时经注入的 releasePointerCapture 释放;DOM 在正常 up/cancel 自动释放,无须运行时
 *   插手)。运行时不碰真 DOM(释放接缝由装配层实现,缺省 no-op)。
 * - **commit 时序**:up 时经 ctx.history.commit 提交(push + 清 redo,:1188-:1189;
 *   4.2 插件不自行维护栈)+ 清 draft —— 提交与清 draft 都是工具回调的语义(text 不
 *   commit、零长标注丢弃等成型判定属工具),运行时只供能力面。
 * - **defer 队列**:text「up 时才挂编辑器(down 挂载会被同次点击焦点转移 blur 掉)」
 *   特例(:1176-:1181 pendingText)的通用化承载 —— 手势期间 ctx.defer(fn) 入队,
 *   onUp 返回**后**按 FIFO 执行;手势外(含 deferred 回调内)调用立即执行(已在
 *   「up 后」)。错误中止时队列随会话弃置。
 *
 * L2 错误边界(6.4,design「Error Handling」):工具回调(onDown/onMove/onUp/defer)
 * 抛错 = 数据而非异常传播 —— 捕获 → 禁用该工具(后续手势对它 no-op)+ 追加
 * diagnostics(toolId/error/时机)+ 中止当前手势(清 draft、释放已设 capture、弃置
 * defer 队列)→ 运行时自身状态一致,其他工具与画布照常。诊断收集器可经 env 注入
 * (2.6 registry 记注册冲突时与本运行时**共用一个**收集器),缺省自建。
 *
 * 激活工具:setActiveTool/getActiveTool(工具对象由 2.6 registry 持有,运行时只收
 * 引用,不建第二份工具表);手势会话在 down 时绑定当时的激活工具,会话中切换激活
 * 工具不影响进行中的手势(旧世界 move/up 分支由 drawing/draftRef 守卫,同构)。
 * 本任务只定义运行时消费的**最小工具接口**(RuntimeTool);完整 defineCanvasTool
 * (ToolGestureEvent 语义化/prefs/overlay 贡献)是 2.6 的 L2 适配层。
 *
 * useSyncExternalStore 适配契约(照 2.1-2.3 先例):subscribe/getSnapshot,无实效
 * 变更不换引用不通知;StrictMode 幂等(Set 存 listener,双订阅/双退订安全;down
 * 会话独占,重复 down 幂等忽略)。React 不进本模块(纯 TS)。
 */
import type { CanvasOp } from "../types.js";
import type { HistoryStore } from "./history.js";
import type { StageController } from "./stage.js";
import type { LayersReadApi } from "./layers.js";
import type { PointerDispatch, ToolPointerEvent } from "./pointer.js";

// ── L2 公开接缝类型再导出(task 2.6 封装线)────────────────────────────────────
// registry/L2 适配层**只经本模块**消费 L1(不得直接 import pointer/layers 内部)
// —— 本模块签名里出现的接缝类型在此转发,成为 tool-runtime 公开接缝的一部分。
export type { LayersReadApi } from "./layers.js";
export type { PointerDispatch, ToolPointerEvent, ToolPointerHit } from "./pointer.js";

// ── diagnostics(design CanvasRegistry.diagnostics 形状 + 时机字段)─────────────

/**
 * 结构化诊断条目(design「CanvasRegistry」`{toolId; error; at}` 形状的超集:
 * `phase` 记出错时机;2.6 注册冲突条目可不带 phase)。
 */
export interface ToolDiagnostic {
  readonly toolId: string;
  readonly error: string;
  /** 记录时刻(Date.now())。 */
  readonly at: number;
  /** 出错时机(手势相位;"defer" = up 后延迟队列)。 */
  readonly phase?: "down" | "move" | "up" | "cancel" | "defer";
}

/**
 * 诊断收集器(追加式只读列表;`entries` 引用不可变 —— 追加即换新数组,历史快照
 * 持旧引用安全)。2.6 registry 与 tool-runtime 共用一个实例(经 env 注入)。
 */
export interface DiagnosticsCollector {
  add(entry: ToolDiagnostic): void;
  readonly entries: readonly ToolDiagnostic[];
}

export function createDiagnosticsCollector(): DiagnosticsCollector {
  let entries: readonly ToolDiagnostic[] = [];
  return {
    add: (entry) => {
      entries = [...entries, entry];
    },
    get entries() {
      return entries;
    },
  };
}

// ── 最小工具接口(运行时消费面;完整 CanvasTool/defineCanvasTool 在 2.6)─────────

/**
 * 工具回调上下文(L1 能力面):draft 槽/history.commit/stage.panBy/layers 读面/
 * defer。2.6 的 CanvasToolContext 在此之上加 prefs 与 TDraft 泛型收窄 —— L2 只经
 * 本接缝消费 L1(封装线)。
 */
export interface RuntimeToolContext {
  /** draft 槽(ref+state 双写由运行时承担;get 为同步 ref 读,move 高频用)。 */
  readonly draft: {
    get(): unknown;
    set(d: unknown): void;
  };
  /** 历史提交(= push + 清 redo,4.2/4.3;工具不自行维护栈)。 */
  readonly history: { commit(op: CanvasOp): void };
  /** 舞台平移(builtin:move 消费,task 3.2)。 */
  readonly stage: { panBy(dx: number, dy: number): void };
  /** 图层只读面(工具经内核读层,Req 5.1)。 */
  readonly layers: LayersReadApi;
  /** up 后延迟动作(text 编辑器挂载防 blur 特例);手势外调用立即执行。 */
  defer(fn: () => void): void;
}

/** 运行时消费的最小工具形状(手势回调三件;2.6 把 CanvasTool 适配到此)。 */
export interface RuntimeTool {
  readonly id: string;
  onDown?(ev: ToolPointerEvent, ctx: RuntimeToolContext): void;
  onMove?(ev: ToolPointerEvent, ctx: RuntimeToolContext): void;
  onUp?(ev: ToolPointerEvent, ctx: RuntimeToolContext): void;
}

// ── 运行时 ───────────────────────────────────────────────────────────────────

export interface ToolRuntimeEnv {
  /** 历史栈(2.2;commit 即 push+清 redo)。 */
  readonly history: Pick<HistoryStore, "commit">;
  /** 舞台平移能力(2.1;ctx.stage.panBy 直通)。 */
  readonly stage: Pick<StageController, "panBy">;
  /** 图层只读面(2.3;ctx.layers 直通)。 */
  readonly layers: LayersReadApi;
  /**
   * 错误中止时释放 pointer capture 的接缝(装配层实现 releasePointerCapture;
   * 缺省 no-op)。正常 up/cancel 由 DOM 自动释放,运行时不调用。
   */
  readonly releasePointerCapture?: (pointerId: number) => void;
  /** 诊断收集器(2.6 与 registry 共用注入;缺省自建)。 */
  readonly diagnostics?: DiagnosticsCollector;
}

/** 运行时快照(不可变;变更即换新引用,useSyncExternalStore 适配前提)。 */
export interface ToolRuntimeSnapshot {
  /** 当前手势 draft(state 通道;渲染/rasterizeDraft 消费)。 */
  readonly draft: unknown;
  readonly activeToolId: string | null;
  /** 被错误边界禁用的工具 id(工具轨置灰消费,6.4)。 */
  readonly disabledTools: readonly string[];
  readonly diagnostics: readonly ToolDiagnostic[];
}

export interface ToolRuntime {
  /** 2.4 pointer 路由 dispatch 接缝的真实现(createPointerRouter({ dispatch }))。 */
  readonly dispatch: PointerDispatch;
  /**
   * 运行时能力面(与手势回调收到的是**同一** ctx 实例;task 4.2)——装配层渲染期
   * 贡献(optionsBar/overlayReact)需要 draft 槽/defer 等能力在手势外可达(text
   * 编辑器受控输入即经此写 draft),经本成员上交,不另建第二套 draft 通道。
   */
  readonly context: RuntimeToolContext;
  /** 激活工具(null = 无;引用来自 2.6 registry,运行时不持第二份表)。 */
  setActiveTool(tool: RuntimeTool | null): void;
  getActiveTool(): RuntimeTool | null;
  /** draft ref 通道(同步读;move 高频/overlay 光栅化即时值)。 */
  getDraft(): unknown;
  isToolDisabled(toolId: string): boolean;
  /** 诊断只读列表(= 收集器 entries;追加即换引用)。 */
  readonly diagnostics: readonly ToolDiagnostic[];
  /** 变更订阅(返回退订;无实效变更不通知)。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照(未变更时引用稳定)。 */
  getSnapshot(): ToolRuntimeSnapshot;
}

interface GestureSession {
  readonly tool: RuntimeTool;
  readonly pointerId: number;
  /** 工具是否经 ev.capture() 设了 pointer capture(错误中止时据此释放)。 */
  captured: boolean;
  /** defer 队列(onUp 返回后 FIFO 冲刷;错误中止随会话弃置)。 */
  readonly deferred: Array<() => void>;
}

export function createToolRuntime(env: ToolRuntimeEnv): ToolRuntime {
  const diagnostics = env.diagnostics ?? createDiagnosticsCollector();
  const listeners = new Set<() => void>();

  // draft ref 通道(同步读写;快照持同一引用 = state 通道,双写在 set 内完成)。
  let draftRef: unknown = null;
  let activeTool: RuntimeTool | null = null;
  let disabled: readonly string[] = [];
  let session: GestureSession | null = null;

  let snapshot: ToolRuntimeSnapshot = {
    draft: null,
    activeToolId: null,
    disabledTools: disabled,
    diagnostics: diagnostics.entries,
  };

  const bump = (): void => {
    snapshot = {
      draft: draftRef,
      activeToolId: activeTool === null ? null : activeTool.id,
      disabledTools: disabled,
      diagnostics: diagnostics.entries,
    };
    for (const l of listeners) l();
  };

  const ctx: RuntimeToolContext = {
    draft: {
      get: () => draftRef,
      set: (d) => {
        // ref+state 双写:ref 先行(:1114 draftRef.current = d),快照+通知随后
        // (:1115 setDraft(d))—— 通知回调读到的两通道恒一致。
        draftRef = d;
        bump();
      },
    },
    history: { commit: (op) => env.history.commit(op) },
    stage: { panBy: (dx, dy) => env.stage.panBy(dx, dy) },
    layers: env.layers,
    defer: (fn) => {
      const s = session;
      if (s !== null) s.deferred.push(fn);
      else fn(); // 手势外(含 deferred 回调内):已在「up 后」,立即执行
    },
  };

  /** 6.4 错误边界落点:禁用 + 诊断 + 中止手势(清 draft/释放 capture/弃置队列)。 */
  const failTool = (toolId: string, phase: NonNullable<ToolDiagnostic["phase"]>, err: unknown): void => {
    diagnostics.add({
      toolId,
      error: err instanceof Error ? err.message : String(err),
      at: Date.now(),
      phase,
    });
    if (!disabled.includes(toolId)) disabled = [...disabled, toolId];
    const s = session;
    session = null; // 中止手势:后续 move/up 无会话可路由,defer 队列随会话弃置
    if (s !== null && s.captured) env.releasePointerCapture?.(s.pointerId);
    draftRef = null; // 清 draft(双通道:快照在 bump 里同步)
    bump();
  };

  /** 工具回调统一包裹(抛错不外溢;返回是否正常完成)。 */
  const run = (
    toolId: string,
    phase: NonNullable<ToolDiagnostic["phase"]>,
    thunk: (() => void) | undefined,
  ): boolean => {
    if (thunk === undefined) return true;
    try {
      thunk();
      return true;
    } catch (err) {
      failTool(toolId, phase, err);
      return false;
    }
  };

  const dispatch: PointerDispatch = (ev) => {
    if (ev.phase === "down") {
      if (session !== null) return; // 会话独占(路由已守卫;此处幂等兜底)
      const tool = activeTool;
      if (tool === null || disabled.includes(tool.id)) return; // 禁用工具:手势 no-op(6.4)
      const s: GestureSession = { tool, pointerId: ev.pointerId, captured: false, deferred: [] };
      session = s;
      // 包装 capture 接缝记账:工具在 down 内决定是否捕获(text 不捕获,:1142)。
      const wrapped: ToolPointerEvent = {
        ...ev,
        capture: () => {
          s.captured = true;
          ev.capture();
        },
      };
      const onDown = tool.onDown;
      run(tool.id, "down", onDown === undefined ? undefined : () => onDown.call(tool, wrapped, ctx));
      return;
    }
    const s = session;
    if (s === null || s.pointerId !== ev.pointerId) return; // 非会话指针:忽略
    if (ev.phase === "move") {
      const onMove = s.tool.onMove;
      run(s.tool.id, "move", onMove === undefined ? undefined : () => onMove.call(s.tool, ev, ctx));
      return;
    }
    // up | cancel → onUp(2.4 留账:cancel 复刻旧 onPointerCancel=onPointerUp 提交语义)。
    const onUp = s.tool.onUp;
    const ok = run(s.tool.id, ev.phase, onUp === undefined ? undefined : () => onUp.call(s.tool, ev, ctx));
    if (!ok) return; // 错误路径已中止(会话/队列已弃置)
    session = null; // 先收会话:defer 语义 =「up 后」,队列内再 defer 立即执行
    for (const fn of s.deferred) {
      try {
        fn();
      } catch (err) {
        failTool(s.tool.id, "defer", err);
        return; // 剩余 deferred 弃置(肇事工具已禁用)
      }
    }
  };

  return {
    dispatch,
    context: ctx,
    setActiveTool: (tool) => {
      if (tool === activeTool) return; // 幂等:无实效变更不通知(StrictMode 双执行安全)
      activeTool = tool;
      bump();
    },
    getActiveTool: () => activeTool,
    getDraft: () => draftRef,
    isToolDisabled: (toolId) => disabled.includes(toolId),
    get diagnostics() {
      return diagnostics.entries;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

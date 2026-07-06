/**
 * kernel-facade — 交互内核装配门面(L2;task 4.1/4.2,Req 1.3/2.3/3.4/5.1/6.3)。
 *
 * 2.6 留账(tasks.md Implementation Notes)的「包级装配 facade 缺口」补齐:ui 侧装配层
 * (canvas-workbench)受 Req 1.3 约束不得从 kernel/ 内部路径拿件,本模块把 4.1 状态搬家
 * 所需的 stage/history/layers 实例创建**收口为单一装配 API** `createCanvasKernel()`;
 * 4.2 注册表驱动装配再扩充:registry(含 opKinds→光栅化注册接线)/prefs/tools(激活
 * 工具与渲染期能力面)/pointer(唯一路由)/renderOverlay(ops 回放 + 激活工具 draft)。
 *
 * 出口形状裁定(报告随任务上交):
 * - 门面是**收口的装配 API**(create 函数 + 返回能力面),不是 kernel/* 文件的 re-export
 *   (Req 1.3 原文:kernel 内部模块不出现在公开入口 —— 收口指「装配入口唯一」,能力面
 *   类型是 semver 承诺的契约,参照 2.6 registry 经 tool-runtime 接缝转发 LayersReadApi
 *   的先例:选定契约类型可经 L2 模块上桌,内部模块路径与实现件不上桌);
 * - env 访问器(rect/naturalSize/capture 接缝)由装配层注入 —— DOM 量取与 pointer
 *   capture 留装配层(2.1 StageEnv 纪律),kernel 与门面零 DOM 依赖,StrictMode 双建
 *   实例无副作用;
 * - **registry 在门面内包装**:registerTool 成功登记时同步把工具 `opKinds` 接进
 *   history 的 OpRasterizerRegistry(重复 kind 被拒返回 false 是无损语义 —— mask/erase
 *   共享同一 stroke rasterizer,3.1 留账②;注册表驱动的 overlay 回放据此查找);
 * - **renderOverlay 回放序 = ops 提交序**(design System Flows「ops 按 opKinds 回放」;
 *   旧 workbench 分两趟绘制 strokes 全量 → annotations 全量,是双数组时代的产物 ——
 *   开放 kind 注册表下按提交序逐 op 回放是唯一不特判 kind 的语义,预览叠序在
 *   「anno 之后再画/擦 stroke」的交错场景有像素级微差,已留账);
 * - draft 光栅化用**激活工具**的 rasterizeDraft(手势中切激活工具属病理路径:指针
 *   会话在 down 时绑定旧工具,draft 归旧工具,但 UI 上 rail 点击必先 pointerup 收束
 *   会话,实际不可达)。
 */
import { createStageController, type StageController, type RectLike } from "./kernel/stage.js";
import {
  createHistoryStore,
  createOpBehaviorRegistry,
  createOpRasterizerRegistry,
  type HistoryStore,
  type OpBehaviorRegistry,
} from "./kernel/history.js";
import { createLayersStore, type LayersStore } from "./kernel/layers.js";
import {
  createPointerRouter,
  type ElementLike,
  type PointerRouter,
} from "./kernel/pointer.js";
import {
  createDiagnosticsCollector,
  createToolRuntime,
  type ToolRuntimeSnapshot,
} from "./kernel/tool-runtime.js";
import {
  createCanvasRegistry,
  createPrefsStore,
  createToolAdapter,
  createToolContext,
  type CanvasRegistry,
  type CanvasTool,
  type CanvasToolContext,
  type PrefsStore,
} from "./registry.js";
import type { Ctx2DLike } from "./bitmap-io.js";

// 能力面契约类型(semver 承诺;index.ts 自本模块统一转发)。
export type { RectLike, StageController, StageViewport } from "./kernel/stage.js";
export type { HistorySnapshot, HistoryStore, OpBehavior, OpBehaviorRegistry } from "./kernel/history.js";
export type {
  AddLayerInput,
  LayerGesture,
  LayerGestureOrigin,
  LayersSnapshot,
  LayersStore,
} from "./kernel/layers.js";
// 4.2 装配接线契约类型(pointer 入口事件形状/运行时快照;内部模块路径不上桌)。
export type { ElementLike, PointerRouter, RouterPointerEvent } from "./kernel/pointer.js";
export type { ToolRuntimeSnapshot } from "./kernel/tool-runtime.js";
export type { PrefsStore } from "./registry.js";

/** 装配层注入的环境访问器(DOM 量取留装配层;与 2.1 StageEnv 同形,独立命名防 L1 重构外溢)。 */
export interface CanvasKernelEnv {
  /** overlay 元素当前 BoundingClientRect(不可得 → null)。 */
  getRect(): RectLike | null;
  /** 源图自然尺寸(未量到 → null)。 */
  getNaturalSize(): { readonly w: number; readonly h: number } | null;
  /**
   * pointer capture 接缝(装配层实现 setPointerCapture;缺省 no-op)。
   * 路由/工具决定**是否**捕获,DOM 调用留装配层(4.2)。
   */
  capturePointer?(target: ElementLike, pointerId: number): void;
  /** 错误中止时释放 capture 的接缝(缺省 no-op;正常 up/cancel 由 DOM 自动释放)。 */
  releasePointerCapture?(pointerId: number): void;
  /**
   * prefs 初值(4.2 装配注入:annoColor/brushRatio/expandEdges 等既有 state 迁
   * prefs KV;键契约见 PREF_* 常量出口)。
   */
  initialPrefs?: Readonly<Record<string, unknown>>;
}

/** 激活工具与渲染期能力面(4.2 注册表驱动装配的工具通道消费面)。 */
export interface CanvasToolsApi {
  /** 按 id 激活注册表内工具(null / 未知 id = 取消激活)。 */
  setActiveTool(id: string | null): void;
  getActiveToolId(): string | null;
  /** 错误边界禁用查询(6.4;工具轨置灰消费)。 */
  isToolDisabled(id: string): boolean;
  /**
   * 渲染期能力面(optionsBar/overlayReact 贡献注入;与手势回调共享同一
   * draft 槽/history/prefs —— text 编辑器受控输入即经此写 draft)。
   */
  readonly context: CanvasToolContext;
  /** 变更订阅(激活切换/draft 双写/禁用;返回退订)。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照(未变更时引用稳定;useSyncExternalStore 适配)。 */
  getSnapshot(): ToolRuntimeSnapshot;
}

/** 交互内核实例(per mount;各能力面自带 subscribe/getSnapshot 供 useSyncExternalStore)。 */
export interface CanvasKernel {
  /** 舞台视口(scale/offset)与 toNatural 换算(Req 2.1/2.3)。 */
  readonly stage: StageController;
  /** 编辑历史开放栈(commit/undo/redo/clear/prune,Req 4.*)。 */
  readonly history: HistoryStore;
  /**
   * op 撤销行为注册面(M3 裁定书 C:undo 弹栈后调 revert、redo 回栈后调 apply;
   * 未注册 kind 纯栈语义零变)。插件放置类 op 经此挂图层副作用回滚;钩子抛错
   * 隔离进共享诊断收集器(kind:"plugin"),不毁 undo/redo。
   */
  readonly opBehaviors: OpBehaviorRegistry;
  /** 图层树(增删改/命中/手势 reducer,Req 5.1)。 */
  readonly layers: LayersStore;
  /**
   * 工具注册表(per-instance,6.5)。registerTool 在此门面内同步接线工具 `opKinds`
   * → overlay 回放光栅化查找(重复 kind 拒绝 = 无损,3.1 留账②)。
   */
  readonly registry: CanvasRegistry;
  /** 工具偏好 KV(初值经 env.initialPrefs 注入;选项条双向绑定,4.2)。 */
  readonly prefs: PrefsStore;
  /** 激活工具与渲染期能力面。 */
  readonly tools: CanvasToolsApi;
  /** 舞台指针唯一入口(装配层把容器 pointerdown/move/up/cancel 全量喂入,Req 3.*)。 */
  readonly pointer: PointerRouter;
  /**
   * overlay 光栅化:已提交 ops 按注册表回放(提交序)+ 激活工具 rasterizeDraft
   * (进行中手势预览)。清屏归装配层(canvas 元素属 DOM)。
   */
  renderOverlay(ctx2d: Ctx2DLike, size: { readonly w: number; readonly h: number }): void;
}

/** 建一套交互内核(per-instance:同页多画布互不串扰,6.5 同族纪律)。 */
export function createCanvasKernel(env: CanvasKernelEnv): CanvasKernel {
  const stage = createStageController(env);
  // 诊断收集器:registry(注册冲突)/runtime(错误边界)/op 行为钩子(抛错隔离)共用一个
  // (2.5/2.6 裁定;M3 裁定书 C 的 onBehaviorError 汇入)。
  const collector = createDiagnosticsCollector();
  const opBehaviors = createOpBehaviorRegistry();
  const history = createHistoryStore({
    behaviors: opBehaviors,
    onBehaviorError: (kind, phase, err) => {
      collector.add({ toolId: kind, error: `op behavior ${phase} 抛错: ${String(err)}`, at: Date.now(), kind: "plugin" });
    },
  });
  const layers = createLayersStore();
  const rasterizers = createOpRasterizerRegistry();
  const inner = createCanvasRegistry({ diagnostics: collector });

  // registry 包装:登记成功即接线 opKinds(同 id 被拒时不接线,防旁路顶替)。
  const registry: CanvasRegistry = {
    registerTool: (tool) => {
      const before = inner.tools.length;
      const off = inner.registerTool(tool);
      if (inner.tools.length > before && tool.opKinds !== undefined) {
        for (const [kind, fn] of Object.entries(tool.opKinds)) {
          rasterizers.registerRasterizer(kind, fn); // false = 重复 kind,无损忽略
        }
      }
      return off;
    },
    get tools() {
      return inner.tools;
    },
    // 动作面无 opKinds 接线,直通 inner(冲突拒绝/diagnostics/退订语义原样,task 1.2)。
    registerAction: (action) => inner.registerAction(action),
    get actions() {
      return inner.actions;
    },
    // 图层面/禁用面无 opKinds 接线,直通 inner(冲突拒绝/diagnostics/退订/幂等语义原样,
    // task 1.1;门面透传新成员=1.2/M2 先例)。
    registerLayer: (layer) => inner.registerLayer(layer),
    get layers() {
      return inner.layers;
    },
    registerDisabledPluginTool: (toolId, reason) => inner.registerDisabledPluginTool(toolId, reason),
    recordPluginDiagnostic: (bundleId, error) => inner.recordPluginDiagnostic(bundleId, error),
    get disabledPluginTools() {
      return inner.disabledPluginTools;
    },
    get diagnostics() {
      return inner.diagnostics;
    },
  };

  const prefs = createPrefsStore(env.initialPrefs);
  const runtime = createToolRuntime({
    history,
    stage,
    layers,
    diagnostics: collector,
    ...(env.releasePointerCapture !== undefined
      ? { releasePointerCapture: env.releasePointerCapture }
      : {}),
  });
  const adapterEnv = { getNaturalSize: () => env.getNaturalSize(), prefs };
  const adapt = createToolAdapter(adapterEnv);
  const pointer = createPointerRouter({
    stage,
    layers,
    dispatch: runtime.dispatch,
    ...(env.capturePointer !== undefined
      ? { capturePointer: (target: ElementLike, pointerId: number) => env.capturePointer?.(target, pointerId) }
      : {}),
  });
  const context = createToolContext(runtime.context, adapterEnv);

  const toolById = (id: string | null): CanvasTool | undefined =>
    id === null ? undefined : registry.tools.find((t) => t.id === id);

  const tools: CanvasToolsApi = {
    setActiveTool: (id) => {
      const tool = toolById(id);
      runtime.setActiveTool(tool === undefined ? null : adapt(tool));
    },
    getActiveToolId: () => runtime.getActiveTool()?.id ?? null,
    isToolDisabled: (id) => runtime.isToolDisabled(id),
    context,
    subscribe: (listener) => runtime.subscribe(listener),
    getSnapshot: () => runtime.getSnapshot(),
  };

  return {
    stage,
    history,
    opBehaviors,
    layers,
    registry,
    prefs,
    tools,
    pointer,
    renderOverlay: (ctx2d, size) => {
      for (const op of history.ops) {
        rasterizers.getRasterizer(op.kind)?.(ctx2d, op.item, size);
      }
      const draft = runtime.getDraft();
      if (draft === null) return;
      toolById(tools.getActiveToolId())?.rasterizeDraft?.(ctx2d, draft, size);
    },
  };
}

/**
 * @blksails/pi-web-canvas-kit — L2 开发者面唯一出口(出口纪律)。
 *
 * 纪律(Req 1.3/1.4,design.md「Boundary Commitments / L2 公开面」):
 * - 此出口只暴露 L2 开发者面(define* API、hooks、类型)与 bitmap-io 函数;
 * - kernel/ 内部件(L1 集成核:stage/pointer/history/layers/tool-runtime)
 *   **不得**出现在此出口 —— L1 可自由重构,不构成破坏性变更;
 * - 此出口是 semver 承诺面:任何导出的增删改按 semver 语义对待;
 * - 依赖方向:ui 消费 canvas-kit,反向禁止(本包零 @blksails/* 依赖)。
 *
 * 当前已填充:types(canonical 家)+ bitmap-io(task 1.2)、registry/defineCanvasTool
 * (task 2.6)、registerBuiltinTools(task 3.2)、createCanvasKernel 装配门面
 * (task 4.1;收口的装配 API,非 kernel/* re-export)。
 */
// 类型 canonical 家(Annotation/MaskStroke/ExpandEdges/WorkLayer/CanvasOp + LoadedImage)。
export * from "./types.js";
// bitmap-io:client-image-ops 原样迁入(导出清单与原模块逐一对应,Req 5.2)。
export * from "./bitmap-io.js";
// L2 动作契约(task 1.1/1.2,Req 1.1/1.2):动作声明式定义 + 纯函数决策器(值),
// 与 capability/输入/插件/决策结果类型(显式清单;沿出口纪律禁 export *)。
export { defineCanvasAction, resolveAction } from "./actions.js";
export type {
  ActionInput,
  CanvasActionPlugin,
  CanvasCapability,
  ResolveActionOptions,
  ResolvedAction,
} from "./actions.js";
// L2 工具装置(task 2.6,Req 6.1/6.5/3.3):声明式工具定义 + per-instance 注册表。
// 显式清单(1.3 先例:不 export * —— 包内装配件 createToolAdapter/createPrefsStore
// 等不进公开面;4.1 裁定:二者属工具接线,4.2 注册表驱动装配时再按需经门面收口)。
export { defineCanvasTool, createCanvasRegistry } from "./registry.js";
export type {
  CanvasPrefs,
  CanvasRegistry,
  CanvasRegistryOptions,
  CanvasTool,
  CanvasToolContext,
  DiagnosticsCollector,
  LayersReadApi,
  ToolDiagnostic,
  ToolGestureEvent,
  ToolGestureHit,
} from "./registry.js";
// 8 内置工具汇总注册(task 3.2,Req 6.2/6.3):单个工具不出口(经注册表枚举消费);
// prefs 键契约(4.2 装配注入初值同键)= 下列 PREF_* 常量 + 笔刷档位基数。
export { registerBuiltinTools } from "./builtin/index.js";
export { BRUSH_RATIOS, PREF_ANNO_COLOR, PREF_BRUSH_RATIO } from "./builtin/shared.js";
export { PREF_EXPAND_EDGES } from "./builtin/expand.js";
// 交互内核装配门面(task 4.1/4.2,Req 1.3/2.3/3.4/5.1/6.3):stage/history/layers +
// registry/prefs/tools/pointer/renderOverlay 实例创建收口为单一装配 API
// (能力面契约类型随之上桌;kernel 内部模块路径不出口)。
export { createCanvasKernel } from "./kernel-facade.js";
export type {
  AddLayerInput,
  CanvasKernel,
  CanvasKernelEnv,
  CanvasToolsApi,
  ElementLike,
  HistorySnapshot,
  HistoryStore,
  LayerGesture,
  LayerGestureOrigin,
  LayersSnapshot,
  LayersStore,
  PointerRouter,
  PrefsStore,
  RectLike,
  RouterPointerEvent,
  StageController,
  StageViewport,
  ToolRuntimeSnapshot,
} from "./kernel-facade.js";

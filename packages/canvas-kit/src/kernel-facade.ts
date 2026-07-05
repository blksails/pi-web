/**
 * kernel-facade — 交互内核装配门面(L2;task 4.1,Req 1.3/2.3/5.1)。
 *
 * 2.6 留账(tasks.md Implementation Notes)的「包级装配 facade 缺口」补齐:ui 侧装配层
 * (canvas-workbench)受 Req 1.3 约束不得从 kernel/ 内部路径拿件,本模块把 4.1 状态搬家
 * 所需的 stage/history/layers 实例创建**收口为单一装配 API** `createCanvasKernel()`。
 *
 * 出口形状裁定(报告随任务上交):
 * - 门面是**收口的装配 API**(create 函数 + 返回能力面),不是 kernel/* 文件的 re-export
 *   (Req 1.3 原文:kernel 内部模块不出现在公开入口 —— 收口指「装配入口唯一」,能力面
 *   类型是 semver 承诺的契约,参照 2.6 registry 经 tool-runtime 接缝转发 LayersReadApi
 *   的先例:选定契约类型可经 L2 模块上桌,内部模块路径与实现件不上桌);
 * - env 访问器(rect/naturalSize)由装配层注入 —— DOM 量取留装配层(2.1 StageEnv
 *   纪律),kernel 与门面零 DOM 依赖,StrictMode 双建实例无副作用;
 * - pointer/tool-runtime 不在本门面(4.2 注册表驱动接线时按需扩充,保守收口)。
 */
import { createStageController, type StageController, type RectLike } from "./kernel/stage.js";
import { createHistoryStore, type HistoryStore } from "./kernel/history.js";
import { createLayersStore, type LayersStore } from "./kernel/layers.js";

// 能力面契约类型(semver 承诺;index.ts 自本模块统一转发)。
export type { RectLike, StageController, StageViewport } from "./kernel/stage.js";
export type { HistorySnapshot, HistoryStore } from "./kernel/history.js";
export type {
  AddLayerInput,
  LayerGesture,
  LayerGestureOrigin,
  LayersSnapshot,
  LayersStore,
} from "./kernel/layers.js";

/** 装配层注入的环境访问器(DOM 量取留装配层;与 2.1 StageEnv 同形,独立命名防 L1 重构外溢)。 */
export interface CanvasKernelEnv {
  /** overlay 元素当前 BoundingClientRect(不可得 → null)。 */
  getRect(): RectLike | null;
  /** 源图自然尺寸(未量到 → null)。 */
  getNaturalSize(): { readonly w: number; readonly h: number } | null;
}

/** 交互内核实例(per mount;各能力面自带 subscribe/getSnapshot 供 useSyncExternalStore)。 */
export interface CanvasKernel {
  /** 舞台视口(scale/offset)与 toNatural 换算(Req 2.1/2.3)。 */
  readonly stage: StageController;
  /** 编辑历史开放栈(commit/undo/redo/clear/prune,Req 4.*)。 */
  readonly history: HistoryStore;
  /** 图层树(增删改/命中/手势 reducer,Req 5.1)。 */
  readonly layers: LayersStore;
}

/** 建一套交互内核(per-instance:同页多画布互不串扰,6.5 同族纪律)。 */
export function createCanvasKernel(env: CanvasKernelEnv): CanvasKernel {
  return {
    stage: createStageController(env),
    history: createHistoryStore(),
    layers: createLayersStore(),
  };
}

/**
 * kernel/history — 编辑历史开放栈 + OpKind 光栅化注册(L1,**不从包根出口导出**;
 * task 2.2,Req 4.1/4.3/4.4)。
 *
 * design.md「CanvasOp / History(开放栈)」HistoryApi 为契约面;File Structure:
 * kernel/history.ts = 「开放 op 栈(push 清 redo/undo/redo)+ OpKind 光栅化注册」。
 *
 * 行为语义原样迁移自 canvas-workbench(时机逐一致):
 * - commit = push + **清空重做栈**(:1188-1189/:1202-1203/:1221-1222 的
 *   `setOps([...ops, op]); setRedoOps([])`;4.3 清 redo 时机 = 提交新 op 时,
 *   undo/redo 本身不清);
 * - undo = 弹 ops 顶入 redoOps(:1229-1231);redo = 反向(:1233-1237);
 *   空栈守卫 = 无操作;
 * - kind 为开放字符串(4.1),栈对自定义 kind 与内置 "stroke"/"anno" 一视同仁
 *   (4.4)—— 本模块不设 kind 白名单、不按 kind 分派;
 * - clear = 双栈清空(:557-558 换图复位 / :1878-1879 编辑摘要「清除」按钮)。
 *
 * useSyncExternalStore 适配契约(hook 本体在 L2/装配层,React 不进本模块):
 * subscribe/getSnapshot;**未变更时快照引用稳定**(no-op 不换引用、不通知,
 * 否则 React 无限重渲 —— 参照 2.1 stage getViewport 稳定快照先例)。
 *
 * OpKind 光栅化注册表:kind → rasterizer 查找表(per-instance)。3.1 的工具
 * `opKinds` 声明(经 2.6 registry 接线)与 4.2 的 overlay 已提交 ops 回放均消费
 * 此机制;rasterizer 签名与 design `CanvasTool.opKinds` 逐一致
 * (`(ctx2d, item, size) => void`)。重复注册同 kind:后注册者被拒、不覆盖
 * (design「注册冲突:后注册者被拒并记 diagnostics」同族策略 —— diagnostics
 * 记录归 2.6 registry,本层以布尔返回值上交冲突事实)。
 */
import type { CanvasOp } from "../types.js";
import type { Ctx2DLike } from "../bitmap-io.js";

// ── HistoryStore(开放 op 栈)─────────────────────────────────────────────────

/** 历史快照(不可变;变更即换新引用,useSyncExternalStore 适配前提)。 */
export interface HistorySnapshot {
  readonly ops: readonly CanvasOp[];
  readonly redoOps: readonly CanvasOp[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * HistoryApi(design「CanvasOp / History」契约面)+ store 适配面。
 *
 * ops/canUndo/canRedo 为**属性访问器**(design HistoryApi 形状);subscribe/
 * getSnapshot 供 useSyncExternalStore 适配;clear 为装配复位语义(:557/:1878)。
 */
export interface HistoryStore {
  /** push + 清空重做栈(4.3 时机;工具插件经 ToolContext 提交,4.2)。 */
  commit(op: CanvasOp): void;
  /** 弹 ops 顶入 redo 栈;空栈无操作。 */
  undo(): void;
  /** 弹 redo 顶回 ops;空栈无操作。 */
  redo(): void;
  /** 已提交操作(不可变数组;overlay 回放消费)。 */
  readonly ops: readonly CanvasOp[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 双栈清空(换图/应用结果后的复位语义)。 */
  clear(): void;
  /** 变更订阅(返回退订;无实效变更不通知)。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照(未变更时引用稳定)。 */
  getSnapshot(): HistorySnapshot;
}

export function createHistoryStore(): HistoryStore {
  let snapshot: HistorySnapshot = { ops: [], redoOps: [], canUndo: false, canRedo: false };
  const listeners = new Set<() => void>();

  const commitState = (ops: readonly CanvasOp[], redoOps: readonly CanvasOp[]): void => {
    snapshot = { ops, redoOps, canUndo: ops.length > 0, canRedo: redoOps.length > 0 };
    for (const l of listeners) l();
  };

  return {
    commit: (op) => {
      // workbench :1188-1189 语义:提交新 op 即入栈并清空重做栈(开放 kind,无白名单)。
      commitState([...snapshot.ops, op], []);
    },
    undo: () => {
      if (snapshot.ops.length === 0) return; // :1230 空栈守卫
      const last = snapshot.ops[snapshot.ops.length - 1]!;
      commitState(snapshot.ops.slice(0, -1), [...snapshot.redoOps, last]);
    },
    redo: () => {
      if (snapshot.redoOps.length === 0) return; // :1234 空栈守卫
      const last = snapshot.redoOps[snapshot.redoOps.length - 1]!;
      commitState([...snapshot.ops, last], snapshot.redoOps.slice(0, -1));
    },
    clear: () => {
      if (snapshot.ops.length === 0 && snapshot.redoOps.length === 0) return; // no-op:引用稳定
      commitState([], []);
    },
    get ops() {
      return snapshot.ops;
    },
    get canUndo() {
      return snapshot.canUndo;
    },
    get canRedo() {
      return snapshot.canRedo;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

// ── OpKind 光栅化注册表(kind → rasterizer 查找)──────────────────────────────

/**
 * 已提交 op 的光栅化回调(design `CanvasTool.opKinds` 值形状逐一致)。
 * 具体 stroke/anno 实现由 3.1 内置工具注册,本模块只建查找机制。
 */
export type OpRasterizer = (
  ctx2d: Ctx2DLike,
  item: unknown,
  size: { readonly w: number; readonly h: number },
) => void;

export interface OpRasterizerRegistry {
  /** 注册 kind 光栅化;同 kind 重复注册被拒(返回 false,先注册者保持)。 */
  registerRasterizer(kind: string, fn: OpRasterizer): boolean;
  /** 查询 kind 光栅化;未注册 → undefined(overlay 回放据此跳过)。 */
  getRasterizer(kind: string): OpRasterizer | undefined;
  hasRasterizer(kind: string): boolean;
  /** 已注册 kind 清单(注册序;诊断/测试用)。 */
  readonly kinds: readonly string[];
}

/** per-instance 注册表(6.5 同族纪律:实例间互不串扰)。 */
export function createOpRasterizerRegistry(): OpRasterizerRegistry {
  const table = new Map<string, OpRasterizer>();
  return {
    registerRasterizer: (kind, fn) => {
      if (table.has(kind)) return false; // 拒绝覆盖(防意外顶替内置)
      table.set(kind, fn);
      return true;
    },
    getRasterizer: (kind) => table.get(kind),
    hasRasterizer: (kind) => table.has(kind),
    get kinds() {
      return [...table.keys()];
    },
  };
}

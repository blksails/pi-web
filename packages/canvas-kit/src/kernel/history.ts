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
  /**
   * 按谓词过滤已提交 ops(true=保留)并**清空重做栈**(workbench :722-:731
   * consumeSent 语义:发送后只清「本次发送时存在的」项,飞行期新输入不被吞;
   * 旧实现恒 `setRedoOps([])` —— 零剔除也清 redo)。
   * 无实效变更(零剔除且 redo 已空)→ no-op(引用稳定,不通知)。
   */
  prune(keep: (op: CanvasOp) => boolean): void;
  /** 变更订阅(返回退订;无实效变更不通知)。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照(未变更时引用稳定)。 */
  getSnapshot(): HistorySnapshot;
}

/**
 * createHistoryStore 装配选项(全可选;缺省 = 既有纯栈语义逐字节零变)。
 *
 * behaviors:op 行为钩子注册表(裁定书 C);undo 弹栈**后**按 op.kind 查 revert、
 * redo 回栈**后**查 apply。未注册 kind(内置 stroke/anno 不注册)→ 查空 → 纯栈零变。
 * onBehaviorError:钩子抛错诊断汇(缺省 = 静默吞;facade 装配注入共享收集器)。
 */
export interface HistoryStoreOptions {
  readonly behaviors?: OpBehaviorRegistry;
  onBehaviorError?(kind: string, phase: "revert" | "apply", err: unknown): void;
}

export function createHistoryStore(options?: HistoryStoreOptions): HistoryStore {
  let snapshot: HistorySnapshot = { ops: [], redoOps: [], canUndo: false, canRedo: false };
  const listeners = new Set<() => void>();

  const commitState = (ops: readonly CanvasOp[], redoOps: readonly CanvasOp[]): void => {
    snapshot = { ops, redoOps, canUndo: ops.length > 0, canRedo: redoOps.length > 0 };
    for (const l of listeners) l();
  };

  /**
   * 栈变更**后**调 op 行为钩子(裁定书 C 时机;抛错隔离不崩 + 诊断)。未注册 kind
   * 或缺该相位钩子 → 提前返回(纯栈语义零变,守恒证据)。钩子上下文(layers 等)由
   * 注册方闭包捕获——history 是 L1 独立核,不持 layers 引用(最小签名 fn(op))。
   */
  const runBehavior = (phase: "revert" | "apply", op: CanvasOp): void => {
    const behavior = options?.behaviors?.getOpBehavior(op.kind);
    const fn = phase === "revert" ? behavior?.revert : behavior?.apply;
    if (fn === undefined) return; // 未注册 kind / 缺相位:纯栈语义零变
    try {
      fn(op);
    } catch (err) {
      options?.onBehaviorError?.(op.kind, phase, err); // 隔离:钩子抛错不冒泡毁 undo/redo
    }
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
      runBehavior("revert", last); // 弹栈后调 revert(裁定书 C 时机)
    },
    redo: () => {
      if (snapshot.redoOps.length === 0) return; // :1234 空栈守卫
      const last = snapshot.redoOps[snapshot.redoOps.length - 1]!;
      commitState([...snapshot.ops, last], snapshot.redoOps.slice(0, -1));
      runBehavior("apply", last); // 回栈后调 apply(裁定书 C 时机)
    },
    clear: () => {
      if (snapshot.ops.length === 0 && snapshot.redoOps.length === 0) return; // no-op:引用稳定
      commitState([], []);
    },
    prune: (keep) => {
      const kept = snapshot.ops.filter(keep);
      if (kept.length === snapshot.ops.length && snapshot.redoOps.length === 0) return; // no-op:引用稳定
      commitState(kept.length === snapshot.ops.length ? snapshot.ops : kept, []);
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

// ── OpBehavior 注册表(kind → revert/apply 撤销行为查找;裁定书 C)────────────────

/**
 * op 行为钩子(裁定书 C:图层撤销经 revert/apply 可选钩子,L1 additive)。
 *
 * 贴纸放置 op:revert=移除图层、apply=重放。两相位均可选(只声明所需相位)。
 *
 * 签名 `fn(op)` 为最小形态:history 是 L1 独立核,不持 layers 引用
 * (createLayersStore 在 facade 独立创建)——layers 等上下文由**注册方**(装配层/
 * 插件)在注册时闭包捕获,避免 history→layers 耦合。undo 弹栈**后**调 revert、
 * redo 回栈**后**调 apply;钩子内观察到的 store 快照已含本次栈变更。
 */
export interface OpBehavior {
  /** undo 弹栈后:撤销该 op 的图层副作用(op 已出 ops 栈、入 redo 栈)。 */
  revert?(op: CanvasOp): void;
  /** redo 回栈后:重放该 op 的图层副作用(op 已回 ops 栈)。 */
  apply?(op: CanvasOp): void;
}

export interface OpBehaviorRegistry {
  /** 注册 kind 行为;同 kind 重复注册被拒(返回 false,先注册者保持)。 */
  registerOpBehavior(kind: string, behavior: OpBehavior): boolean;
  /** 查询 kind 行为;未注册 → undefined(undo/redo 据此走纯栈语义)。 */
  getOpBehavior(kind: string): OpBehavior | undefined;
  hasOpBehavior(kind: string): boolean;
  /** 已注册 kind 清单(注册序;诊断/测试用)。 */
  readonly kinds: readonly string[];
}

/** per-instance 注册表(6.5 同族纪律:实例间互不串扰;策略同 OpRasterizerRegistry)。 */
export function createOpBehaviorRegistry(): OpBehaviorRegistry {
  const table = new Map<string, OpBehavior>();
  return {
    registerOpBehavior: (kind, behavior) => {
      if (table.has(kind)) return false; // 拒绝覆盖(防意外顶替先注册者)
      table.set(kind, behavior);
      return true;
    },
    getOpBehavior: (kind) => table.get(kind),
    hasOpBehavior: (kind) => table.has(kind),
    get kinds() {
      return [...table.keys()];
    },
  };
}

/**
 * kernel/history revert/apply 可选钩子单测(task 1.2,Req 1.6;design.md「裁定书 C」+
 * 「history 钩子:registerOpBehavior(kind, { revert?, apply? })」;research.md「图层契约与
 * 拍平/撤销链」)。
 *
 * 裁定书 C:图层撤销经 history revert/apply 可选钩子(L1 additive);贴纸放置 op
 * revert=移除图层、apply=重放;未注册 kind(内置 stroke/anno)纯栈语义零变=行为守恒。
 *
 * 最小签名裁定(报告 CONCERNS 详述):history 是 L1 独立核,不持有 layers 引用
 * (createLayersStore 在 facade 独立创建),故钩子取最小 `revert(op)`/`apply(op)`,
 * layers 等上下文由**注册方**(装配层/插件)闭包捕获——与 design:165「revert(op, layers)」
 * 的差异是为不引入 history→layers 耦合(任务书授权此闭包形态)。
 *
 * 时机(裁定 C):undo 弹栈**后**调 revert(op)、redo 回栈**后**调 apply(op)——
 * 钩子内观察到的 store 快照已含本次栈变更。
 *
 * kernel/ 是 L1,不从包根出口导出——本测试走内部路径 import。
 */
import { describe, it, expect, vi } from "vitest";
import type { CanvasOp } from "../src/types.js";
import {
  createHistoryStore,
  createOpBehaviorRegistry,
  type OpBehavior,
} from "../src/kernel/history.js";

const op = (kind: string, item: unknown = null): CanvasOp => ({ kind, item });

describe("kernel/history createOpBehaviorRegistry(op 行为注册表)", () => {
  it("注册后可查:hasOpBehavior/getOpBehavior/kinds", () => {
    const reg = createOpBehaviorRegistry();
    const b: OpBehavior = { revert: () => {}, apply: () => {} };
    expect(reg.registerOpBehavior("stickers:place", b)).toBe(true);
    expect(reg.hasOpBehavior("stickers:place")).toBe(true);
    expect(reg.getOpBehavior("stickers:place")).toBe(b);
    expect(reg.hasOpBehavior("unknown")).toBe(false);
    expect(reg.getOpBehavior("unknown")).toBeUndefined();
    expect(reg.kinds).toEqual(["stickers:place"]);
  });

  it("同 kind 重复注册被拒(返回 false,先注册者保持;照 OpRasterizerRegistry 同族策略)", () => {
    const reg = createOpBehaviorRegistry();
    const first: OpBehavior = { revert: () => {} };
    const second: OpBehavior = { revert: () => {} };
    expect(reg.registerOpBehavior("stickers:place", first)).toBe(true);
    expect(reg.registerOpBehavior("stickers:place", second)).toBe(false);
    expect(reg.getOpBehavior("stickers:place")).toBe(first); // 先注册者保持
  });

  it("per-instance:两注册表互不串扰(6.5 同族纪律)", () => {
    const a = createOpBehaviorRegistry();
    const b = createOpBehaviorRegistry();
    a.registerOpBehavior("k", { revert: () => {} });
    expect(a.hasOpBehavior("k")).toBe(true);
    expect(b.hasOpBehavior("k")).toBe(false);
  });
});

describe("kernel/history createHistoryStore 钩子接线(undo 调 revert / redo 调 apply)", () => {
  it("undo 弹栈后调注册 kind 的 revert(op),钩子内观察到 op 已出 ops 栈", () => {
    const behaviors = createOpBehaviorRegistry();
    const seen: { op: CanvasOp | null; opsLen: number; redoLen: number } = {
      op: null,
      opsLen: -1,
      redoLen: -1,
    };
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("stickers:place", {
      revert: (o) => {
        seen.op = o;
        seen.opsLen = h.ops.length; // 弹栈后:本 op 已不在 ops
        seen.redoLen = h.getSnapshot().redoOps.length; // 已入 redo
      },
    });
    const placed = op("stickers:place", { layerId: "layer-1" });
    h.commit(placed);
    h.undo();
    expect(seen.op).toBe(placed);
    expect(seen.opsLen).toBe(0); // 弹栈后 ops 已空
    expect(seen.redoLen).toBe(1); // 已入 redo
  });

  it("redo 回栈后调注册 kind 的 apply(op),钩子内观察到 op 已回 ops 栈", () => {
    const behaviors = createOpBehaviorRegistry();
    const seen: { op: CanvasOp | null; opsLen: number } = { op: null, opsLen: -1 };
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("stickers:place", {
      apply: (o) => {
        seen.op = o;
        seen.opsLen = h.ops.length; // 回栈后:本 op 已在 ops
      },
    });
    const placed = op("stickers:place", { layerId: "layer-1" });
    h.commit(placed);
    h.undo();
    h.redo();
    expect(seen.op).toBe(placed);
    expect(seen.opsLen).toBe(1); // 回栈后 ops 含本 op
  });

  it("只注册 revert(无 apply):undo 调 revert,redo 不崩(apply 缺省跳过)", () => {
    const behaviors = createOpBehaviorRegistry();
    const revert = vi.fn();
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("k", { revert });
    const a = op("k");
    h.commit(a);
    h.undo();
    expect(revert).toHaveBeenCalledTimes(1);
    expect(() => h.redo()).not.toThrow(); // 无 apply:纯栈回滚
    expect(h.ops).toEqual([a]);
  });

  it("commit 本身不触发 revert/apply(只 undo/redo 触发)", () => {
    const behaviors = createOpBehaviorRegistry();
    const revert = vi.fn();
    const apply = vi.fn();
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("k", { revert, apply });
    h.commit(op("k"));
    expect(revert).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("kernel/history 未注册 kind 纯栈语义零变(守恒:内置 stroke/anno 不注册)", () => {
  it("未注册 kind:undo/redo 不调任何钩子,栈行为与无 behaviors 逐字节一致", () => {
    const behaviors = createOpBehaviorRegistry();
    behaviors.registerOpBehavior("stickers:place", { revert: () => {}, apply: () => {} });

    // 带 behaviors 的 store,但只提交未注册 kind(stroke/anno)。
    const withReg = createHistoryStore({ behaviors });
    // 对照:无 behaviors 的纯栈 store(既有形态)。
    const plain = createHistoryStore();

    const seq = [op("stroke", { s: 1 }), op("anno", { a: 2 }), op("stroke", { s: 3 })];
    for (const o of seq) {
      withReg.commit(o);
      plain.commit(o);
    }
    withReg.undo();
    plain.undo();
    withReg.undo();
    plain.undo();
    withReg.redo();
    plain.redo();

    // 两 store 快照逐字段一致(未注册 kind 不改栈语义)。
    expect(withReg.getSnapshot()).toEqual(plain.getSnapshot());
    expect(withReg.ops).toEqual(plain.ops);
    expect(withReg.canUndo).toBe(plain.canUndo);
    expect(withReg.canRedo).toBe(plain.canRedo);
  });

  it("混合栈:注册 kind 触发钩子、未注册 kind 不触发", () => {
    const behaviors = createOpBehaviorRegistry();
    const revert = vi.fn();
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("stickers:place", { revert });
    h.commit(op("stroke")); // 未注册
    h.commit(op("stickers:place")); // 注册
    h.undo(); // 弹 stickers:place → 调 revert
    expect(revert).toHaveBeenCalledTimes(1);
    revert.mockClear();
    h.undo(); // 弹 stroke → 不调
    expect(revert).not.toHaveBeenCalled();
  });
});

describe("kernel/history 钩子抛错隔离(不崩 + 诊断)", () => {
  it("revert 抛错:捕获后 store 不崩,栈变更仍生效,onBehaviorError 收到诊断", () => {
    const behaviors = createOpBehaviorRegistry();
    const onBehaviorError = vi.fn();
    const boom = new Error("revert boom");
    const h = createHistoryStore({ behaviors, onBehaviorError });
    behaviors.registerOpBehavior("k", {
      revert: () => {
        throw boom;
      },
    });
    const a = op("k");
    h.commit(a);
    expect(() => h.undo()).not.toThrow(); // 不崩
    // 栈变更在钩子之前已 commit(弹栈生效)。
    expect(h.ops).toEqual([]);
    expect(h.canRedo).toBe(true);
    expect(onBehaviorError).toHaveBeenCalledTimes(1);
    expect(onBehaviorError).toHaveBeenCalledWith("k", "revert", boom);
  });

  it("apply 抛错:捕获后 store 不崩,栈变更仍生效,onBehaviorError 收到诊断", () => {
    const behaviors = createOpBehaviorRegistry();
    const onBehaviorError = vi.fn();
    const boom = new Error("apply boom");
    const h = createHistoryStore({ behaviors, onBehaviorError });
    behaviors.registerOpBehavior("k", {
      apply: () => {
        throw boom;
      },
    });
    const a = op("k");
    h.commit(a);
    h.undo();
    expect(() => h.redo()).not.toThrow(); // 不崩
    expect(h.ops).toEqual([a]); // 回栈生效
    expect(onBehaviorError).toHaveBeenCalledTimes(1);
    expect(onBehaviorError).toHaveBeenCalledWith("k", "apply", boom);
  });

  it("钩子抛错但无 onBehaviorError 汇:静默吞不崩(诊断汇可选)", () => {
    const behaviors = createOpBehaviorRegistry();
    const h = createHistoryStore({ behaviors });
    behaviors.registerOpBehavior("k", {
      revert: () => {
        throw new Error("boom");
      },
    });
    h.commit(op("k"));
    expect(() => h.undo()).not.toThrow();
    expect(h.ops).toEqual([]);
  });
});

// ── 门面接线(装配层可达性;1.2 任务书「注册面暴露:经 kernel-facade」)────────────────
import { createCanvasKernel } from "../src/kernel-facade.js";

const kernelEnv = {
  getRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  getNaturalSize: () => ({ w: 100, h: 100 }),
} as never;

describe("kernel-facade opBehaviors 接线(装配层可达)", () => {
  it("kernel.opBehaviors 注册后 undo/redo 触发 revert/apply(同一 history 实例接线)", () => {
    const k = createCanvasKernel(kernelEnv);
    const seen: string[] = [];
    expect(
      k.opBehaviors.registerOpBehavior("stickers:place", {
        revert: () => seen.push("revert"),
        apply: () => seen.push("apply"),
      }),
    ).toBe(true);
    k.history.commit(op("stickers:place"));
    k.history.undo();
    k.history.redo();
    expect(seen).toEqual(["revert", "apply"]);
  });

  it("钩子抛错经门面汇入共享诊断收集器(kind:plugin),undo 不崩", () => {
    const k = createCanvasKernel(kernelEnv);
    k.opBehaviors.registerOpBehavior("stickers:place", {
      revert: () => {
        throw new Error("boom");
      },
    });
    k.history.commit(op("stickers:place"));
    expect(() => k.history.undo()).not.toThrow();
    const entry = k.registry.diagnostics.find((d) => d.toolId === "stickers:place");
    expect(entry?.kind).toBe("plugin");
    expect(entry?.error).toContain("revert");
  });

  it("per-instance:两 kernel 的 opBehaviors 互不串扰", () => {
    const a = createCanvasKernel(kernelEnv);
    const b = createCanvasKernel(kernelEnv);
    a.opBehaviors.registerOpBehavior("x", { revert: () => {} });
    expect(a.opBehaviors.hasOpBehavior("x")).toBe(true);
    expect(b.opBehaviors.hasOpBehavior("x")).toBe(false);
  });
});

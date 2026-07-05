/**
 * kernel/history 单测(task 2.2,Req 4.1/4.3/4.4;design.md「Testing Strategy / Unit Tests #3」)。
 *
 * 行为语义复刻自 canvas-workbench(golden 期望按旧实现手推,不从新实现反推):
 * - commit = push + 清 redo:workbench :1188-1189/:1202-1203/:1221-1222
 *   (`setOps([...ops, op]); setRedoOps([])` —— 每次提交新 op 即清空重做栈,时机 4.3);
 * - undo:弹 ops 顶入 redoOps(:1229-1231);redo:反向(:1233-1237);
 *   空栈守卫 = 无操作(:1230 `if (ops.length === 0) return`);
 * - kind 开放注册(4.1):`{kind: string, item: unknown}`,自定义 kind 与内置
 *   "stroke"/"anno" 一视同仁(4.4)—— 栈不检查 kind 白名单;
 * - useSyncExternalStore 适配契约:getSnapshot 未变更时**引用稳定**(否则 React
 *   无限重渲;参照 2.1 stage getViewport 稳定快照先例);
 * - OpKind 光栅化注册表:kind→rasterizer 查找;重复注册同 kind 拒绝覆盖(照 design
 *   「注册冲突:后注册者被拒,不覆盖」的同族策略);per-instance 互不串扰。
 *
 * 注意:kernel/ 是 L1,不从包根出口导出 —— 本测试走内部路径 import(出口纪律见
 * index-exports.test.ts 快照)。
 */
import { describe, it, expect, vi } from "vitest";
import type { CanvasOp } from "../src/types.js";
import type { Ctx2DLike } from "../src/bitmap-io.js";
import {
  createHistoryStore,
  createOpRasterizerRegistry,
  type OpRasterizer,
} from "../src/kernel/history.js";

const op = (kind: string, item: unknown = null): CanvasOp => ({ kind, item });

describe("kernel/history createHistoryStore(开放栈)", () => {
  it("初始态:双栈空,canUndo/canRedo 皆 false", () => {
    const h = createHistoryStore();
    expect(h.ops).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("commit 依序入栈(4.1 开放 kind:字符串即合法,无白名单)", () => {
    const h = createHistoryStore();
    const a = op("stroke", { size: 4 });
    const b = op("anno", { kind: "arrow" });
    const c = op("plugin:sticker", { id: "s1" });
    h.commit(a);
    h.commit(b);
    h.commit(c);
    expect(h.ops).toEqual([a, b, c]);
    expect(h.canUndo).toBe(true);
  });

  it("undo:弹 ops 顶入 redo 栈(:1229-1231 语义)", () => {
    const h = createHistoryStore();
    const a = op("stroke");
    const b = op("anno");
    h.commit(a);
    h.commit(b);
    h.undo();
    expect(h.ops).toEqual([a]);
    expect(h.canRedo).toBe(true);
    h.undo();
    expect(h.ops).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it("redo:弹 redo 顶回 ops(:1233-1237 语义,LIFO 次序还原)", () => {
    const h = createHistoryStore();
    const a = op("stroke");
    const b = op("anno");
    h.commit(a);
    h.commit(b);
    h.undo();
    h.undo();
    h.redo();
    expect(h.ops).toEqual([a]); // redo 栈顶是最后被 undo 的 a
    h.redo();
    expect(h.ops).toEqual([a, b]);
    expect(h.canRedo).toBe(false);
  });

  it("清 redo 时机(4.3):**commit 时**清空,undo/redo 本身不清", () => {
    const h = createHistoryStore();
    const a = op("stroke");
    const b = op("anno");
    const c = op("stroke");
    h.commit(a);
    h.commit(b);
    h.undo(); // redo=[b]
    expect(h.canRedo).toBe(true);
    h.undo(); // redo=[b,a] —— undo 不清 redo
    expect(h.canRedo).toBe(true);
    h.redo(); // ops=[a], redo=[b] —— redo 不清 redo
    expect(h.canRedo).toBe(true);
    h.commit(c); // 提交新 op → 清空重做栈(workbench :1188-1189)
    expect(h.ops).toEqual([a, c]);
    expect(h.canRedo).toBe(false);
    h.redo(); // 空 redo 守卫:无操作
    expect(h.ops).toEqual([a, c]);
  });

  it("空栈守卫:空 ops undo / 空 redo redo 均无操作(:1230/:1234)", () => {
    const h = createHistoryStore();
    h.undo();
    h.redo();
    expect(h.ops).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("自定义 kind 与内置一视同仁(4.4):undo/redo 不按 kind 区别对待", () => {
    const h = createHistoryStore();
    const s = op("stroke", { size: 1 });
    const custom = op("plugin:sticker", { id: "x" });
    const a = op("anno", { kind: "text" });
    h.commit(s);
    h.commit(custom);
    h.commit(a);
    h.undo(); // 弹 a
    h.undo(); // 弹 custom —— 与内置同样进 redo 栈
    expect(h.ops).toEqual([s]);
    h.redo(); // custom 原样回栈
    expect(h.ops).toEqual([s, custom]);
    h.commit(op("another:kind")); // 自定义 kind 的 commit 同样清 redo
    expect(h.canRedo).toBe(false);
  });

  it("clear:双栈清空(workbench :557-558/:1878-1879 复位语义)", () => {
    const h = createHistoryStore();
    h.commit(op("stroke"));
    h.commit(op("anno"));
    h.undo();
    h.clear();
    expect(h.ops).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  describe("useSyncExternalStore 适配契约", () => {
    it("getSnapshot 未变更时引用稳定;变更后换新引用", () => {
      const h = createHistoryStore();
      const s0 = h.getSnapshot();
      expect(h.getSnapshot()).toBe(s0); // 重复调用同一引用
      h.undo(); // 空栈 no-op:快照引用不变
      h.redo();
      expect(h.getSnapshot()).toBe(s0);
      h.commit(op("stroke"));
      const s1 = h.getSnapshot();
      expect(s1).not.toBe(s0);
      expect(h.getSnapshot()).toBe(s1);
      expect(s1.ops).toHaveLength(1);
      expect(s1.canUndo).toBe(true);
      expect(s1.canRedo).toBe(false);
    });

    it("快照内容与 store 面一致(ops/redoOps/canUndo/canRedo)", () => {
      const h = createHistoryStore();
      const a = op("stroke");
      const b = op("anno");
      h.commit(a);
      h.commit(b);
      h.undo();
      const s = h.getSnapshot();
      expect(s.ops).toEqual([a]);
      expect(s.redoOps).toEqual([b]);
      expect(s.canUndo).toBe(true);
      expect(s.canRedo).toBe(true);
    });

    it("subscribe:实效变更通知,no-op 不通知,退订生效", () => {
      const h = createHistoryStore();
      const listener = vi.fn();
      const unsub = h.subscribe(listener);
      h.undo(); // 空栈 no-op → 不通知
      h.redo();
      expect(listener).not.toHaveBeenCalled();
      h.commit(op("stroke"));
      expect(listener).toHaveBeenCalledTimes(1);
      h.undo();
      expect(listener).toHaveBeenCalledTimes(2);
      h.redo();
      expect(listener).toHaveBeenCalledTimes(3);
      h.clear();
      expect(listener).toHaveBeenCalledTimes(4);
      h.clear(); // 已空:no-op → 不通知
      expect(listener).toHaveBeenCalledTimes(4);
      unsub();
      h.commit(op("anno"));
      expect(listener).toHaveBeenCalledTimes(4);
    });
  });
});

describe("kernel/history createOpRasterizerRegistry(OpKind 光栅化注册表)", () => {
  const raster: OpRasterizer = (ctx2d, _item, size) => {
    ctx2d.fillRect(0, 0, size.w, size.h);
  };

  it("注册后可查(registerRasterizer → getRasterizer/hasRasterizer)", () => {
    const reg = createOpRasterizerRegistry();
    expect(reg.registerRasterizer("stroke", raster)).toBe(true);
    expect(reg.getRasterizer("stroke")).toBe(raster);
    expect(reg.hasRasterizer("stroke")).toBe(true);
  });

  it("未注册 kind → undefined(4.2 overlay 回放按查找结果跳过)", () => {
    const reg = createOpRasterizerRegistry();
    expect(reg.getRasterizer("unknown")).toBeUndefined();
    expect(reg.hasRasterizer("unknown")).toBe(false);
  });

  it("重复注册同 kind:后注册者被拒,不覆盖(design 注册冲突同族策略)", () => {
    const reg = createOpRasterizerRegistry();
    const second: OpRasterizer = () => {};
    expect(reg.registerRasterizer("stroke", raster)).toBe(true);
    expect(reg.registerRasterizer("stroke", second)).toBe(false);
    expect(reg.getRasterizer("stroke")).toBe(raster); // 先注册者保持
  });

  it("自定义 kind 与内置一视同仁(4.4):任意字符串 kind 可注册可查", () => {
    const reg = createOpRasterizerRegistry();
    expect(reg.registerRasterizer("plugin:sticker", raster)).toBe(true);
    expect(reg.getRasterizer("plugin:sticker")).toBe(raster);
    expect(reg.kinds).toEqual(["plugin:sticker"]);
  });

  it("per-instance 互不串扰(6.5 同族纪律)", () => {
    const a = createOpRasterizerRegistry();
    const b = createOpRasterizerRegistry();
    a.registerRasterizer("stroke", raster);
    expect(b.hasRasterizer("stroke")).toBe(false);
    expect(b.registerRasterizer("stroke", raster)).toBe(true);
  });

  it("rasterizer 签名 = (ctx2d, item, size)(design opKinds 形状;实际调用传参贯通)", () => {
    const reg = createOpRasterizerRegistry();
    const calls: unknown[][] = [];
    const spy: OpRasterizer = (ctx2d, item, size) => {
      calls.push([ctx2d, item, size]);
    };
    reg.registerRasterizer("anno", spy);
    const ctx = { fillRect: () => {} } as unknown as Ctx2DLike;
    const item = { kind: "arrow" };
    reg.getRasterizer("anno")?.(ctx, item, { w: 100, h: 50 });
    expect(calls).toEqual([[ctx, item, { w: 100, h: 50 }]]);
  });
});

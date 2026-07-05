/**
 * kernel/layers 单测(task 2.3,Req 5.1;design.md「Testing Strategy / Unit Tests」
 * File Structure:layers.test.ts = 增删改/命中/reducer)。
 *
 * 行为语义复刻自 canvas-workbench(golden 期望按旧实现手推,不从新实现反推):
 * - addLayer(:871-908):初始宽 = 底图宽 40%,高 = 宽(占位方形);落点居中
 *   (缺省底图中心);natural 未量到退化 1024 占位;id 序列 `layer-<n>`;
 *   加载修正 = `{...l, loaded, h: l.w*ratio, y: cy0 - (l.w*ratio)/2}`(:895-901,
 *   cy0 为**加层时**捕获的落点纵中心;ratio = img.width>0 ? h/w : 1);
 * - 删除(:1693-1694 filter + 清选中)/ 清空(:562-563/:1095-1096/:1706-1707);
 * - 命中 = id 查找(:978 `layers.find(x => x.id === id)`);
 * - move/resize reducer(:998-1007):move = orig + 位移;resize = 右下角手柄
 *   等比缩放(以横向位移为准,`w = max(24, orig.w + dx)`,ratio = orig.h/orig.w,
 *   orig.w<=0 时 ratio=1;dy 不参与);
 * - useSyncExternalStore 适配契约:getSnapshot 未变更时**引用稳定**(参照 2.1
 *   stage / 2.2 history 先例);no-op 不通知。
 *
 * 注意:kernel/ 是 L1,不从包根出口导出 —— 本测试走内部路径 import(出口纪律见
 * index-exports.test.ts 快照)。指针事件接线(capture/客户端坐标换算)不在本模块
 * (2.4 pointer 路由职责);本模块只收**底图像素**位移。
 */
import { describe, it, expect, vi } from "vitest";
import type { LoadedImage, WorkLayer } from "../src/types.js";
import {
  createLayersStore,
  applyLayerGesture,
  LAYER_MIN_SIZE,
  type LayerGestureOrigin,
} from "../src/kernel/layers.js";

const att = (n: number): { attachmentId: string; displayUrl: string } => ({
  attachmentId: `att_${n}`,
  displayUrl: `blob:img-${n}`,
});

/** fake 已加载图像(LoadedImage 尺寸显式携带,types.ts 注释即为此设计)。 */
const img = (width: number, height: number): LoadedImage => ({
  source: {} as CanvasImageSource,
  width,
  height,
});

const NAT = { w: 1000, h: 800 };

describe("kernel/layers createLayersStore(增删改/命中)", () => {
  it("add:初始宽 = 底图宽 40%,占位方形,落点居中(:877-889 golden)", () => {
    const s = createLayersStore();
    const id = s.add(att(1), { x: 300, y: 200 }, NAT);
    expect(id).toBe("layer-1");
    expect(s.layers).toEqual([
      {
        id: "layer-1",
        attachmentId: "att_1",
        displayUrl: "blob:img-1",
        x: 100, // 300 - 400/2
        y: 0, // 200 - 400/2
        w: 400, // 1000 × 0.4
        h: 400, // 占位方形
      },
    ]);
  });

  it("add:缺省落点 = 底图中心(:879-880 `at?.x ?? nat.w/2`)", () => {
    const s = createLayersStore();
    s.add(att(1), undefined, NAT);
    const l = s.layers[0]!;
    expect(l.x).toBe(300); // 500 - 200
    expect(l.y).toBe(200); // 400 - 200
    expect(l.w).toBe(400);
    expect(l.h).toBe(400);
  });

  it("add:natural 未量到退化 1024 占位(:874 与 sourceSize 同策略)", () => {
    const s = createLayersStore();
    s.add(att(1), undefined, null);
    const l = s.layers[0]!;
    expect(l.w).toBeCloseTo(409.6); // 1024 × 0.4
    expect(l.h).toBeCloseTo(409.6);
    expect(l.x).toBeCloseTo(512 - 204.8);
    expect(l.y).toBeCloseTo(512 - 204.8);
  });

  it("add:id 单调递增且选中新层(:875-876/:891);后加的在后(数组序=叠放序)", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    const b = s.add(att(2), { x: 100, y: 100 }, NAT);
    expect(a).toBe("layer-1");
    expect(b).toBe("layer-2");
    expect(s.layers.map((l) => l.id)).toEqual(["layer-1", "layer-2"]);
    expect(s.selectedId).toBe("layer-2"); // 每次 add 都选中新层
  });

  it("markLoaded:按真实纵横比修正高度并绕落点纵中心重定位(:895-901 golden)", () => {
    const s = createLayersStore();
    const id = s.add(att(1), { x: 300, y: 200 }, NAT);
    const loaded = img(200, 100); // ratio = 0.5
    s.markLoaded(id, loaded);
    const l = s.layers[0]!;
    expect(l.loaded).toBe(loaded);
    expect(l.w).toBe(400); // 宽不动
    expect(l.h).toBe(200); // w × 0.5
    expect(l.x).toBe(100); // x 不动
    expect(l.y).toBe(100); // cy0(200) - 200/2
  });

  it("markLoaded:img.width<=0 时 ratio=1(:894 守卫)", () => {
    const s = createLayersStore();
    const id = s.add(att(1), { x: 300, y: 200 }, NAT);
    s.markLoaded(id, img(0, 77));
    const l = s.layers[0]!;
    expect(l.h).toBe(400); // w × 1
    expect(l.y).toBe(0); // cy0(200) - 400/2
  });

  it("markLoaded:用**当时**的 l.w 计算(加载慢于 resize 时按新宽修正;:898 闭包语义)", () => {
    const s = createLayersStore();
    const id = s.add(att(1), { x: 300, y: 200 }, NAT);
    // 加载完成前用户已缩放:w 400 → 500。
    s.applyGesture({ id, mode: "resize", orig: { x: 100, y: 0, w: 400, h: 400 } }, 100, 0);
    s.markLoaded(id, img(200, 100)); // ratio 0.5
    const l = s.layers[0]!;
    expect(l.w).toBe(500);
    expect(l.h).toBe(250); // 500 × 0.5
    expect(l.y).toBe(75); // cy0(200) - 250/2 —— 绕**加层时**落点纵中心(闭包捕获)
  });

  it("markLoaded:层已删除 → no-op(:895 prev.map 空命中;异步加载晚于删除)", () => {
    const s = createLayersStore();
    const id = s.add(att(1), undefined, NAT);
    s.remove(id);
    const snap = s.getSnapshot();
    s.markLoaded(id, img(10, 10));
    expect(s.getSnapshot()).toBe(snap); // 引用稳定,不通知
  });

  it("remove:filter 掉该层;删除选中层时清选中(:1693-1694)", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    const b = s.add(att(2), undefined, NAT);
    s.remove(b); // b 是当前选中
    expect(s.layers.map((l) => l.id)).toEqual([a]);
    expect(s.selectedId).toBeNull();
  });

  it("remove:删除非选中层保留选中;未知 id → no-op", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    const b = s.add(att(2), undefined, NAT);
    s.select(a);
    s.remove(b);
    expect(s.selectedId).toBe(a);
    const snap = s.getSnapshot();
    s.remove("layer-99");
    expect(s.getSnapshot()).toBe(snap);
  });

  it("clear:全清 + 清选中(:562-563/:1706-1707 复位语义);已空时 no-op", () => {
    const s = createLayersStore();
    s.add(att(1), undefined, NAT);
    s.add(att(2), undefined, NAT);
    s.clear();
    expect(s.layers).toEqual([]);
    expect(s.selectedId).toBeNull();
    const snap = s.getSnapshot();
    s.clear();
    expect(s.getSnapshot()).toBe(snap);
  });

  it("get:id 命中查找(:978 find 语义);未知 id → undefined", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    expect(s.get(a)?.attachmentId).toBe("att_1");
    expect(s.get("layer-99")).toBeUndefined();
  });

  it("select:直设选中(含 null);同值 no-op 不通知", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    const listener = vi.fn();
    s.subscribe(listener);
    s.select(null);
    expect(s.selectedId).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    s.select(null); // 同值:no-op
    expect(listener).toHaveBeenCalledTimes(1);
    s.select(a);
    expect(s.selectedId).toBe(a);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("per-instance 互不串扰(id 序列独立)", () => {
    const a = createLayersStore();
    const b = createLayersStore();
    a.add(att(1), undefined, NAT);
    expect(b.layers).toEqual([]);
    expect(b.add(att(2), undefined, NAT)).toBe("layer-1"); // 各自从 1 起
  });
});

describe("kernel/layers move/resize reducer(:998-1007 golden)", () => {
  const orig: LayerGestureOrigin = { x: 10, y: 20, w: 100, h: 50 };
  const base: WorkLayer = {
    id: "layer-1",
    attachmentId: "att_1",
    displayUrl: "blob:img-1",
    ...orig,
  };
  const other: WorkLayer = { ...base, id: "layer-2", attachmentId: "att_2" };

  it("move:orig + 位移(:1001);尺寸不动;非目标层原样(同引用)", () => {
    const next = applyLayerGesture([base, other], { id: "layer-1", mode: "move", orig }, 5, -7);
    expect(next[0]).toEqual({ ...base, x: 15, y: 13 });
    expect(next[1]).toBe(other); // 非目标层:同一引用
  });

  it("resize:等比缩放,以横向位移为准,dy 不参与(:1003-1005)", () => {
    const next = applyLayerGesture([base], { id: "layer-1", mode: "resize", orig }, 30, 999);
    expect(next[0]).toEqual({ ...base, w: 130, h: 65 }); // ratio = 50/100;x/y 不动
  });

  it("resize:钳最小 24px(:1004 `Math.max(24, ...)`)", () => {
    expect(LAYER_MIN_SIZE).toBe(24);
    const next = applyLayerGesture([base], { id: "layer-1", mode: "resize", orig }, -90, 0);
    expect(next[0]).toEqual({ ...base, w: 24, h: 12 }); // 100-90=10 → 钳 24;h = 24 × 0.5
  });

  it("resize:orig.w<=0 时 ratio=1(:1003 守卫)", () => {
    const zero: LayerGestureOrigin = { x: 0, y: 0, w: 0, h: 40 };
    const layer: WorkLayer = { ...base, ...zero };
    const next = applyLayerGesture([layer], { id: "layer-1", mode: "resize", orig: zero }, 6, 0);
    expect(next[0]).toEqual({ ...layer, w: 24, h: 24 }); // max(24, 0+6)=24;ratio=1
  });

  it("reducer 以 orig 为基准(非当前值):同一手势多次 move 不累积漂移", () => {
    // workbench 语义:每次 pointermove 都从 d.orig + 总位移重算(:1001),
    // 而非在上一帧结果上累加 —— 连发两次只取最后位移。
    const s = createLayersStore();
    const id = s.add(att(1), { x: 300, y: 200 }, NAT); // x=100, y=0
    const o: LayerGestureOrigin = { x: 100, y: 0, w: 400, h: 400 };
    s.applyGesture({ id, mode: "move", orig: o }, 10, 10);
    s.applyGesture({ id, mode: "move", orig: o }, 25, -5);
    expect(s.get(id)).toMatchObject({ x: 125, y: -5, w: 400, h: 400 });
  });

  it("store.applyGesture:未知 id → no-op(引用稳定,不通知)", () => {
    const s = createLayersStore();
    s.add(att(1), undefined, NAT);
    const listener = vi.fn();
    s.subscribe(listener);
    const snap = s.getSnapshot();
    s.applyGesture({ id: "layer-99", mode: "move", orig: { x: 0, y: 0, w: 1, h: 1 } }, 5, 5);
    expect(s.getSnapshot()).toBe(snap);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useSyncExternalStore 适配契约(参照 2.1/2.2 先例)", () => {
  it("getSnapshot 未变更时引用稳定;变更后换新引用", () => {
    const s = createLayersStore();
    const s0 = s.getSnapshot();
    expect(s.getSnapshot()).toBe(s0);
    s.clear(); // 已空 no-op
    s.remove("nope");
    expect(s.getSnapshot()).toBe(s0);
    const id = s.add(att(1), undefined, NAT);
    const s1 = s.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(s.getSnapshot()).toBe(s1);
    expect(s1.layers).toHaveLength(1);
    expect(s1.selectedId).toBe(id);
  });

  it("快照内容与 store 面一致(layers/selectedId)", () => {
    const s = createLayersStore();
    const a = s.add(att(1), undefined, NAT);
    s.select(null);
    const snap = s.getSnapshot();
    expect(snap.layers).toBe(s.layers);
    expect(snap.selectedId).toBeNull();
    s.select(a);
    expect(s.getSnapshot().selectedId).toBe(a);
  });

  it("subscribe:实效变更通知,no-op 不通知,退订生效", () => {
    const s = createLayersStore();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    s.clear(); // 空 no-op
    expect(listener).not.toHaveBeenCalled();
    const id = s.add(att(1), undefined, NAT);
    expect(listener).toHaveBeenCalledTimes(1);
    s.markLoaded(id, img(10, 20));
    expect(listener).toHaveBeenCalledTimes(2);
    s.applyGesture({ id, mode: "move", orig: { x: 0, y: 0, w: 1, h: 1 } }, 1, 1);
    expect(listener).toHaveBeenCalledTimes(3);
    s.remove(id);
    expect(listener).toHaveBeenCalledTimes(4);
    unsub();
    s.add(att(2), undefined, NAT);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

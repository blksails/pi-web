/**
 * kernel/pointer 单测(task 2.4,Req 3.1/3.2;design.md「Testing Strategy / Unit Tests #2」)。
 *
 * - 四类命中分派:overlay / layer(move|resize)/ expand-handle / stage —— DOM 经既有
 *   data-* 标记上交(data-canvas-layer + data-layer-id / data-canvas-layer-resize /
 *   data-canvas-expand-handle / data-canvas-mask-overlay;workbench :1567/:1601/:1644/:1615);
 * - 层手势与舞台平移互斥(3.2 双事件守卫):层/手柄命中时 dispatch(工具通道)零调用,
 *   结构性根治 :1604(层)/:1647(扩图手柄)的 onMouseDown stopPropagation 散点补丁族;
 * - 守卫回归:会话独占(二次 down 忽略)/ pointerId 过滤 / up 后会话清空;
 * - golden 期望值全部按**旧实现公式**手算(不从新实现反推):
 *   层拖拽 dx = ((clientX-startX)/rect.width)*natural.w(workbench :996-:997);
 *   扩图 delta = deltaClient * (natural.w/rect.width),边向外为正(:1031-:1040);
 * - dispatch 为注入接缝(stub;真 ToolRuntime 在 2.5 接入)—— 本测试断言路由只
 *   派发语义化手势事件,不含 DOM/视口数学外溢。
 *
 * 注意:kernel/ 是 L1,不从包根出口导出 —— 本测试走内部路径 import。
 */
import { describe, it, expect, vi } from "vitest";
import {
  HIT_MARKERS,
  createPointerRouter,
  hitTest,
  type ElementLike,
  type PointerRouterEnv,
  type RouterPointerEvent,
  type ToolPointerEvent,
} from "../src/kernel/pointer.js";
import { createStageController, type RectLike } from "../src/kernel/stage.js";
import { createLayersStore } from "../src/kernel/layers.js";

// ── 最小 ElementLike 假件(closest 只需支持 "[attr]" 选择器)────────────────────

class FakeEl implements ElementLike {
  constructor(
    private readonly attrs: Record<string, string>,
    private readonly parent: FakeEl | null = null,
  ) {}
  getAttribute(name: string): string | null {
    return name in this.attrs ? (this.attrs[name] ?? null) : null;
  }
  closest(selector: string): ElementLike | null {
    const attr = selector.slice(1, -1); // "[data-x]" → "data-x"
    let cur: FakeEl | null = this;
    while (cur !== null) {
      if (attr in cur.attrs) return cur;
      cur = cur.parent;
    }
    return null;
  }
}

// DOM 拓扑(workbench 现状):stage ⊃ overlay;stage ⊃ layer ⊃ resize;stage ⊃ handle。
const stageEl = new FakeEl({});
const overlayEl = new FakeEl({ [HIT_MARKERS.overlay]: "" }, stageEl);
const layerEl = (id: string): FakeEl =>
  new FakeEl({ [HIT_MARKERS.layer]: "", [HIT_MARKERS.layerId]: id }, stageEl);
const resizeEl = (layer: FakeEl): FakeEl => new FakeEl({ [HIT_MARKERS.layerResize]: "" }, layer);
const handleEl = (edge: string): FakeEl => new FakeEl({ [HIT_MARKERS.expandHandle]: edge }, stageEl);

// ── 测试环境(rect 500×400 @ (100,50) ↔ natural 1000×800:均匀 2 倍映射)────────

const BASE_RECT: RectLike = { left: 100, top: 50, width: 500, height: 400 };
const NATURAL = { w: 1000, h: 800 };

const pe = (target: ElementLike | null, x: number, y: number, pointerId = 1): RouterPointerEvent => ({
  pointerId,
  clientX: x,
  clientY: y,
  target,
});

function makeHarness(init?: {
  rect?: RectLike | null;
  natural?: { w: number; h: number } | null;
}): {
  router: ReturnType<typeof createPointerRouter>;
  dispatch: ReturnType<typeof vi.fn<(ev: ToolPointerEvent) => void>>;
  capturePointer: ReturnType<typeof vi.fn<(target: ElementLike, pointerId: number) => void>>;
  layers: ReturnType<typeof createLayersStore>;
  holder: { rect: RectLike | null; natural: { w: number; h: number } | null };
} {
  const holder = {
    rect: init !== undefined && "rect" in init ? (init.rect ?? null) : BASE_RECT,
    natural: init !== undefined && "natural" in init ? (init.natural ?? null) : NATURAL,
  };
  const stage = createStageController({
    getRect: () => holder.rect,
    getNaturalSize: () => holder.natural,
  });
  const layers = createLayersStore();
  const dispatch = vi.fn<(ev: ToolPointerEvent) => void>();
  const capturePointer = vi.fn<(target: ElementLike, pointerId: number) => void>();
  const env: PointerRouterEnv = { stage, layers, dispatch, capturePointer };
  return { router: createPointerRouter(env), dispatch, capturePointer, layers, holder };
}

/** 真 layers store 里加一层(natural 1000×800,落点 (500,400) → x=300,y=200,w=h=400)。 */
const seedLayer = (layers: ReturnType<typeof createLayersStore>): string =>
  layers.add({ attachmentId: "att_1", displayUrl: "/a.png" }, { x: 500, y: 400 }, NATURAL);

describe("kernel/pointer hitTest(data-* 命中判定)", () => {
  it("四类命中:expand-handle / layer(move)/ overlay / stage 回退(含 null target)", () => {
    expect(hitTest(handleEl("right"))).toEqual({ kind: "expand-handle", edge: "right" });
    expect(hitTest(layerEl("layer-1"))).toEqual({ kind: "layer", layerId: "layer-1", mode: "move" });
    expect(hitTest(overlayEl)).toEqual({ kind: "overlay" });
    expect(hitTest(stageEl)).toEqual({ kind: "stage" });
    expect(hitTest(null)).toEqual({ kind: "stage" });
  });

  it("resize 手柄(层内嵌套)优先判 resize 模式,不落回层 move", () => {
    const l = layerEl("layer-7");
    expect(hitTest(resizeEl(l))).toEqual({ kind: "layer", layerId: "layer-7", mode: "resize" });
  });

  it("防御回退:非法 expand 边值 / layer 缺 id → stage", () => {
    expect(hitTest(handleEl("diagonal"))).toEqual({ kind: "stage" });
    const orphan = new FakeEl({ [HIT_MARKERS.layer]: "" }, stageEl);
    expect(hitTest(orphan)).toEqual({ kind: "stage" });
  });
});

describe("kernel/pointer overlay 手势分派(工具通道)", () => {
  it("down/move/up 全程派发:natural 已换算(golden)、delta 随行、phase 正确", () => {
    const { router, dispatch } = makeHarness();
    router.onPointerDown(pe(overlayEl, 350, 250));
    router.onPointerMove(pe(overlayEl, 360, 270));
    router.onPointerUp(pe(overlayEl, 360, 270));
    expect(dispatch).toHaveBeenCalledTimes(3);
    const [down, move, up] = dispatch.mock.calls.map((c) => c[0]);
    // golden(旧公式):(350-100)/500*1000 = 500;(250-50)/400*800 = 400
    expect(down).toMatchObject({
      phase: "down",
      hit: { kind: "overlay" },
      natural: { x: 500, y: 400 },
      deltaNatural: { dx: 0, dy: 0 },
      deltaClient: { dx: 0, dy: 0 },
      pointerId: 1,
    });
    expect(move).toMatchObject({ phase: "move", deltaClient: { dx: 10, dy: 20 } });
    // 浮点按 closeTo 断言(旧公式同浮点:0.55×800 = 440.00000000000006)
    expect(move!.natural!.x).toBeCloseTo(520, 9);
    expect(move!.natural!.y).toBeCloseTo(440, 9);
    expect(move!.deltaNatural!.dx).toBeCloseTo(20, 9);
    expect(move!.deltaNatural!.dy).toBeCloseTo(40, 9);
    expect(up).toMatchObject({ phase: "up", hit: { kind: "overlay" } });
    // 非扩图命中:expandDelta 恒 null
    expect(down!.expandDelta).toBeNull();
    expect(router.getSession()).toBeNull();
  });

  it("down 时 rect/natural 不可得 → 手势不启动(现状语义:无派发无会话)", () => {
    for (const init of [{ rect: null }, { natural: null }] as const) {
      const { router, dispatch } = makeHarness(init);
      router.onPointerDown(pe(overlayEl, 350, 250));
      expect(dispatch).not.toHaveBeenCalled();
      expect(router.getSession()).toBeNull();
    }
  });

  it("move 中途 rect 不可得 → 该帧丢弃(:993-:995 语义);up 仍派发(提交不依赖坐标)", () => {
    const { router, dispatch, holder } = makeHarness();
    router.onPointerDown(pe(overlayEl, 350, 250));
    holder.rect = null;
    router.onPointerMove(pe(overlayEl, 360, 270));
    expect(dispatch).toHaveBeenCalledTimes(1); // 只有 down
    router.onPointerUp(pe(overlayEl, 360, 270));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]![0]).toMatchObject({ phase: "up", natural: null });
  });

  it("capture 为接缝而非自动:ev.capture() 才触发 capturePointer(2.5 的 capture 设置点)", () => {
    const { router, dispatch, capturePointer } = makeHarness();
    router.onPointerDown(pe(overlayEl, 350, 250, 9));
    expect(capturePointer).not.toHaveBeenCalled(); // down 不自动捕获(text 工具不捕获,:1142-:1153)
    dispatch.mock.calls[0]![0].capture();
    expect(capturePointer).toHaveBeenCalledWith(overlayEl, 9);
  });

  it("pointercancel → phase 'cancel' 派发且会话清空", () => {
    const { router, dispatch } = makeHarness();
    router.onPointerDown(pe(overlayEl, 350, 250));
    router.onPointerCancel(pe(overlayEl, 350, 250));
    expect(dispatch.mock.calls[1]![0]).toMatchObject({ phase: "cancel", hit: { kind: "overlay" } });
    expect(router.getSession()).toBeNull();
    router.onPointerMove(pe(overlayEl, 360, 270));
    expect(dispatch).toHaveBeenCalledTimes(2); // cancel 后 move 不再派发
  });
});

describe("kernel/pointer stage 命中(平移通道)", () => {
  it("natural 不可得仍派发(平移不需要底图坐标),deltaClient 为 pan 载荷", () => {
    const { router, dispatch } = makeHarness({ natural: null });
    router.onPointerDown(pe(stageEl, 200, 100));
    router.onPointerMove(pe(stageEl, 230, 90));
    router.onPointerUp(pe(stageEl, 230, 90));
    expect(dispatch).toHaveBeenCalledTimes(3);
    const [down, move, up] = dispatch.mock.calls.map((c) => c[0]);
    expect(down).toMatchObject({ phase: "down", hit: { kind: "stage" }, natural: null });
    expect(move).toMatchObject({ phase: "move", deltaClient: { dx: 30, dy: -10 }, natural: null });
    expect(up).toMatchObject({ phase: "up" });
  });

  it("natural 可得时 stage 事件同样携带已换算坐标(工具通道统一形状)", () => {
    const { router, dispatch } = makeHarness();
    router.onPointerDown(pe(stageEl, 350, 250));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ natural: { x: 500, y: 400 } });
  });
});

describe("kernel/pointer expand-handle 手势(载荷=边+位移)", () => {
  it("right 边:down expandDelta=0,move 按旧公式 deltaClient×(natural.w/rect.width)", () => {
    const { router, dispatch } = makeHarness();
    router.onPointerDown(pe(handleEl("right"), 600, 250));
    router.onPointerMove(pe(handleEl("right"), 630, 250));
    const [down, move] = dispatch.mock.calls.map((c) => c[0]);
    expect(down).toMatchObject({ phase: "down", hit: { kind: "expand-handle", edge: "right" }, expandDelta: 0 });
    // golden(:1031-:1040):perPx = 1000/500 = 2;deltaClient = 30 → 60
    expect(move!.expandDelta).toBe(60);
  });

  it("top 边:向外(向上)为正 —— 客户端 Y 减小 → 正位移", () => {
    const { router, dispatch } = makeHarness();
    router.onPointerDown(pe(handleEl("top"), 350, 48));
    router.onPointerMove(pe(handleEl("top"), 350, 28));
    // golden:deltaClient = 48-28 = 20;×(800/400 = 1000/500 均匀映射) = 40
    expect(dispatch.mock.calls[1]![0]!.expandDelta).toBe(40);
    // 反向(向下收)为负
    router.onPointerMove(pe(handleEl("top"), 350, 58));
    expect(dispatch.mock.calls[2]![0]!.expandDelta).toBe(-20);
  });

  it("down 时 natural 不可得 → 手势不启动(:1022-:1024 语义)", () => {
    const { router, dispatch } = makeHarness({ natural: null });
    router.onPointerDown(pe(handleEl("left"), 100, 250));
    expect(dispatch).not.toHaveBeenCalled();
    expect(router.getSession()).toBeNull();
  });
});

describe("kernel/pointer layer 内核手势(工具无关;与舞台平移互斥)", () => {
  it("move 模式:down 选中+捕获,move 驱动 layers reducer(golden),up 结束会话", () => {
    const { router, dispatch, capturePointer, layers } = makeHarness();
    const id = seedLayer(layers); // x=300,y=200,w=h=400
    const el = layerEl(id);
    const applyGesture = vi.spyOn(layers, "applyGesture");
    router.onPointerDown(pe(el, 300, 200, 5));
    expect(layers.selectedId).toBe(id); // :980 setSelectedLayer
    expect(capturePointer).toHaveBeenCalledWith(el, 5); // :981 内核自动捕获
    router.onPointerMove(pe(el, 310, 220, 5));
    // golden(:996-:997):dx = 10/500×1000 = 20;dy = 20/400×800 = 40
    expect(applyGesture).toHaveBeenCalledWith(
      { id, mode: "move", orig: { x: 300, y: 200, w: 400, h: 400 } },
      20,
      40,
    );
    expect(layers.get(id)).toMatchObject({ x: 320, y: 240 });
    router.onPointerUp(pe(el, 310, 220, 5));
    expect(router.getSession()).toBeNull();
    // 全程零工具派发(层手势为内核手势,3.2 互斥)
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("resize 模式:等比缩放以横向位移为准(golden;dy 不参与)", () => {
    const { router, layers } = makeHarness();
    const id = seedLayer(layers);
    router.onPointerDown(pe(resizeEl(layerEl(id)), 400, 300));
    router.onPointerMove(pe(resizeEl(layerEl(id)), 450, 999));
    // golden(:1003-:1005):dx = 50/500×1000 = 100 → w = 400+100 = 500;ratio=1 → h=500
    expect(layers.get(id)).toMatchObject({ w: 500, h: 500 });
  });

  it("未知层 id:no-op(不选中、不捕获、无会话;:978-:979 语义)", () => {
    const { router, dispatch, capturePointer, layers } = makeHarness();
    router.onPointerDown(pe(layerEl("layer-ghost"), 300, 200));
    expect(layers.selectedId).toBeNull();
    expect(capturePointer).not.toHaveBeenCalled();
    expect(router.getSession()).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("双事件守卫回归(:1604/:1647 根治):层/手柄命中会话期间,舞台平移通道零事件", () => {
    const { router, dispatch, layers } = makeHarness();
    const id = seedLayer(layers);
    // 旧世界:层 pointerdown 与 stage mousedown 并发触发(2 倍位移 bug)。
    // 新世界:唯一入口 + 命中互斥 —— 层会话期间任何 move 都不产生 stage 派发。
    router.onPointerDown(pe(layerEl(id), 300, 200));
    router.onPointerMove(pe(layerEl(id), 350, 260));
    router.onPointerUp(pe(layerEl(id), 350, 260));
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("kernel/pointer 守卫(会话独占 / pointerId 过滤)", () => {
  it("会话期间二次 down 忽略(不夺会话、不派发)", () => {
    const { router, dispatch, layers } = makeHarness();
    const id = seedLayer(layers);
    router.onPointerDown(pe(layerEl(id), 300, 200, 1));
    router.onPointerDown(pe(overlayEl, 350, 250, 2)); // 第二指/第二事件源
    expect(dispatch).not.toHaveBeenCalled();
    expect(router.getSession()).toMatchObject({ kind: "layer", pointerId: 1 });
  });

  it("pointerId 不匹配的 move/up 忽略(会话仍在)", () => {
    const { router, layers } = makeHarness();
    const id = seedLayer(layers);
    const applyGesture = vi.spyOn(layers, "applyGesture");
    router.onPointerDown(pe(layerEl(id), 300, 200, 1));
    router.onPointerMove(pe(layerEl(id), 310, 220, 2));
    router.onPointerUp(pe(layerEl(id), 310, 220, 2));
    expect(applyGesture).not.toHaveBeenCalled();
    expect(router.getSession()).not.toBeNull();
  });

  it("up 后会话清空:后续 move 不驱动 reducer 也不派发", () => {
    const { router, dispatch, layers } = makeHarness();
    const id = seedLayer(layers);
    const applyGesture = vi.spyOn(layers, "applyGesture");
    router.onPointerDown(pe(layerEl(id), 300, 200));
    router.onPointerUp(pe(layerEl(id), 300, 200));
    router.onPointerMove(pe(layerEl(id), 400, 400));
    expect(applyGesture).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("getSession 快照生命周期:空闲 null → 会话形状 → up/cancel 后 null", () => {
    const { router } = makeHarness();
    expect(router.getSession()).toBeNull();
    router.onPointerDown(pe(handleEl("bottom"), 350, 452, 3));
    expect(router.getSession()).toMatchObject({
      kind: "tool",
      pointerId: 3,
      hit: { kind: "expand-handle", edge: "bottom" },
    });
    router.onPointerCancel(pe(handleEl("bottom"), 350, 452, 3));
    expect(router.getSession()).toBeNull();
  });
});

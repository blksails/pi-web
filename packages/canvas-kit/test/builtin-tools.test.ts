/**
 * builtin 工具单测:3.1 绘制族五工具 + 3.2 非绘制族三工具与 registerBuiltinTools
 * (Req 6.2/6.3;design「Testing Strategy」#5)。
 *
 * 覆盖:
 * - 五工具声明形状:id `builtin:` 前缀/label/icon/cursor/capturePointer 缺省捕获/
 *   opKinds 键("stroke"/"anno");
 * - draft 生命周期逐场景(workbench :1105-1207 逐分支复刻):
 *   - mask/erase:MaskStroke draft;笔刷直径=短边×ratio 钳 ≥1(:1112);up 无成型
 *     判定直接 commit {kind:"stroke"}(:1187-1191);
 *   - draw:折线累积(:1126-1140/:1168-1169);up 按点数 ≥2 成型(:1196-1199);
 *   - line/arrow:from/to 两点(:1118-1124/:1170);up 按 from/to 距离 ≥2 成型
 *     (零长点按丢弃,:1196-1204);
 *   - up 恒清 draft;natural 不可得手势不启动(:1106-1107)/移动无 draft 守卫
 *     (:1156-1158 drawing 守卫同构);
 * - 光栅化输出(mock ctx2d 锚定,1.2 bitmap-io 测试先例):
 *   - "stroke":粉红半透明 rgba(236,72,153,0.5);erase→destination-out /
 *     paint→source-over;单点 lineTo(x+0.01,y);空点集跳过(:607-624);
 *   - "anno":复用 drawAnnotations 语义(线/箭头头/折线;逐条 item);
 *   - rasterizeDraft 与 opKinds 光栅化同函数(draft 预览=已提交回放,:608/:625);
 * - 选项条贡献:mask/erase→data-canvas-brush-sizes(三档 BRUSH_RATIOS,写
 *   prefs.brushRatio);draw/line/arrow→data-canvas-anno-colors(六色板,写
 *   prefs.annoColor);锚点/aria 与 workbench :1391-1438 逐一致。
 *
 * prefs 键名(本任务定死,4.2 装配注入初值同键):`annoColor` / `brushRatio`。
 */
import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { maskTool } from "../src/builtin/mask.js";
import { eraseTool } from "../src/builtin/erase.js";
import { drawTool } from "../src/builtin/draw.js";
import { lineTool } from "../src/builtin/line.js";
import { arrowTool } from "../src/builtin/arrow.js";
import { moveTool, type MoveDraft } from "../src/builtin/move.js";
import { expandTool, PREF_EXPAND_EDGES, type ExpandDraft } from "../src/builtin/expand.js";
import { textTool, type TextDraft } from "../src/builtin/text.js";
import { registerBuiltinTools } from "../src/builtin/index.js";
import {
  createCanvasRegistry,
  createPrefsStore,
  type CanvasTool,
  type CanvasToolContext,
  type ToolGestureEvent,
} from "../src/registry.js";
import type { Annotation, CanvasOp, ExpandEdges, MaskStroke } from "../src/index.js";
import type { Ctx2DLike } from "../src/bitmap-io.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const FIVE: readonly CanvasTool<never>[] = [
  maskTool,
  eraseTool,
  drawTool,
  lineTool,
  arrowTool,
] as unknown as readonly CanvasTool<never>[];

/** ToolGestureEvent 构造(overlay 命中缺省;natural/naturalSize 可覆盖)。 */
const gev = (over: Partial<ToolGestureEvent> = {}): ToolGestureEvent => ({
  natural: { x: 10, y: 20 },
  naturalSize: { w: 800, h: 600 },
  hit: { kind: "overlay" },
  client: { x: 100, y: 60 },
  deltaClient: { dx: 0, dy: 0 },
  deltaNatural: null,
  expandDelta: null,
  ...over,
});

interface Harness<TDraft> {
  readonly ctx: CanvasToolContext<TDraft>;
  readonly committed: CanvasOp[];
  draft(): TDraft | null;
}

/** 工具上下文 stub(draft 槽/commit 记录/真 prefs 店)。 */
function makeCtx<TDraft>(prefsInit?: Readonly<Record<string, unknown>>): Harness<TDraft> {
  let draft: TDraft | null = null;
  const committed: CanvasOp[] = [];
  const prefs = createPrefsStore(prefsInit);
  const ctx: CanvasToolContext<TDraft> = {
    draft: {
      get: () => draft,
      set: (d) => {
        draft = d;
      },
    },
    history: { commit: (op) => committed.push(op) },
    stage: { panBy: () => {} },
    layers: { layers: [], selectedId: null, get: () => undefined },
    defer: (fn) => fn(),
    prefs,
  };
  return { ctx, committed, draft: () => draft };
}

/** 记录型 ctx2d(bitmap-io 测试先例;可选路径原语全配齐)。 */
function recCtx(): { ctx: Ctx2DLike; calls: string[] } {
  const calls: string[] = [];
  const ctx: Ctx2DLike = {
    fillStyle: "",
    fillRect: () => calls.push("fillRect"),
    drawImage: () => calls.push("drawImage"),
    translate: () => {},
    rotate: () => {},
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    clearRect: () => calls.push("clearRect"),
    beginPath: () => calls.push("beginPath"),
    moveTo: (x, y) => calls.push(`moveTo:${x},${y}`),
    lineTo: (x, y) => calls.push(`lineTo:${x},${y}`),
    stroke: () =>
      calls.push(
        `stroke:${ctx.globalCompositeOperation ?? ""}:${ctx.strokeStyle ?? ""}:${ctx.lineWidth ?? ""}`,
      ),
    fillText: (t, x, y) => calls.push(`fillText:${t}:${x},${y}`),
  };
  return { ctx, calls };
}

/** React 元素 props 读取(测试内省;不渲染)。 */
const propsOf = (node: unknown): Record<string, unknown> => {
  if (!isValidElement(node)) throw new Error("not a react element");
  return node.props as Record<string, unknown>;
};
const childrenOf = (node: unknown): ReactElement[] => {
  const kids = propsOf(node).children;
  return (Array.isArray(kids) ? kids : [kids]) as ReactElement[];
};

// ── 声明形状(6.2:builtin: 前缀;icon/label/cursor/opKinds)─────────────────────

describe("绘制族五工具声明形状", () => {
  it("id 全带 builtin: 前缀且命名与旧 StageTool 对应", () => {
    expect(FIVE.map((t) => t.id)).toEqual([
      "builtin:mask",
      "builtin:erase",
      "builtin:draw",
      "builtin:line",
      "builtin:arrow",
    ]);
  });

  it("label 非空、icon 为 React 元素、cursor=crosshair(:1624)", () => {
    for (const t of FIVE) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(isValidElement(t.icon)).toBe(true);
      expect(t.cursor).toBe("crosshair");
    }
  });

  it("capturePointer 缺省(≠false):五工具 down 均捕获(:1109/:1119/:1128)", () => {
    for (const t of FIVE) expect(t.capturePointer !== false).toBe(true);
  });

  it("opKinds:mask/erase 注册 stroke,draw/line/arrow 注册 anno;族内同函数", () => {
    expect(Object.keys(maskTool.opKinds ?? {})).toEqual(["stroke"]);
    expect(Object.keys(eraseTool.opKinds ?? {})).toEqual(["stroke"]);
    for (const t of [drawTool, lineTool, arrowTool]) {
      expect(Object.keys(t.opKinds ?? {})).toEqual(["anno"]);
    }
    // 同族共享同一 rasterizer(重复注册被 registry 拒绝时语义仍完整)。
    expect(maskTool.opKinds?.stroke).toBe(eraseTool.opKinds?.stroke);
    expect(drawTool.opKinds?.anno).toBe(lineTool.opKinds?.anno);
    expect(lineTool.opKinds?.anno).toBe(arrowTool.opKinds?.anno);
  });

  it("五工具可经注册表登记并按注册序枚举", () => {
    const reg = createCanvasRegistry();
    for (const t of FIVE) reg.registerTool(t as CanvasTool);
    expect(reg.tools.map((t) => t.id)).toEqual(FIVE.map((t) => t.id));
    expect(reg.diagnostics).toEqual([]);
  });
});

// ── mask/erase:MaskStroke draft 生命周期 ─────────────────────────────────────

describe("mask/erase draft 生命周期(:1108-1116/:1159-1163/:1183-1191)", () => {
  it("down 建 MaskStroke draft:mode=paint,笔刷=短边×ratio(缺省 0.05)", () => {
    const h = makeCtx<MaskStroke>();
    maskTool.onDown?.(gev(), h.ctx);
    // 短边 600 × 0.05 = 30
    expect(h.draft()).toEqual({ mode: "paint", size: 30, points: [{ x: 10, y: 20 }] });
  });

  it("erase 的 draft mode=erase(:1113 mode 区分)", () => {
    const h = makeCtx<MaskStroke>();
    eraseTool.onDown?.(gev(), h.ctx);
    expect(h.draft()?.mode).toBe("erase");
  });

  it("笔刷读 prefs.brushRatio(4.2 装配同键)", () => {
    const h = makeCtx<MaskStroke>({ brushRatio: 0.1 });
    maskTool.onDown?.(gev(), h.ctx);
    expect(h.draft()?.size).toBe(60); // 600 × 0.1
  });

  it("naturalSize 不可得回退短边 1024(:1102);极小图钳 ≥1(:1112)", () => {
    const a = makeCtx<MaskStroke>();
    maskTool.onDown?.(gev({ naturalSize: null }), a.ctx);
    expect(a.draft()?.size).toBe(51); // round(1024 × 0.05)
    const b = makeCtx<MaskStroke>({ brushRatio: 0.025 });
    maskTool.onDown?.(gev({ naturalSize: { w: 8, h: 8 } }), b.ctx);
    expect(b.draft()?.size).toBe(1); // round(0.2) = 0 → 钳 1
  });

  it("natural 不可得手势不启动(:1106-1107)", () => {
    const h = makeCtx<MaskStroke>();
    maskTool.onDown?.(gev({ natural: null }), h.ctx);
    expect(h.draft()).toBeNull();
  });

  it("move 逐点累积;无 draft / natural 不可得时守卫无操作(:1156-1163)", () => {
    const h = makeCtx<MaskStroke>();
    maskTool.onMove?.(gev(), h.ctx); // 无 draft:不启动
    expect(h.draft()).toBeNull();
    maskTool.onDown?.(gev(), h.ctx);
    maskTool.onMove?.(gev({ natural: { x: 11, y: 21 } }), h.ctx);
    maskTool.onMove?.(gev({ natural: null }), h.ctx); // natural 缺席:忽略
    maskTool.onMove?.(gev({ natural: { x: 12, y: 22 } }), h.ctx);
    expect(h.draft()?.points).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
      { x: 12, y: 22 },
    ]);
  });

  it("up 提交 {kind:'stroke'} 并清 draft;单点笔迹亦提交(无成型判定,:1187-1191)", () => {
    const h = makeCtx<MaskStroke>();
    maskTool.onDown?.(gev(), h.ctx);
    maskTool.onUp?.(gev({ natural: null }), h.ctx);
    expect(h.committed).toEqual([
      { kind: "stroke", item: { mode: "paint", size: 30, points: [{ x: 10, y: 20 }] } },
    ]);
    expect(h.draft()).toBeNull();
  });

  it("up 无 draft 时不提交(drawing 守卫同构,:1183)", () => {
    const h = makeCtx<MaskStroke>();
    maskTool.onUp?.(gev(), h.ctx);
    expect(h.committed).toEqual([]);
  });
});

// ── draw:折线累积 ────────────────────────────────────────────────────────────

describe("draw draft 生命周期(:1126-1140/:1168-1169/:1196-1199)", () => {
  it("down 建 Annotation draft:kind=draw,from=to=p,points=[p],线宽=短边×0.008 钳 ≥3", () => {
    const h = makeCtx<Annotation>();
    drawTool.onDown?.(gev(), h.ctx);
    expect(h.draft()).toEqual({
      kind: "draw",
      from: { x: 10, y: 20 },
      to: { x: 10, y: 20 },
      points: [{ x: 10, y: 20 }],
      size: 5, // max(3, round(600 × 0.008)) = 5
      color: "#ef4444", // 缺省批注红
    });
  });

  it("颜色读 prefs.annoColor(4.2 装配同键);极小图线宽钳 ≥3(:1103)", () => {
    const h = makeCtx<Annotation>({ annoColor: "#3b82f6" });
    drawTool.onDown?.(gev({ naturalSize: { w: 100, h: 100 } }), h.ctx);
    expect(h.draft()?.color).toBe("#3b82f6");
    expect(h.draft()?.size).toBe(3); // round(0.8) → 钳 3
  });

  it("move 累积折线且同步 to(:1168-1169)", () => {
    const h = makeCtx<Annotation>();
    drawTool.onDown?.(gev(), h.ctx);
    drawTool.onMove?.(gev({ natural: { x: 30, y: 40 } }), h.ctx);
    expect(h.draft()?.to).toEqual({ x: 30, y: 40 });
    expect(h.draft()?.points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("up 按点数成型:≥2 提交 {kind:'anno'};单点丢弃;恒清 draft(:1196-1205)", () => {
    const kept = makeCtx<Annotation>();
    drawTool.onDown?.(gev(), kept.ctx);
    drawTool.onMove?.(gev({ natural: { x: 30, y: 40 } }), kept.ctx);
    drawTool.onUp?.(gev({ natural: null }), kept.ctx);
    expect(kept.committed.map((o) => o.kind)).toEqual(["anno"]);
    expect((kept.committed[0]?.item as Annotation).points).toHaveLength(2);
    expect(kept.draft()).toBeNull();

    const dropped = makeCtx<Annotation>();
    drawTool.onDown?.(gev(), dropped.ctx);
    drawTool.onUp?.(gev(), dropped.ctx); // 点按:单点
    expect(dropped.committed).toEqual([]);
    expect(dropped.draft()).toBeNull();
  });
});

// ── line/arrow:from/to 两点 ──────────────────────────────────────────────────

describe("line/arrow draft 生命周期(:1118-1124/:1170/:1196-1204)", () => {
  for (const [tool, kind] of [
    [lineTool, "line"],
    [arrowTool, "arrow"],
  ] as const) {
    it(`${kind}:down 建 from=to 草稿,move 只更新 to(无 points)`, () => {
      const h = makeCtx<Annotation>();
      tool.onDown?.(gev(), h.ctx);
      expect(h.draft()).toEqual({
        kind,
        from: { x: 10, y: 20 },
        to: { x: 10, y: 20 },
        size: 5,
        color: "#ef4444",
      });
      tool.onMove?.(gev({ natural: { x: 50, y: 20 } }), h.ctx);
      expect(h.draft()?.to).toEqual({ x: 50, y: 20 });
      expect(h.draft()?.points).toBeUndefined();
    });

    it(`${kind}:up 按 from/to 距离 ≥2 成型;零长点按丢弃;恒清 draft`, () => {
      const kept = makeCtx<Annotation>();
      tool.onDown?.(gev(), kept.ctx);
      tool.onMove?.(gev({ natural: { x: 13, y: 24 } }), kept.ctx); // 距离 5
      tool.onUp?.(gev({ natural: null }), kept.ctx);
      expect(kept.committed.map((o) => o.kind)).toEqual(["anno"]);
      expect(kept.draft()).toBeNull();

      const dropped = makeCtx<Annotation>();
      tool.onDown?.(gev(), dropped.ctx);
      tool.onMove?.(gev({ natural: { x: 11, y: 20 } }), dropped.ctx); // 距离 1 < 2
      tool.onUp?.(gev(), dropped.ctx);
      expect(dropped.committed).toEqual([]);
      expect(dropped.draft()).toBeNull();
    });
  }
});

// ── 光栅化("stroke"/"anno" opKinds + rasterizeDraft)──────────────────────────

describe("光栅化输出(:607-628 逻辑迁移)", () => {
  const SIZE = { w: 800, h: 600 };

  it("stroke:paint→source-over,粉红半透明,lineWidth=size,折线回放", () => {
    const { ctx, calls } = recCtx();
    const item: MaskStroke = {
      mode: "paint",
      size: 30,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    };
    maskTool.opKinds?.stroke?.(ctx, item, SIZE);
    expect(calls).toEqual([
      "save",
      "beginPath",
      "moveTo:1,2",
      "lineTo:3,4",
      "stroke:source-over:rgba(236,72,153,0.5):30",
      "restore",
    ]);
  });

  it("stroke:erase→destination-out 收回(:612)", () => {
    const { ctx, calls } = recCtx();
    const item: MaskStroke = { mode: "erase", size: 8, points: [{ x: 5, y: 6 }] };
    eraseTool.opKinds?.stroke?.(ctx, item, SIZE);
    expect(calls).toContain("stroke:destination-out:rgba(236,72,153,0.5):8");
  });

  it("stroke:单点 lineTo(x+0.01, y) 落点(:620);空点集整体跳过(:610)", () => {
    const single = recCtx();
    maskTool.opKinds?.stroke?.(
      single.ctx,
      { mode: "paint", size: 4, points: [{ x: 5, y: 6 }] } satisfies MaskStroke,
      SIZE,
    );
    expect(single.calls).toContain("lineTo:5.01,6");
    const empty = recCtx();
    maskTool.opKinds?.stroke?.(
      empty.ctx,
      { mode: "paint", size: 4, points: [] } satisfies MaskStroke,
      SIZE,
    );
    expect(empty.calls).toEqual([]);
  });

  it("anno:line 逐条绘制(drawAnnotations 语义,item 自带颜色)", () => {
    const { ctx, calls } = recCtx();
    const item: Annotation = {
      kind: "line",
      from: { x: 1, y: 2 },
      to: { x: 30, y: 40 },
      size: 5,
      color: "#3b82f6",
    };
    lineTool.opKinds?.anno?.(ctx, item, SIZE);
    expect(calls).toEqual(["beginPath", "moveTo:1,2", "lineTo:30,40", "stroke::#3b82f6:5"]);
  });

  it("anno:arrow 追加两条箭头头短线(:370-379 drawAnnotations)", () => {
    const { ctx, calls } = recCtx();
    const item: Annotation = {
      kind: "arrow",
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      size: 5,
    };
    arrowTool.opKinds?.anno?.(ctx, item, SIZE);
    // 主线 moveTo+lineTo,箭头头两侧各 moveTo(to)+lineTo。
    expect(calls.filter((c) => c.startsWith("moveTo"))).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith("lineTo"))).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith("stroke"))).toHaveLength(1);
  });

  it("anno:draw 折线回放(points 序)", () => {
    const { ctx, calls } = recCtx();
    const item: Annotation = {
      kind: "draw",
      from: { x: 1, y: 1 },
      to: { x: 3, y: 3 },
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      size: 5,
      color: "#ef4444",
    };
    drawTool.opKinds?.anno?.(ctx, item, SIZE);
    expect(calls).toEqual([
      "beginPath",
      "moveTo:1,1",
      "lineTo:2,2",
      "lineTo:3,3",
      "stroke::#ef4444:5",
    ]);
  });

  it("rasterizeDraft 与 opKinds 光栅化同函数(draft 预览=已提交回放语义,:608/:625)", () => {
    expect(maskTool.rasterizeDraft).toBe(maskTool.opKinds?.stroke);
    expect(eraseTool.rasterizeDraft).toBe(eraseTool.opKinds?.stroke);
    expect(drawTool.rasterizeDraft).toBe(drawTool.opKinds?.anno);
    expect(lineTool.rasterizeDraft).toBe(lineTool.opKinds?.anno);
    expect(arrowTool.rasterizeDraft).toBe(arrowTool.opKinds?.anno);
  });
});

// ── 选项条贡献(data-canvas-anno-colors / data-canvas-brush-sizes 锚点)────────

describe("选项条贡献(:1391-1438 锚点与行为)", () => {
  it("mask/erase 贡献笔刷三档(data-canvas-brush-sizes),点击写 prefs.brushRatio", () => {
    for (const tool of [maskTool, eraseTool]) {
      const h = makeCtx<MaskStroke>();
      const bar = tool.optionsBar?.(h.ctx);
      const props = propsOf(bar);
      expect(props["data-canvas-brush-sizes"]).toBe(true);
      const buttons = childrenOf(bar);
      expect(buttons).toHaveLength(3); // BRUSH_RATIOS 三档(:110)
      // 缺省选中中档 0.05(:459 BRUSH_RATIOS[1])。
      expect(buttons.map((b) => propsOf(b)["aria-pressed"])).toEqual([false, true, false]);
      expect(propsOf(buttons[0])["aria-label"]).toBe("笔刷 3%"); // round(2.5)
      (propsOf(buttons[2])["onClick"] as () => void)();
      expect(h.ctx.prefs.get<number>("brushRatio")).toBe(0.1);
    }
  });

  it("draw/line/arrow 贡献六色板(data-canvas-anno-colors),点击写 prefs.annoColor", () => {
    for (const tool of [drawTool, lineTool, arrowTool]) {
      const h = makeCtx<Annotation>();
      const bar = tool.optionsBar?.(h.ctx);
      const props = propsOf(bar);
      expect(props["data-canvas-anno-colors"]).toBe(true);
      const buttons = childrenOf(bar);
      expect(buttons).toHaveLength(6); // ANNOTATION_PALETTE 六色
      // 缺省选中首项批注红。
      expect(propsOf(buttons[0])["aria-pressed"]).toBe(true);
      expect(propsOf(buttons[0])["data-canvas-anno-color"]).toBe("#ef4444");
      (propsOf(buttons[3])["onClick"] as () => void)();
      expect(h.ctx.prefs.get<string>("annoColor")).toBe("#3b82f6");
    }
  });

  it("选中态跟随 prefs(重建选项条后 aria-pressed 位移)", () => {
    const h = makeCtx<Annotation>({ annoColor: "#22c55e" });
    const buttons = childrenOf(drawTool.optionsBar?.(h.ctx));
    expect(buttons.map((b) => propsOf(b)["aria-pressed"])).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("族界:mask/erase 不出颜色板;draw/line/arrow 不出笔刷档(:1391/:1416 条件)", () => {
    for (const tool of [maskTool, eraseTool]) {
      const props = propsOf(tool.optionsBar?.(makeCtx<MaskStroke>().ctx));
      expect(props["data-canvas-anno-colors"]).toBeUndefined();
    }
    for (const tool of [drawTool, lineTool, arrowTool]) {
      const props = propsOf(tool.optionsBar?.(makeCtx<Annotation>().ctx));
      expect(props["data-canvas-brush-sizes"]).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// task 3.2:非绘制族三工具(move/expand/text)+ registerBuiltinTools
// ═══════════════════════════════════════════════════════════════════════════════

/** 手势级 harness:panBy 记录 + defer **队列**(锚定「up 后」时机,text 特例)。 */
interface GestureHarness<TDraft> {
  readonly ctx: CanvasToolContext<TDraft>;
  readonly committed: CanvasOp[];
  readonly pans: { dx: number; dy: number }[];
  draft(): TDraft | null;
  /** 冲刷 defer 队列(模拟 tool-runtime 在 onUp 返回后的 FIFO 执行)。 */
  flushDefer(): void;
  deferredCount(): number;
}

function makeGestureCtx<TDraft>(
  prefsInit?: Readonly<Record<string, unknown>>,
): GestureHarness<TDraft> {
  let draft: TDraft | null = null;
  const committed: CanvasOp[] = [];
  const pans: { dx: number; dy: number }[] = [];
  const queue: Array<() => void> = [];
  const prefs = createPrefsStore(prefsInit);
  const ctx: CanvasToolContext<TDraft> = {
    draft: {
      get: () => draft,
      set: (d) => {
        draft = d;
      },
    },
    history: { commit: (op) => committed.push(op) },
    stage: { panBy: (dx, dy) => pans.push({ dx, dy }) },
    layers: { layers: [], selectedId: null, get: () => undefined },
    defer: (fn) => queue.push(fn),
    prefs,
  };
  return {
    ctx,
    committed,
    pans,
    draft: () => draft,
    flushDefer: () => {
      const q = [...queue];
      queue.length = 0;
      for (const fn of q) fn();
    },
    deferredCount: () => queue.length,
  };
}

// ── 声明形状(6.2)────────────────────────────────────────────────────────────

describe("非绘制族三工具声明形状(3.2)", () => {
  it("id 带 builtin: 前缀且命名与旧 StageTool 对应", () => {
    expect(moveTool.id).toBe("builtin:move");
    expect(expandTool.id).toBe("builtin:expand");
    expect(textTool.id).toBe("builtin:text");
  });

  it("label/icon/cursor 照工具轨与舞台现状(:1382/:1383/:1387/:1508/:1622)", () => {
    expect(moveTool.label).toBe("移动");
    expect(expandTool.label).toBe("扩图");
    expect(textTool.label).toBe("文本");
    for (const t of [moveTool, expandTool, textTool]) expect(isValidElement(t.icon)).toBe(true);
    expect(moveTool.cursor).toBe("grab"); // :1508 舞台平移 grab
    expect(expandTool.cursor).toBeUndefined(); // 扩图无 overlay 交互,手柄自带 resize 光标
    expect(textTool.cursor).toBe("text"); // :1622 cursor-text
  });

  it("capture 声明:text 不捕获(:1142);move/expand 缺省捕获", () => {
    expect(textTool.capturePointer).toBe(false);
    expect(moveTool.capturePointer !== false).toBe(true);
    expect(expandTool.capturePointer !== false).toBe(true);
  });

  it("opKinds:move/expand 无(不产 op);text 注册 anno 且与标注家族同函数", () => {
    expect(moveTool.opKinds).toBeUndefined();
    expect(expandTool.opKinds).toBeUndefined();
    expect(Object.keys(textTool.opKinds ?? {})).toEqual(["anno"]);
    expect(textTool.opKinds?.anno).toBe(drawTool.opKinds?.anno);
  });

  it("rasterizeDraft:三工具皆无(move/expand 无稿可栅;text 编辑器即预览)", () => {
    for (const t of [moveTool, expandTool, textTool]) expect(t.rasterizeDraft).toBeUndefined();
  });

  it("选项条:text 复用六色板(:1391 条件含 text);move/expand 无(:1391/:1416)", () => {
    const h = makeGestureCtx<TextDraft>();
    const bar = textTool.optionsBar?.(h.ctx as unknown as CanvasToolContext<never>);
    const props = propsOf(bar);
    expect(props["data-canvas-anno-colors"]).toBe(true);
    const buttons = childrenOf(bar);
    expect(buttons).toHaveLength(6);
    (propsOf(buttons[3])["onClick"] as () => void)();
    expect(h.ctx.prefs.get<string>("annoColor")).toBe("#3b82f6");
    expect(moveTool.optionsBar).toBeUndefined();
    expect(expandTool.optionsBar).toBeUndefined();
  });
});

// ── registerBuiltinTools(6.2/6.3 完成态:8 工具经注册表可枚举)─────────────────

describe("registerBuiltinTools(builtin/index.ts 汇总)", () => {
  it("8 工具按工具轨顺序注册(:1382-1389),id 全带 builtin: 前缀", () => {
    const reg = createCanvasRegistry();
    registerBuiltinTools(reg);
    expect(reg.tools.map((t) => t.id)).toEqual([
      "builtin:move",
      "builtin:expand",
      "builtin:draw",
      "builtin:line",
      "builtin:arrow",
      "builtin:text",
      "builtin:mask",
      "builtin:erase",
    ]);
    expect(reg.tools.every((t) => t.id.startsWith("builtin:"))).toBe(true);
    expect(reg.diagnostics).toEqual([]); // 无 id 冲突
  });

  it("per-instance:两注册表互不串扰(6.5)", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    registerBuiltinTools(a);
    expect(a.tools).toHaveLength(8);
    expect(b.tools).toHaveLength(0);
  });
});

// ── move:舞台平移(:1241-1252)─────────────────────────────────────────────────

describe("move 舞台平移(:1241-1252)", () => {
  /** stage 命中事件(natural 允许缺席,:1241-1248 不量 natural)。 */
  const stageEv = (deltaClient: { dx: number; dy: number }): ToolGestureEvent =>
    gev({ hit: { kind: "stage" }, natural: null, naturalSize: null, deltaClient });

  it("down(stage 命中)建锚;move 消费 deltaClient 累计位移增量 panBy(:1243/:1248)", () => {
    const h = makeGestureCtx<MoveDraft>();
    moveTool.onDown?.(stageEv({ dx: 0, dy: 0 }), h.ctx);
    expect(h.draft()).toEqual({ dx: 0, dy: 0 });
    moveTool.onMove?.(stageEv({ dx: 5, dy: 3 }), h.ctx);
    moveTool.onMove?.(stageEv({ dx: 12, dy: 10 }), h.ctx);
    // 事件载荷是自 down 起的累计位移;panBy 是增量 —— 增量序列合计=累计(offset 等价)。
    expect(h.pans).toEqual([
      { dx: 5, dy: 3 },
      { dx: 7, dy: 7 },
    ]);
  });

  it("up 清 draft 收束(endDrag :1250-1252);后续 move 无 pan(守卫 :1247)", () => {
    const h = makeGestureCtx<MoveDraft>();
    moveTool.onDown?.(stageEv({ dx: 0, dy: 0 }), h.ctx);
    moveTool.onUp?.(stageEv({ dx: 5, dy: 5 }), h.ctx);
    expect(h.draft()).toBeNull();
    moveTool.onMove?.(stageEv({ dx: 9, dy: 9 }), h.ctx);
    expect(h.pans).toEqual([]);
  });

  it("非 stage 命中 down 不启动(:1242 仅移动工具的舞台空白平移语义)", () => {
    const h = makeGestureCtx<MoveDraft>();
    moveTool.onDown?.(gev(), h.ctx); // overlay 命中
    expect(h.draft()).toBeNull();
    moveTool.onMove?.(stageEv({ dx: 5, dy: 5 }), h.ctx);
    expect(h.pans).toEqual([]);
  });

  it("无 down 直接 move 无操作(drag ref null 守卫 :1246-1247);全程零 commit", () => {
    const h = makeGestureCtx<MoveDraft>();
    moveTool.onMove?.(stageEv({ dx: 5, dy: 5 }), h.ctx);
    moveTool.onDown?.(stageEv({ dx: 0, dy: 0 }), h.ctx);
    moveTool.onMove?.(stageEv({ dx: 2, dy: 2 }), h.ctx);
    moveTool.onUp?.(stageEv({ dx: 2, dy: 2 }), h.ctx);
    expect(h.pans).toEqual([{ dx: 2, dy: 2 }]);
    expect(h.committed).toEqual([]); // move 不产 op(不可撤销)
  });
});

// ── expand:扩图边状态(:1016-1051)────────────────────────────────────────────

describe("expand 扩图边状态(:1016-1051;prefs 通道 expandEdges)", () => {
  const handleEv = (
    edge: keyof ExpandEdges,
    expandDelta: number | null,
  ): ToolGestureEvent => gev({ hit: { kind: "expand-handle", edge }, expandDelta });

  it("down 记 {edge, orig}(:1027 orig=expand[edge]);move 写 prefs.expandEdges=max(0,round(orig+Δ))(:1040)", () => {
    const h = makeGestureCtx<ExpandDraft>({
      [PREF_EXPAND_EDGES]: { top: 0, right: 40, bottom: 0, left: 0 },
    });
    expandTool.onDown?.(handleEv("right", 0), h.ctx);
    expect(h.draft()).toEqual({ edge: "right", orig: 40 });
    expandTool.onMove?.(handleEv("right", 12.4), h.ctx);
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)).toEqual({
      top: 0,
      right: 52, // round(40 + 12.4)
      bottom: 0,
      left: 0,
    });
  });

  it("expandDelta 是自 down 起累计量:orig 锚定不随帧漂移(:1027 闭包 orig 语义)", () => {
    const h = makeGestureCtx<ExpandDraft>({
      [PREF_EXPAND_EDGES]: { top: 0, right: 40, bottom: 0, left: 0 },
    });
    expandTool.onDown?.(handleEv("right", 0), h.ctx);
    expandTool.onMove?.(handleEv("right", 10), h.ctx);
    expandTool.onMove?.(handleEv("right", 25), h.ctx);
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)?.right).toBe(65); // 40+25,非 40+10+25
  });

  it("向内拖钳到 0(:1040 max(0, …));其余边保持", () => {
    const h = makeGestureCtx<ExpandDraft>({
      [PREF_EXPAND_EDGES]: { top: 7, right: 40, bottom: 0, left: 0 },
    });
    expandTool.onDown?.(handleEv("right", 0), h.ctx);
    expandTool.onMove?.(handleEv("right", -100), h.ctx);
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)).toEqual({
      top: 7,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("prefs 未注入初值:orig 缺省 0(NO_EXPAND 语义,:487)", () => {
    const h = makeGestureCtx<ExpandDraft>();
    expandTool.onDown?.(handleEv("top", 0), h.ctx);
    expect(h.draft()).toEqual({ edge: "top", orig: 0 });
    expandTool.onMove?.(handleEv("top", 10), h.ctx);
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)).toEqual({
      top: 10,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("expandDelta 缺席帧丢弃(:1029-1030 rect 不可得);无 down 的 move 无操作", () => {
    const h = makeGestureCtx<ExpandDraft>();
    expandTool.onMove?.(handleEv("left", 10), h.ctx); // 无 draft
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)).toBeUndefined();
    expandTool.onDown?.(handleEv("left", 0), h.ctx);
    expandTool.onMove?.(handleEv("left", null), h.ctx); // Δ 缺席
    expect(h.ctx.prefs.get<ExpandEdges>(PREF_EXPAND_EDGES)).toBeUndefined();
  });

  it("up 清 draft 且零 commit(setExpand 不入 ops,:1041 非可撤销)", () => {
    const h = makeGestureCtx<ExpandDraft>();
    expandTool.onDown?.(handleEv("bottom", 0), h.ctx);
    expandTool.onMove?.(handleEv("bottom", 5), h.ctx);
    expandTool.onUp?.(handleEv("bottom", 5), h.ctx);
    expect(h.draft()).toBeNull();
    expect(h.committed).toEqual([]);
  });

  it("非 expand-handle 命中 down 不启动(手柄专属手势)", () => {
    const h = makeGestureCtx<ExpandDraft>();
    expandTool.onDown?.(gev(), h.ctx); // overlay 命中
    expect(h.draft()).toBeNull();
  });
});

// ── text:down 记位 / up 经 defer 挂编辑器 / 编辑器提交(:1142-1153/:1176-1181/:1209-1225/:1726-1746)──

describe("text 文本标注(:1142-1153/:1176-1181/:1209-1225/:1726-1746)", () => {
  /** 走完 down→up→defer 冲刷,编辑器进入 editing 态。 */
  const openEditor = (h: GestureHarness<TextDraft>): void => {
    textTool.onDown?.(gev(), h.ctx);
    textTool.onUp?.(gev({ natural: null }), h.ctx);
    h.flushDefer();
  };
  /** 当前 overlayReact 编辑器 input 的 props(未挂载 → throw)。 */
  const editorInput = (h: GestureHarness<TextDraft>): Record<string, unknown> => {
    const overlay = textTool.overlayReact?.(h.ctx as unknown as CanvasToolContext<never>);
    const kids = childrenOf(overlay);
    return propsOf(kids[0]);
  };

  it("down 只记位(pending),不挂编辑器(:1142-1153 blur 特例前半)", () => {
    const h = makeGestureCtx<TextDraft>();
    textTool.onDown?.(gev(), h.ctx);
    expect(h.draft()).toEqual({
      phase: "pending",
      anchor: { x: 10, y: 20 },
      naturalSize: { w: 800, h: 600 },
      value: "",
    });
    // down 阶段 overlayReact 不渲染编辑器(挂载会被同次点击焦点转移 blur 掉)。
    expect(textTool.overlayReact?.(h.ctx as unknown as CanvasToolContext<never>)).toBeNull();
  });

  it("natural 不可得 down 不启动(:1106-1107);非 overlay 命中 down 不启动", () => {
    const h = makeGestureCtx<TextDraft>();
    textTool.onDown?.(gev({ natural: null }), h.ctx);
    expect(h.draft()).toBeNull();
    textTool.onDown?.(gev({ hit: { kind: "stage" } }), h.ctx);
    expect(h.draft()).toBeNull();
  });

  it("up 经 ctx.defer 挂编辑器(up 内清 pending、编辑态在 defer 冲刷后,:1176-1181)", () => {
    const h = makeGestureCtx<TextDraft>();
    textTool.onDown?.(gev(), h.ctx);
    textTool.onUp?.(gev({ natural: null }), h.ctx);
    // up 返回时:pending 已清(:1179),编辑器挂载动作在 defer 队列。
    expect(h.draft()).toBeNull();
    expect(h.deferredCount()).toBe(1);
    expect(textTool.overlayReact?.(h.ctx as unknown as CanvasToolContext<never>)).toBeNull();
    h.flushDefer();
    expect(h.draft()?.phase).toBe("editing");
    expect(h.draft()?.value).toBe("");
  });

  it("up 无 pending 时无操作(直接 up 不开编辑器)", () => {
    const h = makeGestureCtx<TextDraft>();
    textTool.onUp?.(gev(), h.ctx);
    h.flushDefer();
    expect(h.draft()).toBeNull();
  });

  it("编辑器:input 锚点/autoFocus/占位与初值(:1731-1736);容器按 natural 百分比定位", () => {
    const h = makeGestureCtx<TextDraft>();
    openEditor(h);
    const overlay = textTool.overlayReact?.(h.ctx as unknown as CanvasToolContext<never>);
    const wrapProps = propsOf(overlay);
    const style = wrapProps["style"] as Record<string, unknown>;
    expect(style["left"]).toBe(`${(10 / 800) * 100}%`);
    expect(style["top"]).toBe(`${(20 / 600) * 100}%`);
    const input = editorInput(h);
    expect(input["data-canvas-text-editor"]).toBe(true);
    expect(input["autoFocus"]).toBe(true);
    expect(input["aria-label"]).toBe("标注文本");
    expect(input["placeholder"]).toBe("标注文本,回车确认…");
    expect(input["value"]).toBe("");
  });

  it("输入写回 draft.value(受控 input,:1737)", () => {
    const h = makeGestureCtx<TextDraft>();
    openEditor(h);
    const onChange = editorInput(h)["onChange"] as (e: { target: { value: string } }) => void;
    onChange({ target: { value: "红色气球" } });
    expect(h.draft()?.value).toBe("红色气球");
  });

  it("Enter 提交:{kind:'anno'} text 项(from=to=锚点,size=annoSize×2,:1209-1225);清编辑态", () => {
    const h = makeGestureCtx<TextDraft>();
    openEditor(h);
    (editorInput(h)["onChange"] as (e: { target: { value: string } }) => void)({
      target: { value: "  红色气球  " },
    });
    (editorInput(h)["onKeyDown"] as (e: { key: string }) => void)({ key: "Enter" });
    expect(h.committed).toEqual([
      {
        kind: "anno",
        item: {
          kind: "text",
          from: { x: 10, y: 20 },
          to: { x: 10, y: 20 },
          text: "红色气球", // trim(:1211)
          size: 10, // max(3, round(600×0.008))×2 = 5×2(:1103/:1218)
          color: "#ef4444",
        },
      },
    ]);
    expect(h.draft()).toBeNull();
  });

  it("空白值提交:不入 op 但编辑器关闭(:1212 value!=='' 门);Escape 取消零提交(:1740)", () => {
    const blank = makeGestureCtx<TextDraft>();
    openEditor(blank);
    (editorInput(blank)["onKeyDown"] as (e: { key: string }) => void)({ key: "Enter" });
    expect(blank.committed).toEqual([]);
    expect(blank.draft()).toBeNull();

    const esc = makeGestureCtx<TextDraft>();
    openEditor(esc);
    (editorInput(esc)["onChange"] as (e: { target: { value: string } }) => void)({
      target: { value: "弃稿" },
    });
    (editorInput(esc)["onKeyDown"] as (e: { key: string }) => void)({ key: "Escape" });
    expect(esc.committed).toEqual([]);
    expect(esc.draft()).toBeNull();
  });

  it("blur 提交(onBlur=commitText,:1742);颜色读 prefs.annoColor", () => {
    const h = makeGestureCtx<TextDraft>({ annoColor: "#3b82f6" });
    openEditor(h);
    (editorInput(h)["onChange"] as (e: { target: { value: string } }) => void)({
      target: { value: "蓝字" },
    });
    (editorInput(h)["onBlur"] as () => void)();
    expect(h.committed.map((o) => o.kind)).toEqual(["anno"]);
    expect((h.committed[0]?.item as Annotation).color).toBe("#3b82f6");
    expect(h.draft()).toBeNull();
  });

  it("编辑中再次 down:先提交在编内容再记新位(旧世界 blur 先行提交的结构化复刻)", () => {
    const h = makeGestureCtx<TextDraft>();
    openEditor(h);
    (editorInput(h)["onChange"] as (e: { target: { value: string } }) => void)({
      target: { value: "上一条" },
    });
    textTool.onDown?.(gev({ natural: { x: 50, y: 60 } }), h.ctx);
    expect(h.committed.map((o) => (o.item as Annotation).text)).toEqual(["上一条"]);
    expect(h.draft()).toEqual({
      phase: "pending",
      anchor: { x: 50, y: 60 },
      naturalSize: { w: 800, h: 600 },
      value: "",
    });
  });

  it("text 的 anno 光栅化含 fillText 分支(bitmap-io drawAnnotations :342-346)", () => {
    const { ctx, calls } = recCtx();
    const item: Annotation = {
      kind: "text",
      from: { x: 12, y: 34 },
      to: { x: 12, y: 34 },
      text: "hi",
      size: 10,
    };
    textTool.opKinds?.anno?.(ctx, item, { w: 800, h: 600 });
    expect(calls).toContain("fillText:hi:12,34");
  });
});

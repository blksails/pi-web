/**
 * builtin 绘制族五工具单测(task 3.1,Req 6.2/6.3;design「Testing Strategy」#5)。
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
import {
  createCanvasRegistry,
  createPrefsStore,
  type CanvasTool,
  type CanvasToolContext,
  type ToolGestureEvent,
} from "../src/registry.js";
import type { Annotation, CanvasOp, MaskStroke } from "../src/index.js";
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

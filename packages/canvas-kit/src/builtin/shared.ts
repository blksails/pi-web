/**
 * builtin/shared — 绘制族内置工具共用件(task 3.1,Req 6.2/6.3;**包内私有**,
 * 不进包根出口)。
 *
 * design File Structure 只细分 8 个工具文件;族内共用的常量/光栅化/选项条/draft
 * 骨架若在各文件重复即散点回潮,故按内聚收拢于此(mask↔erase 共享 MaskStroke
 * 骨架与笔刷档,draw/line/arrow 共享 Annotation 骨架与色板;text 的色板 3.2 复用)。
 *
 * 语义逐一迁移自 canvas-workbench(行号=design 基线,恒等映射):
 * - 笔刷三档 BRUSH_RATIOS / 标注线宽比例 ANNOTATION_RATIO(:109-113);
 * - 短边基数(未量到回退 1024,:1102)与笔刷直径钳 ≥1(:1112)/标注线宽钳 ≥3(:1103);
 * - draft 生命周期(:1105-1207):down 建稿(natural 不可得不启动)/move 累积
 *   (无 draft 守卫=旧 drawing.current)/up 成型判定 + commit + 恒清 draft
 *   (2.5 留账:成型判定/清 draft 是工具回调语义,:1196-1204 逐分支复刻);
 * - "stroke" 光栅化(:607-624 overlay 回放逐笔逻辑):粉红半透明=编辑区,
 *   erase→destination-out 收回;"anno" 光栅化复用 bitmap-io drawAnnotations
 *   (:625-627,不重复实现);
 * - 选项条(:1391-1438):色板(data-canvas-anno-colors)/笔刷档
 *   (data-canvas-brush-sizes)锚点与 aria 原样保持。
 *
 * prefs 键名(本任务定死;4.2 装配注入初值须同键,2.6 留账「扁平 KV,annoColor
 * 跨工具共享=旧单 state 语义」):
 * - `annoColor`: string(缺省 ANNOTATION_COLOR 批注红,:461);
 * - `brushRatio`: number(缺省 BRUSH_RATIOS[1]=0.05,:459)。
 *
 * 纪律红线(4.3 grep 线):本目录零 DOM 监听/零视口数学 —— 事件只经
 * ToolGestureEvent 语义载荷,坐标恒为 L1 已换算的底图像素。
 */
import { createElement, type ReactNode } from "react";
import type { Annotation, MaskStroke } from "../types.js";
import {
  ANNOTATION_COLOR,
  ANNOTATION_PALETTE,
  drawAnnotations,
  type Ctx2DLike,
} from "../bitmap-io.js";
import type { CanvasPrefs, CanvasToolContext, ToolGestureEvent } from "../registry.js";

// ── prefs 键(4.2 装配注入初值同键)───────────────────────────────────────────

export const PREF_ANNO_COLOR = "annoColor";
export const PREF_BRUSH_RATIO = "brushRatio";

// ── 常量(workbench :109-113 原样迁移)────────────────────────────────────────

/** 笔刷直径预设:占源图**短边**的比例(固定像素对小图荒谬——1×1 占位图一笔全屏)。 */
export const BRUSH_RATIOS = [0.025, 0.05, 0.1] as const;

/** 标注线宽:短边比例(固定,不入笔刷三档)。 */
export const ANNOTATION_RATIO = 0.008;

/** 未量到源图尺寸时的短边回退基数(:1102)。 */
const FALLBACK_SHORT_EDGE = 1024;

/** overlay 掩码笔迹预览色(半透明粉红=编辑区,对应 alpha mask 透明洞,:613)。 */
const STROKE_PREVIEW_STYLE = "rgba(236,72,153,0.5)";

// ── 尺寸计算(:1102-1112)─────────────────────────────────────────────────────

const shortEdgeOf = (size: ToolGestureEvent["naturalSize"]): number =>
  size !== null ? Math.min(size.w, size.h) : FALLBACK_SHORT_EDGE;

const brushRatioOf = (prefs: CanvasPrefs): number =>
  prefs.get<number>(PREF_BRUSH_RATIO) ?? BRUSH_RATIOS[1];

const annoColorOf = (prefs: CanvasPrefs): string =>
  prefs.get<string>(PREF_ANNO_COLOR) ?? ANNOTATION_COLOR;

/** 笔刷直径 = 短边 × 比例(钳到 ≥1px,:1112)。 */
const brushDiameter = (ev: ToolGestureEvent, prefs: CanvasPrefs): number =>
  Math.max(1, Math.round(shortEdgeOf(ev.naturalSize) * brushRatioOf(prefs)));

/** 标注线宽 = 短边 × ANNOTATION_RATIO(钳到 ≥3,:1103)。 */
const annoLineWidth = (ev: ToolGestureEvent): number =>
  Math.max(3, Math.round(shortEdgeOf(ev.naturalSize) * ANNOTATION_RATIO));

// ── 光栅化(opKinds "stroke"/"anno";签名=kernel/history OpRasterizer)─────────

/**
 * "stroke" 光栅化:一笔掩码笔迹的 overlay 预览回放(:607-624 逐笔逻辑)。
 * paint→source-over 叠加,erase→destination-out 收回;单点笔迹以 +0.01 微移
 * 落出圆点(round cap);空点集整体跳过(:610)。fake ctx 缺路径原语时静默跳过
 * (drawAnnotations 同款守卫)。
 */
export function rasterizeStrokeItem(
  ctx: Ctx2DLike,
  item: unknown,
  _size: { readonly w: number; readonly h: number },
): void {
  const s = item as MaskStroke;
  if (s.points.length === 0) return;
  if (
    typeof ctx.beginPath !== "function" ||
    typeof ctx.moveTo !== "function" ||
    typeof ctx.lineTo !== "function" ||
    typeof ctx.stroke !== "function"
  ) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = s.mode === "erase" ? "destination-out" : "source-over";
  ctx.strokeStyle = STROKE_PREVIEW_STYLE;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const [first, ...rest] = s.points;
  ctx.moveTo(first!.x, first!.y);
  if (rest.length === 0) ctx.lineTo(first!.x + 0.01, first!.y);
  else for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * "anno" 光栅化:单条标注绘制,复用 bitmap-io `drawAnnotations`(:625-627 语义;
 * item 自带颜色优先,缺省整体批注红)。
 */
export function rasterizeAnnoItem(
  ctx: Ctx2DLike,
  item: unknown,
  _size: { readonly w: number; readonly h: number },
): void {
  drawAnnotations(ctx, [item as Annotation]);
}

// ── MaskStroke 骨架(mask/erase 共享;:1108-1116/:1159-1163/:1183-1191)────────

export interface StrokeToolCallbacks {
  onDown(ev: ToolGestureEvent, ctx: CanvasToolContext<MaskStroke>): void;
  onMove(ev: ToolGestureEvent, ctx: CanvasToolContext<MaskStroke>): void;
  onUp(ev: ToolGestureEvent, ctx: CanvasToolContext<MaskStroke>): void;
}

/** mask/erase 的 draft 生命周期(mode 区分,:1113;up 无成型判定直接提交,:1187-1191)。 */
export function strokeToolCallbacks(mode: MaskStroke["mode"]): StrokeToolCallbacks {
  return {
    onDown: (ev, ctx) => {
      if (ev.natural === null) return; // 坐标不可得:手势不启动(:1106-1107)
      ctx.draft.set({ mode, size: brushDiameter(ev, ctx.prefs), points: [ev.natural] });
    },
    onMove: (ev, ctx) => {
      const d = ctx.draft.get();
      if (d === null || ev.natural === null) return; // drawing 守卫同构(:1156-1158)
      ctx.draft.set({ ...d, points: [...d.points, ev.natural] });
    },
    onUp: (_ev, ctx) => {
      const d = ctx.draft.get();
      if (d === null) return; // 无稿:无操作(:1183)
      ctx.draft.set(null); // up 恒清 draft(2.5 留账)
      ctx.history.commit({ kind: "stroke", item: d }); // 单点亦提交(无成型判定)
    },
  };
}

// ── Annotation 骨架(draw/line/arrow 共享;:1118-1140/:1165-1173/:1193-1206)───

export interface AnnoToolCallbacks {
  onDown(ev: ToolGestureEvent, ctx: CanvasToolContext<Annotation>): void;
  onMove(ev: ToolGestureEvent, ctx: CanvasToolContext<Annotation>): void;
  onUp(ev: ToolGestureEvent, ctx: CanvasToolContext<Annotation>): void;
}

/**
 * draw/line/arrow 的 draft 生命周期:
 * - draw:points 折线累积(:1126-1140/:1168-1169),up 按点数 ≥2 成型(:1198-1199);
 * - line/arrow:from/to 两点(:1118-1124/:1170),up 按距离 ≥2 成型(零长点按丢弃,
 *   :1200);
 * - up 恒清 draft(:1205)。
 */
export function annoToolCallbacks(kind: "draw" | "line" | "arrow"): AnnoToolCallbacks {
  return {
    onDown: (ev, ctx) => {
      if (ev.natural === null) return; // :1106-1107
      const p = ev.natural;
      const base = { from: p, to: p, size: annoLineWidth(ev), color: annoColorOf(ctx.prefs) };
      ctx.draft.set(kind === "draw" ? { kind, ...base, points: [p] } : { kind, ...base });
    },
    onMove: (ev, ctx) => {
      const prev = ctx.draft.get();
      if (prev === null || ev.natural === null) return; // :1156-1158/:1165
      const p = ev.natural;
      ctx.draft.set(
        prev.kind === "draw" ? { ...prev, to: p, points: [...(prev.points ?? []), p] } : { ...prev, to: p },
      ); // :1167-1170
    },
    onUp: (_ev, ctx) => {
      const a = ctx.draft.get();
      if (a === null) return; // :1183
      ctx.draft.set(null); // 恒清 draft(:1205)
      // 成型判定:画笔按点数(≥2);拖拽型按 from/to 距离(零长点按丢弃)。(:1196-1200)
      const keep =
        a.kind === "draw"
          ? (a.points?.length ?? 0) >= 2
          : Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) >= 2;
      if (keep) ctx.history.commit({ kind: "anno", item: a }); // :1201-1203
    },
  };
}

// ── 选项条贡献(:1391-1438 锚点/aria/行为原样)────────────────────────────────

const OPTION_BLOCK_CLASS = "flex flex-col items-center gap-1 py-1";
const OPTION_BUTTON_CLASS = "flex h-6 w-6 items-center justify-center rounded-full transition-colors";
const optionButtonClass = (selected: boolean): string =>
  `${OPTION_BUTTON_CLASS} ${selected ? "bg-[hsl(var(--accent))]" : "hover:bg-[hsl(var(--muted))]"}`;

/** 标注色板(data-canvas-anno-colors;draw/line/arrow 共享,text 3.2 复用)。 */
export function annoColorOptions(ctx: CanvasToolContext<Annotation>): ReactNode {
  const current = annoColorOf(ctx.prefs);
  return createElement(
    "div",
    { className: OPTION_BLOCK_CLASS, "data-canvas-anno-colors": true },
    ANNOTATION_PALETTE.map((c) =>
      createElement(
        "button",
        {
          key: c,
          type: "button",
          "aria-pressed": current === c,
          "aria-label": `标注颜色 ${c}`,
          title: `标注颜色 ${c}`,
          "data-canvas-anno-color": c,
          onClick: () => ctx.prefs.set(PREF_ANNO_COLOR, c),
          className: optionButtonClass(current === c),
        },
        createElement("span", {
          className: "h-3.5 w-3.5 rounded-full border border-[hsl(var(--border))]",
          style: { backgroundColor: c },
        }),
      ),
    ),
  );
}

/** 笔刷三档(data-canvas-brush-sizes;mask/erase 共享)。 */
export function brushSizeOptions(ctx: CanvasToolContext<MaskStroke>): ReactNode {
  const current = brushRatioOf(ctx.prefs);
  return createElement(
    "div",
    { className: OPTION_BLOCK_CLASS, "data-canvas-brush-sizes": true },
    BRUSH_RATIOS.map((r) =>
      createElement(
        "button",
        {
          key: r,
          type: "button",
          "aria-pressed": current === r,
          "aria-label": `笔刷 ${Math.round(r * 100)}%`,
          title: `笔刷(短边 ${Math.round(r * 100)}%)`,
          onClick: () => ctx.prefs.set(PREF_BRUSH_RATIO, r),
          className: optionButtonClass(current === r),
        },
        createElement("span", {
          className: "rounded-full bg-[hsl(var(--foreground))]",
          style: { width: 4 + (r / 0.1) * 10, height: 4 + (r / 0.1) * 10 },
        }),
      ),
    ),
  );
}

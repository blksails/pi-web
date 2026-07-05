/**
 * builtin:text — 文本标注(down 记位、up 经 defer 挂编辑器;task 3.2,Req 6.2/6.3)。
 *
 * 语义迁移自 canvas-workbench:
 * - down 只记位不捕获(:1142-1153;capturePointer:false 的声明化 —— down 挂载
 *   编辑器会被同次点击的焦点转移 blur 掉);仅 overlay 命中启动(旧 handler 挂在
 *   overlay 画布上,空白舞台点击不记位);
 * - up 清 pending、经 **ctx.defer** 挂编辑器(:1176-1181 pendingText→setTextEditor;
 *   defer=「onUp 返回后」的通用化承载,design CanvasToolContext.defer);
 * - 编辑器 = overlayReact 贡献(:1726-1746):受控 input、autoFocus、回车提交/
 *   Esc 取消/blur 提交(commitText :1209-1225:trim 非空才入 op,kind:"text",
 *   from=to=锚点,size=标注线宽×2(:1218),color=prefs.annoColor);
 * - 编辑中再次 down:先提交在编内容再记新位(旧世界该点击触发 input blur→
 *   commitText 先行;单 draft 槽下由工具显式复刻,免依赖 DOM blur 派发时序)。
 *
 * draft = 编辑生命周期状态机(pending 记位 → editing 编辑):value 变更走
 * ctx.draft.set → L1 state 通道通知重渲,overlayReact 重取。锚点/字号基数用
 * down 时的 natural 坐标与 naturalSize(旧 commitText 用提交时 natural,编辑期间
 * 尺寸不变,等价)。
 *
 * 编辑器定位:旧世界用 stage 相对 client px(:1146-1151 经 stage rect 量取)——
 * builtin/ 纪律禁 DOM 量取(4.3 grep 线),改以 **natural 坐标百分比**定位
 * (同一点击点的等价表达:natural 即该 client 点经 toNatural 的线性映射)。
 * 4.2 装配契约:overlayReact 挂载进与 overlay 画布重合的定位容器(baseRect 面)。
 * 无 rasterizeDraft(编辑器本身即预览);opKinds 注册 "anno"(与标注家族同函数,
 * 重复注册被 history 注册表拒绝是无损语义,3.1 留账②);选项条复用六色板
 * (:1391 显示条件含 text)。
 */
import { createElement, type ReactNode } from "react";
import { Type } from "lucide-react";
import type { Annotation } from "../types.js";
import { defineCanvasTool, type CanvasToolContext } from "../registry.js";
import { annoColorOf, annoColorOptions, annoLineWidthOf, rasterizeAnnoItem } from "./shared.js";

/** 文本标注 draft:pending=已记位待 up;editing=编辑器在编。 */
export interface TextDraft {
  readonly phase: "pending" | "editing";
  /** 锚点(源图像素坐标;提交时 from=to=anchor,:1215-1216)。 */
  readonly anchor: { readonly x: number; readonly y: number };
  /** down 时源图尺寸(字号基数与百分比定位;未量到 → null 回退)。 */
  readonly naturalSize: { readonly w: number; readonly h: number } | null;
  readonly value: string;
}

/** 提交在编内容(commitText :1209-1225):trim 非空才入 op;恒清编辑态。 */
const commitEditor = (ctx: CanvasToolContext<TextDraft>): void => {
  const d = ctx.draft.get();
  if (d === null || d.phase !== "editing") return; // 已提交/已取消:no-op(:1210)
  ctx.draft.set(null);
  const value = d.value.trim();
  if (value === "") return; // 空白不入 op(:1212)
  const anno: Annotation = {
    kind: "text",
    from: d.anchor,
    to: d.anchor,
    text: value,
    size: annoLineWidthOf(d.naturalSize) * 2, // 字号基数 = 标注线宽 × 2(:1103/:1218)
    color: annoColorOf(ctx.prefs),
  };
  ctx.history.commit({ kind: "anno", item: anno }); // :1221-1222
};

/** 浮动编辑器(:1726-1746;input 锚点/aria/占位/键位/blur 语义原样)。 */
const textEditorOverlay = (ctx: CanvasToolContext<TextDraft>): ReactNode => {
  const d = ctx.draft.get();
  if (d === null || d.phase !== "editing") return null;
  const nat = d.naturalSize;
  return createElement(
    "div",
    {
      // pointer-events-auto:4.2 装配契约的定位容器为 pointer-events-none(编辑器
      // 不在编时不得夺 overlay 命中),编辑器自身恢复可交互。
      className: "pointer-events-auto absolute z-20",
      style: {
        left: nat !== null ? `${(d.anchor.x / nat.w) * 100}%` : "0%",
        top: nat !== null ? `${(d.anchor.y / nat.h) * 100}%` : "0%",
      },
    },
    createElement("input", {
      autoFocus: true,
      "data-canvas-text-editor": true,
      "aria-label": "标注文本",
      value: d.value,
      placeholder: "标注文本,回车确认…",
      onChange: (e: { target: { value: string } }) => {
        const cur = ctx.draft.get();
        if (cur !== null && cur.phase === "editing") {
          ctx.draft.set({ ...cur, value: e.target.value });
        }
      },
      onKeyDown: (e: { key: string }) => {
        if (e.key === "Enter") commitEditor(ctx); // :1739
        if (e.key === "Escape") ctx.draft.set(null); // 取消不提交(:1740)
      },
      onBlur: () => commitEditor(ctx), // :1742
      className:
        "h-7 w-44 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs shadow-sm outline-none",
    }),
  );
};

export const textTool = defineCanvasTool<TextDraft>({
  id: "builtin:text",
  label: "文本",
  icon: createElement(Type, { className: "h-4 w-4" }),
  cursor: "text", // :1622 cursor-text
  overlayInteractive: true, // 手势面=overlay(4.2 装配门控声明化)
  capturePointer: false, // down 不捕获(:1142-1153)
  onDown: (ev, ctx) => {
    if (ev.hit.kind !== "overlay" || ev.natural === null) return; // :1106-1107 + overlay 专属
    commitEditor(ctx); // 编辑中再点:先提交在编内容(旧 blur 先行语义)
    ctx.draft.set({ phase: "pending", anchor: ev.natural, naturalSize: ev.naturalSize, value: "" });
  },
  onUp: (_ev, ctx) => {
    const d = ctx.draft.get();
    if (d === null || d.phase !== "pending") return;
    ctx.draft.set(null); // 清 pending(:1179)
    ctx.defer(() => ctx.draft.set({ ...d, phase: "editing", value: "" })); // up 后挂编辑器(:1180)
  },
  overlayReact: textEditorOverlay,
  opKinds: { anno: rasterizeAnnoItem },
  optionsBar: annoColorOptions,
});

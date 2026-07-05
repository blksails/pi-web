/**
 * builtin:mask — 掩码刷(task 3.1,Req 6.2/6.3)。
 *
 * MaskStroke draft(mode=paint 涂编辑区,:1113);笔刷直径=短边×prefs.brushRatio
 * 钳 ≥1(:1112);up 直接提交 {kind:"stroke"}(无成型判定,:1187-1191)。
 * 图标/标签照工具轨现状(:1388);cursor=crosshair(:1624)。
 */
import { createElement } from "react";
import { Brush } from "lucide-react";
import type { MaskStroke } from "../types.js";
import { defineCanvasTool } from "../registry.js";
import { brushSizeOptions, rasterizeStrokeItem, strokeToolCallbacks } from "./shared.js";

export const maskTool = defineCanvasTool<MaskStroke>({
  id: "builtin:mask",
  label: "掩码刷",
  icon: createElement(Brush, { className: "h-4 w-4" }),
  cursor: "crosshair",
  overlayInteractive: true, // 手势面=overlay(4.2 装配门控声明化)
  ...strokeToolCallbacks("paint"),
  rasterizeDraft: rasterizeStrokeItem,
  opKinds: { stroke: rasterizeStrokeItem },
  optionsBar: brushSizeOptions,
});

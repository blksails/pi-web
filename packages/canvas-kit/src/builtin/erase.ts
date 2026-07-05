/**
 * builtin:erase — 掩码擦除(task 3.1,Req 6.2/6.3)。
 *
 * 与 mask 同骨架,mode=erase(收回编辑区,:1113;光栅化 destination-out,:612)。
 * 图标/标签照工具轨现状(:1389)。
 */
import { createElement } from "react";
import { Eraser } from "lucide-react";
import type { MaskStroke } from "../types.js";
import { defineCanvasTool } from "../registry.js";
import { brushSizeOptions, rasterizeStrokeItem, strokeToolCallbacks } from "./shared.js";

export const eraseTool = defineCanvasTool<MaskStroke>({
  id: "builtin:erase",
  label: "擦除",
  icon: createElement(Eraser, { className: "h-4 w-4" }),
  cursor: "crosshair",
  ...strokeToolCallbacks("erase"),
  rasterizeDraft: rasterizeStrokeItem,
  opKinds: { stroke: rasterizeStrokeItem },
  optionsBar: brushSizeOptions,
});

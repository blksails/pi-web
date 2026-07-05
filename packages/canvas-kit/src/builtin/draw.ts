/**
 * builtin:draw — 自由画笔(标注家族,烤进批注参考图;task 3.1,Req 6.2/6.3)。
 *
 * Annotation draft(kind=draw):points 折线累积(:1126-1140/:1168-1169);
 * up 按点数 ≥2 成型提交 {kind:"anno"}(:1198-1199)。图标/标签照工具轨现状(:1384)。
 */
import { createElement } from "react";
import { Pencil } from "lucide-react";
import type { Annotation } from "../types.js";
import { defineCanvasTool } from "../registry.js";
import { annoColorOptions, annoToolCallbacks, rasterizeAnnoItem } from "./shared.js";

export const drawTool = defineCanvasTool<Annotation>({
  id: "builtin:draw",
  label: "画笔",
  icon: createElement(Pencil, { className: "h-4 w-4" }),
  cursor: "crosshair",
  ...annoToolCallbacks("draw"),
  rasterizeDraft: rasterizeAnnoItem,
  opKinds: { anno: rasterizeAnnoItem },
  optionsBar: annoColorOptions,
});

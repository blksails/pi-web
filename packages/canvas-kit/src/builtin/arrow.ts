/**
 * builtin:arrow — 箭头标注(task 3.1,Req 6.2/6.3)。
 *
 * Annotation draft(kind=arrow):from/to 两点(:1118-1124/:1170),光栅化带箭头头
 * (drawAnnotations :370-379);up 按距离 ≥2 成型(:1200)。图标/标签照工具轨现状
 * (:1386)。
 */
import { createElement } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Annotation } from "../types.js";
import { defineCanvasTool } from "../registry.js";
import { annoColorOptions, annoToolCallbacks, rasterizeAnnoItem } from "./shared.js";

export const arrowTool = defineCanvasTool<Annotation>({
  id: "builtin:arrow",
  label: "箭头",
  icon: createElement(ArrowUpRight, { className: "h-4 w-4" }),
  cursor: "crosshair",
  ...annoToolCallbacks("arrow"),
  rasterizeDraft: rasterizeAnnoItem,
  opKinds: { anno: rasterizeAnnoItem },
  optionsBar: annoColorOptions,
});

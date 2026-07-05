/**
 * builtin:line — 画线标注(task 3.1,Req 6.2/6.3)。
 *
 * Annotation draft(kind=line):from/to 两点(:1118-1124/:1170);up 按 from/to
 * 距离 ≥2 成型(零长点按丢弃,:1200)。图标/标签照工具轨现状(:1385)。
 */
import { createElement } from "react";
import { Slash } from "lucide-react";
import type { Annotation } from "../types.js";
import { defineCanvasTool } from "../registry.js";
import { annoColorOptions, annoToolCallbacks, rasterizeAnnoItem } from "./shared.js";

export const lineTool = defineCanvasTool<Annotation>({
  id: "builtin:line",
  label: "画线",
  icon: createElement(Slash, { className: "h-4 w-4" }),
  cursor: "crosshair",
  overlayInteractive: true, // 手势面=overlay(4.2 装配门控声明化)
  ...annoToolCallbacks("line"),
  rasterizeDraft: rasterizeAnnoItem,
  opKinds: { anno: rasterizeAnnoItem },
  optionsBar: annoColorOptions,
});

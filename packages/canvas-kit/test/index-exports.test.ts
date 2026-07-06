/**
 * @blksails/pi-web-canvas-kit 包根出口 smoke 测试。
 *
 * 守护出口纪律(Req 1.3/1.4):
 * - src/index.ts 是 L2 唯一出口,可被解析;
 * - kernel/ 内部件(L1)不出现在包根出口;
 * - 当前 L2 面 = types(canonical 家)+ bitmap-io(task 1.2)+ registry 装置
 *   (defineCanvasTool/createCanvasRegistry,task 2.6)+ registerBuiltinTools
 *   (task 3.2;单个内置工具不出口,经注册表枚举消费)+ createCanvasKernel
 *   装配门面(task 4.1;收口的装配 API,非 kernel/* re-export)。
 */
import { describe, it, expect } from "vitest";
import * as canvasKit from "../src/index.js";
import type { Annotation, CanvasOp, ExpandEdges, MaskStroke, WorkLayer } from "../src/index.js";
import type { CanvasTool, CanvasToolContext, ToolGestureEvent } from "../src/index.js";

describe("@blksails/pi-web-canvas-kit public exports", () => {
  it("包根出口(L2 唯一出口)可解析", () => {
    expect(canvasKit).toBeTypeOf("object");
  });

  it("出口纪律:包根值导出=bitmap-io 19 项 + registry 装置 2 项 + actions 契约 2 项 + 图层契约 2 项 + builtin 汇总 1 项 + prefs 键契约 4 项 + 装配门面 1 项,无 kernel 内部件泄漏(task 1.1/1.2/1.3 快照)", () => {
    expect(Object.keys(canvasKit).sort()).toEqual([
      "ANNOTATION_COLOR",
      "ANNOTATION_PALETTE",
      "BRUSH_RATIOS",
      "PREF_ANNO_COLOR",
      "PREF_BRUSH_RATIO",
      "PREF_EXPAND_EDGES",
      "annotationsToImage",
      "clampRect",
      "compositeByMask",
      "createCanvasKernel",
      "createCanvasRegistry",
      "createMask",
      "cropImage",
      "defineCanvasAction",
      "defineCanvasLayer",
      "defineCanvasTool",
      "drawAnnotations",
      "expandedSize",
      "flattenLayers",
      "hasExpand",
      "hasMaskContent",
      "outpaintImage",
      "outpaintMask",
      "parseDataUri",
      "registerBuiltinTools",
      "registerPluginBundles",
      "resolveAction",
      "rotateImage",
      "rotatedSize",
      "strokesToMask",
      "uploadDataUri",
    ]);
  });

  it("prefs 键契约(4.2 装配注入初值同键):annoColor/brushRatio/expandEdges + 笔刷档位", () => {
    expect(canvasKit.PREF_ANNO_COLOR).toBe("annoColor");
    expect(canvasKit.PREF_BRUSH_RATIO).toBe("brushRatio");
    expect(canvasKit.PREF_EXPAND_EDGES).toBe("expandEdges");
    expect(canvasKit.BRUSH_RATIOS).toEqual([0.025, 0.05, 0.1]);
  });

  it("类型 canonical 家自包根出口可达(编译期守护;运行时锚定形状抽样)", () => {
    const op: CanvasOp = { kind: "stroke", item: null };
    const stroke: MaskStroke = { mode: "erase", size: 2, points: [] };
    const anno: Annotation = { kind: "text", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, size: 8 };
    const edges: ExpandEdges = { top: 1, right: 0, bottom: 0, left: 0 };
    const layer: WorkLayer = { id: "l", attachmentId: "a", displayUrl: "/a", x: 0, y: 0, w: 1, h: 1 };
    expect([op.kind, stroke.mode, anno.kind, edges.top, layer.id]).toEqual([
      "stroke",
      "erase",
      "text",
      1,
      "l",
    ]);
  });

  it("L2 工具装置类型自包根出口可达(task 2.6;编译期守护 + 形状抽样)", () => {
    const tool: CanvasTool<MaskStroke> = { id: "builtin:mask", label: "mask", icon: null };
    const hitKind = (ev: ToolGestureEvent): string => ev.hit.kind;
    const deferProbe = (ctx: CanvasToolContext): void => ctx.defer(() => {});
    expect([tool.id, typeof hitKind, typeof deferProbe]).toEqual([
      "builtin:mask",
      "function",
      "function",
    ]);
  });
});

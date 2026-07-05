/**
 * @blksails/pi-web-canvas-kit 包根出口 smoke 测试。
 *
 * 守护出口纪律(Req 1.3/1.4):
 * - src/index.ts 是 L2 唯一出口,可被解析;
 * - kernel/ 内部件(L1)不出现在包根出口;
 * - 当前 L2 面 = types(canonical 家)+ bitmap-io(task 1.2);
 *   后续任务填充(defineCanvasTool/registry/builtin)时更新清单断言。
 */
import { describe, it, expect } from "vitest";
import * as canvasKit from "../src/index.js";
import type { Annotation, CanvasOp, ExpandEdges, MaskStroke, WorkLayer } from "../src/index.js";

describe("@blksails/pi-web-canvas-kit public exports", () => {
  it("包根出口(L2 唯一出口)可解析", () => {
    expect(canvasKit).toBeTypeOf("object");
  });

  it("出口纪律:包根值导出=bitmap-io 全量 19 项,无 kernel 内部件泄漏(task 1.2 快照)", () => {
    expect(Object.keys(canvasKit).sort()).toEqual([
      "ANNOTATION_COLOR",
      "ANNOTATION_PALETTE",
      "annotationsToImage",
      "clampRect",
      "compositeByMask",
      "createMask",
      "cropImage",
      "drawAnnotations",
      "expandedSize",
      "flattenLayers",
      "hasExpand",
      "hasMaskContent",
      "outpaintImage",
      "outpaintMask",
      "parseDataUri",
      "rotateImage",
      "rotatedSize",
      "strokesToMask",
      "uploadDataUri",
    ]);
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
});

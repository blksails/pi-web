/**
 * @blksails/pi-web-canvas-ui 包根出口快照测试。
 *
 * 守护出口纪律(canvas-ui-m15 Req 2.1/2.2,tasks 2.1):
 * - src/index.ts 是唯一出口(styles.css 除外),可被解析;
 * - 出口面 = **8 迁入文件 HEAD 导出全集的去重并集**(39 值 + 27 类型)——
 *   严格超集于迁移前 packages/ui/src/index.ts 的 canvas 导出块:深路径
 *   named import(decideGenerate/buildSurfaceOp/canvasViewStore 等)与设置
 *   面板消费(aigc-model-meta 三导出)均须从包入口可达;
 * - 显式清单快照防漂移:任何导出增删改即红(semver 承诺面);
 * - client-image-ops 显式清单刻意排除 LoadedImage(canvas-workbench 单点
 *   re-export),8 文件无跨文件重名。
 */
import { describe, it, expect } from "vitest";
import * as canvasUi from "../src/index.js";
import type {
  // aigc-quick-settings
  AigcQuickSettingsProps,
  // canvas-gallery
  CanvasGalleryProps,
  // canvas-launcher
  CanvasLauncherProps,
  CanvasPanelProps,
  // canvas-workbench
  GenerateDecisionInput,
  GenerateDecision,
  LoadedImage,
  ImageLoader,
  CanvasWorkbenchProps,
  // lineage-view
  LineageNode,
  LineageViewProps,
  // use-canvas-view
  CanvasDensity,
  CanvasGroupMode,
  CanvasViewState,
  UseCanvasViewResult,
  // client-image-ops(12,转发 canvas-kit)
  Ctx2DLike,
  CanvasLike,
  CanvasFactory,
  Rect,
  ImageSourceLike,
  ClientImageOpsDeps,
  ExpandEdges,
  FlattenLayer,
  MaskStroke,
  Annotation,
  UploadFn,
  UploadDataUriInput,
} from "../src/index.js";

describe("@blksails/pi-web-canvas-ui public exports", () => {
  it("包根出口(唯一 TS 出口)可解析", () => {
    expect(canvasUi).toBeTypeOf("object");
  });

  it("出口纪律:包根值导出=8 文件并集 39 项,无内部件泄漏(快照)", () => {
    expect(Object.keys(canvasUi).sort()).toEqual([
      "ANNOTATION_COLOR",
      "ANNOTATION_PALETTE",
      "AigcQuickSettings",
      "CANVAS_PAGE_SIZE",
      "CanvasGallery",
      "CanvasLauncher",
      "CanvasPanel",
      "CanvasWorkbench",
      "LineageView",
      "PROVIDER_META",
      "ProviderBadge",
      "annotationsToImage",
      "buildLineageTree",
      "buildSurfaceOp",
      "buildToolPrompt",
      "canvasOpenStore",
      "canvasViewStore",
      "clampRect",
      "composeInpaintBack",
      "compositeByMask",
      "createMask",
      "cropImage",
      "decideGenerate",
      "displayNameOf",
      "drawAnnotations",
      "expandedSize",
      "flattenLayers",
      "hasExpand",
      "hasMaskContent",
      "isCanvasEnabled",
      "outpaintImage",
      "outpaintMask",
      "parseDataUri",
      "rotateImage",
      "rotatedSize",
      "strokesToMask",
      "uploadDataUri",
      "useCanvasOpen",
      "useCanvasView",
    ]);
  });

  it("类型导出(27)自包根出口可达(编译期守护;运行时锚定形状抽样)", () => {
    // 上方 import type 清单本身即 27 类型的编译期可达性守护;
    // 运行时抽样锚定几个代表形状。
    const density: CanvasDensity = "waterfall";
    const groupMode: CanvasGroupMode = "lineage";
    const decisionInput: Partial<GenerateDecisionInput> = {};
    const rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
    const edges: ExpandEdges = { top: 0, right: 0, bottom: 0, left: 0 };
    expect([density, groupMode, decisionInput, rect.width, edges.top]).toEqual([
      "waterfall",
      "lineage",
      {},
      1,
      0,
    ]);
    // 静默使用其余类型名,防 no-unused 噪音之余保持显式引用面。
    type _Witness = [
      AigcQuickSettingsProps,
      CanvasGalleryProps,
      CanvasLauncherProps,
      CanvasPanelProps,
      GenerateDecision,
      LoadedImage,
      ImageLoader,
      CanvasWorkbenchProps,
      LineageNode,
      LineageViewProps,
      CanvasViewState,
      UseCanvasViewResult,
      Ctx2DLike,
      CanvasLike,
      CanvasFactory,
      ImageSourceLike,
      ClientImageOpsDeps,
      FlattenLayer,
      MaskStroke,
      Annotation,
      UploadFn,
      UploadDataUriInput,
    ];
    const witnessArity: _Witness["length"] = 22;
    expect(witnessArity).toBe(22);
  });

  it("并集超集锚:迁移前 ui index canvas 块之外的深路径消费面从入口可达", () => {
    // 这些名字在迁移前只经深路径/设置面板消费,不在 ui index canvas 块——
    // canonical 包入口必须补齐(design「src/index.ts = 并集」)。
    expect(canvasUi.PROVIDER_META).toBeTypeOf("object");
    expect(canvasUi.displayNameOf).toBeTypeOf("function");
    expect(canvasUi.ProviderBadge).toBeTypeOf("function");
    expect(canvasUi.decideGenerate).toBeTypeOf("function");
    expect(canvasUi.buildSurfaceOp).toBeTypeOf("function");
    expect(canvasUi.buildToolPrompt).toBeTypeOf("function");
    expect(canvasUi.composeInpaintBack).toBeTypeOf("function");
    expect(canvasUi.canvasViewStore).toBeTypeOf("object");
  });
});

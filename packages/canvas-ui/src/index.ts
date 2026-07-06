/**
 * @blksails/pi-web-canvas-ui — canvas 领域组件 canonical 家唯一出口(出口纪律)。
 *
 * 纪律(Req 2.1/2.2,canvas-ui-m15 design「Boundary Commitments」):
 * - 出口面 = 自 packages/ui/src/canvas/ 迁入的 8 文件 **HEAD 导出全集的去重并集**
 *   (严格超集于迁移前 ui index 的 canvas 兼容导出块:深路径 named import 与
 *   设置面板消费——aigc-model-meta 三导出、workbench 的 decideGenerate/
 *   buildSurfaceOp/buildToolPrompt、use-canvas-view 的 canvasViewStore 等——
 *   均须从包入口可达);
 * - 组件语义/DOM/data-* 锚点与迁移前逐一致(原样迁入,仅 import 来源改线);
 * - 依赖方向:ui 经转发层消费本包,反向禁止(本包零 @blksails/pi-web-ui 依赖);
 *   canvas-kit 消费只走主入口,禁深路径;
 * - 此出口是 semver 承诺面:任何导出的增删改按 semver 语义对待;
 *   显式清单 re-export,禁 export *(防内部件经链泄漏成既成公开面);
 * - client-image-ops 显式清单刻意排除 LoadedImage(canvas-workbench 单点
 *   re-export),8 文件无跨文件重名。
 */

// aigc-model-meta — provider 元数据(设置面板 aigc-model-toggles-field 跨包消费)。
export { PROVIDER_META, displayNameOf, ProviderBadge } from "./aigc-model-meta.js";

// aigc-quick-settings — 输入区工具排 AIGC 快捷设置(模型/尺寸偏好;promptToolbar 槽挂载)。
export { AigcQuickSettings } from "./aigc-quick-settings.js";
export type { AigcQuickSettingsProps } from "./aigc-quick-settings.js";

// canvas-gallery — 画廊(domain="canvas" AAS 投影)。
export { CanvasGallery } from "./canvas-gallery.js";
export type { CanvasGalleryProps } from "./canvas-gallery.js";

// canvas-launcher — 门控(NEXT_PUBLIC_PI_WEB_CANVAS)+ 画布面板装配。
export { CanvasLauncher, CanvasPanel, isCanvasEnabled } from "./canvas-launcher.js";
export type { CanvasLauncherProps, CanvasPanelProps } from "./canvas-launcher.js";

// canvas-workbench — 二创工作台(编辑器 + 生成决策纯函数 + inpaint 回合成)。
export {
  CanvasWorkbench,
  decideGenerate,
  buildSurfaceOp,
  buildToolPrompt,
  composeInpaintBack,
  resolveToolRailTitle,
} from "./canvas-workbench.js";
export type {
  CanvasWorkbenchProps,
  GenerateDecision,
  GenerateDecisionInput,
  ImageLoader,
  LoadedImage,
} from "./canvas-workbench.js";

// generate-actions — 六内置生成动作插件(评分制决策链;canvas-kit resolveAction 消费,
// workbench 装配期注册进 per-instance 注册表)。
export {
  BUILTIN_GENERATE_ACTIONS,
  registerBuiltinGenerateActions,
} from "./generate-actions.js";

// lineage-view — 血缘树视图。
export { LineageView, buildLineageTree } from "./lineage-view.js";
export type { LineageViewProps, LineageNode } from "./lineage-view.js";

// use-canvas-view — 画布视图状态(open/density/group 外部 store + hooks)。
export {
  useCanvasView,
  useCanvasOpen,
  canvasOpenStore,
  canvasViewStore,
  CANVAS_PAGE_SIZE,
} from "./use-canvas-view.js";
export type {
  CanvasDensity,
  CanvasGroupMode,
  CanvasViewState,
  UseCanvasViewResult,
} from "./use-canvas-view.js";

// client-image-ops — @deprecated 转发兼容层(canvas-kit canonical 家的显式子集
// 转发:19 值 + 12 类型;刻意不含 LoadedImage/WorkLayer/CanvasOp 等新家类型)。
export {
  clampRect,
  rotatedSize,
  cropImage,
  rotateImage,
  createMask,
  hasExpand,
  expandedSize,
  outpaintImage,
  outpaintMask,
  flattenLayers,
  hasMaskContent,
  strokesToMask,
  ANNOTATION_COLOR,
  ANNOTATION_PALETTE,
  drawAnnotations,
  annotationsToImage,
  compositeByMask,
  parseDataUri,
  uploadDataUri,
} from "./client-image-ops.js";
export type {
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
} from "./client-image-ops.js";

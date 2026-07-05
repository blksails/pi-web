/**
 * @deprecated 转发兼容层(canvas-kit-m1 · Req 5.3/5.4/7.1)——保留**一个大版本**。
 *
 * client-image-ops 已整体迁入 `@blksails/pi-web-canvas-kit`(bitmap-io + 类型 canonical 家),
 * 本模块只做**显式子集转发**:原模块曾有的 31 项导出(19 值 + 12 类型)逐一对应,
 * 深路径 import(`.../src/canvas/client-image-ops.js`)与 ui 包入口 `export *` 链双兼容。
 *
 * - 新代码请直接 `import ... from "@blksails/pi-web-canvas-kit"`;
 * - 刻意用显式 `export {...} from` 而非 `export *`:canvas-kit 出口另含
 *   WorkLayer/LoadedImage/CanvasOp 等新家类型,不得经本兼容层泄漏成 ui 的既成公开面。
 */

// ── 值导出(19)──────────────────────────────────────────────────────────────
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
} from "@blksails/pi-web-canvas-kit";

// ── 类型导出(12)────────────────────────────────────────────────────────────
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
} from "@blksails/pi-web-canvas-kit";

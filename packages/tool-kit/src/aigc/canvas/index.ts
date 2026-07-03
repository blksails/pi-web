/**
 * aigc-canvas runtime barrel(含 pi 值导入,仅 `@blksails/pi-web-tool-kit/runtime` 加载)。
 *
 * 画廊 = attachment store 物化视图;A 档二创经 AAS 命令通道在子进程调 `runImageTool`;血缘经上游
 * attachment 不透明 meta seam 持久。纯 schema 见 `./schema.ts`(浏览器安全子路径,双端共享)。
 */
export {
  canvasSurfaceExtension,
  makeCanvasSurfaceExtension,
  CANVAS_DOMAIN,
  type CanvasExtensionDeps,
} from "./extension.js";
export { createCanvasCommands, type CanvasCommandDeps } from "./commands.js";
export { rebuildGalleryFromAttachments } from "./hydrate.js";
export type {
  GalleryState,
  GalleryAsset,
  CanvasLineage,
} from "./schema.js";

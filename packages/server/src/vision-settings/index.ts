/**
 * vision-settings — Canvas 视觉解读的只读模型清单端点(spec canvas-vision-readout)。
 *
 * ⚠ 本 barrel **只导出薄路由与纯类型**。取数 `listVisionModelOptions` 含 **pi SDK 值导入**,
 * 经专用子路径 `@blksails/pi-web-server/vision-model-options` 导出,**不得**从此处重导出
 * ——否则 pi SDK 会被 barrel 拖进 Next 服务端 bundle,dev 路由崩 `node:fs`
 * (与 `config/index.ts` ↔ `@blksails/pi-web-server/model-options` 的分层同理)。
 */
export { createVisionModelsRoute } from "./vision-models-routes.js";
export type { VisionModelsRouteDeps } from "./vision-models-routes.js";
export type {
  VisionModelOption,
  VisionModelOptions,
} from "./vision-model-options.types.js";

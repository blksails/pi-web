/**
 * vision-settings — 视觉模型清单的纯类型(spec canvas-vision-readout;
 * multi-gateway-providers 任务 4.3)。
 *
 * ⚠ 独立的 `GET /vision/models` 端点(`createVisionModelsRoute`)已随任务 4.3 删除
 * ——其能力由 `GET /config/models?input=image` 完全覆盖(config-routes.ts,
 * Req 3.1, 3.2, 3.4),与旧视觉模型清单等价(网关条目的增量属预期内的能力增强)。
 * 本 barrel 现只保留纯类型,供仍读取 `VisionModelOptions` 形态的消费方
 * (如 `vision-model-options` 的 pi SDK 取数闭包,经专用子路径
 * `@blksails/pi-web-server/vision-model-options` 导出,**不得**从此处重导出
 * ——否则 pi SDK 会被 barrel 拖进 Next 服务端 bundle,dev 路由崩 `node:fs`)。
 */
export type {
  VisionModelOption,
  VisionModelOptions,
} from "./vision-model-options.types.js";

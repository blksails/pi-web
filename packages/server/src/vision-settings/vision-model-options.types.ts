/**
 * vision-model-options.types — 视觉模型清单的纯类型(无运行时依赖,尤其不引 pi SDK)。
 *
 * 供 `vision-models-routes`(薄路由 + 注入签名)与 `vision-model-options`(pi SDK 取数)共用,
 * 使路由单测不被迫加载 pi SDK。与 `config/model-options.types.ts` 的分层同构。
 */

/**
 * 单个可选视觉模型。
 *
 * `value` 是 **`provider/modelId`** —— `image_vision` 工具 `model` 参数的格式
 * (与 tool-kit `select-model.ts` 的 `modelKey()` 对齐)。
 * ⚠ 与 Canvas 提示词栏既有「生成模型」选择器的**裸 id** 不同,不可混用。
 */
export interface VisionModelOption {
  readonly value: string;
  readonly label: string;
  readonly provider: string;
}

/** 列视觉模型结果。 */
export interface VisionModelOptions {
  readonly models: readonly VisionModelOption[];
}

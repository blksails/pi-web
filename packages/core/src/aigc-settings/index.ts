/**
 * aigc-settings — AIGC 图像工具的模型目录只读端点(aigc-tool-settings)。
 * 「被禁模型 / 提示词优化」的读写走标准 config 域 `/api/config/aigc`(落 `<agentDir>/aigc.json`)。
 */
export { createAigcModelsRoute } from "./aigc-models-routes.js";

/**
 * `@blksails/tool-kit` 主入口 —— **声明层**(前端安全)。
 *
 * 仅导出引擎类型与工具集声明。**禁止**从此入口直接或间接顶层 import pi SDK / pi-ai /
 * undici 等运行时库:执行层一律走 `@blksails/tool-kit/runtime` 子入口,以守 Next/webpack
 * externals 边界(design Boundary / Req 6.1)。
 */
export * from "./engine/types.js";

// AIGC 声明(纯数据,无运行时依赖,可从主入口安全导出)
// compileTool / buildAigcTools 等执行层走 @blksails/tool-kit/runtime
export { AIGC_TOOLS } from "./aigc/index.js";
export type { BuildAigcToolsOptions } from "./aigc/index.js";
export { imageGeneration } from "./aigc/tools/image-generation.js";
export { imageEdit } from "./aigc/tools/image-edit.js";

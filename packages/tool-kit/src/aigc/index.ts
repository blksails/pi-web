/**
 * AIGC 工具集装配入口(detoolspec-unify-builtin-tools)。
 *
 * 取代原 `AIGC_TOOLS` / `buildAigcTools`(ToolSpec + compileTool 路径已移除)。AIGC 现以
 * 进程内 `ExtensionFactory` 形态提供:agent 经 `extensions: [aigcExtension]` 装载。
 * 属执行层(含 pi SDK 值导入),仅经 `@blksails/pi-web-tool-kit/runtime` 子入口导出。
 */
export { aigcExtension } from "./extension.js";
export { registerImageGeneration } from "./tools/image-generation.js";
export { registerImageEdit } from "./tools/image-edit.js";

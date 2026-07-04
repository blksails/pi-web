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
// aigc-tool-settings:模型开关解析/过滤 + 提示词优化占位接缝。
export {
  resolveAigcToolSettings,
  filterRoutes,
  resolveAgentDir,
  AIGC_TOOL_SETTINGS_FILE,
  EMPTY_DISABLED,
  type AigcToolSettings,
  type RegisterImageToolOptions,
} from "./model-config.js";
export { optimizePrompt, type OptimizePromptOptions } from "./optimize-prompt.js";

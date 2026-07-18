/**
 * `@blksails/pi-web-tool-kit` 主入口 —— **声明层**(前端安全)。
 *
 * 仅导出前端安全的纯数据/类型。**禁止**从此入口直接或间接顶层 import pi SDK / pi-ai /
 * undici 等运行时库:执行层(AIGC extension、runImageTool、runEndpoint 等)一律走
 * `@blksails/pi-web-tool-kit/runtime` 子入口,以守 Next/webpack externals 边界(Req 6.4)。
 *
 * detoolspec-unify-builtin-tools:移除 `engine/types`(声明式工具框架)、`AIGC_TOOLS`、
 * `imageGeneration`/`imageEdit`(ToolSpec 数据)的主入口导出。AIGC 改以 extension 形态从 runtime 导出。
 */

// 内置斜杠命令声明(builtin-plugin-command);纯数据 + 类型,前端安全。
export { BUILTIN_COMMANDS } from "./commands/builtin.js";
export type {
  BuiltinCommandSpec,
  BuiltinCommandTarget,
  BuiltinSubcommand,
} from "./commands/types.js";

// 状态注入桥作者接入点(state-injection-bridge):读 globalThis seam,前端安全降级。
export {
  getSessionState,
  SESSION_STATE_SEAM_KEY,
  type SessionStateAccess,
} from "./session-state.js";

// AIGC slash 补全候选声明(agent-slash-completion);纯数据 + 仅类型,前端安全。
export { aigcSlashCompletions } from "./aigc/slash-completions.js";

// AIGC 图像模型展示目录(aigc-tool-settings);纯数据,前端/server 安全,供 /settings 模型开关列举。
export {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  type AigcCatalogEntry,
} from "./aigc/model-catalog.js";

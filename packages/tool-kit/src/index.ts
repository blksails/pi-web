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

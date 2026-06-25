/**
 * commands 子入口(前端安全)——仅内置命令声明,无 aigc/compile-tool/pi SDK 依赖。
 *
 * 主入口 `.` 因 re-export AIGC_TOOLS 会经 aigc/index → compile-tool 间接拉入 pi SDK(node-only);
 * 前端(app-shell)只需内置命令声明,故经本子入口导入,守 Next/webpack externals 边界。
 */
export { BUILTIN_COMMANDS } from "./builtin.js";
export type {
  BuiltinCommandSpec,
  BuiltinCommandTarget,
  BuiltinSubcommand,
} from "./types.js";

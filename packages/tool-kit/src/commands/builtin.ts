/**
 * commands/builtin — 内置命令默认集。
 *
 * 纯数据导出(像 AIGC_TOOLS)。`/plugin` 已移除:扩展安装改为 agent 回合内的内置工具
 * (install_extension/uninstall_extension/list_extensions,spec extension-install-agent-tools),
 * 用 ctx.ui 呈现进度,不再走 host 命令 + 模态面板。仅保留 /clear。
 */
import type { BuiltinCommandSpec } from "./types.js";

/**
 * /clear:清空当前会话——既清 agent 上下文(server 经 new_session),又清前端聊天视图
 * (UI effect: clear-transcript)。覆盖 agent 自带的 /clear(同名内置优先),使「视觉」与
 * 「上下文」一致(补 agent /clear 在 web 上视觉不清空的缺口)。
 */
const CLEAR: BuiltinCommandSpec = {
  name: "clear",
  description: "清空当前会话(上下文与聊天视图)",
  target: { kind: "server-action" },
  userOnly: true,
};

export const BUILTIN_COMMANDS: readonly BuiltinCommandSpec[] = [CLEAR];

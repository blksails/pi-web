/**
 * commands/builtin — 内置命令默认集(builtin-plugin-command 任务 1.1)。
 *
 * 纯数据导出(像 AIGC_TOOLS)。首个成员 `/plugin`:无参开管理面板(ui-surface),子命令
 * install/uninstall/list/enable/disable/update 经服务端动作复用 extension-management 端点。
 */
import type { BuiltinCommandSpec } from "./types.js";

const PLUGIN: BuiltinCommandSpec = {
  name: "plugin",
  description: "安装与管理 plugin（扩展包）",
  argumentHint: "[install|uninstall|list|enable|disable|update] …",
  target: { kind: "ui-surface", slot: "dialogLayer" },
  userOnly: true,
  subcommands: [
    { name: "install", description: "安装 plugin", argumentHint: "<source>" },
    { name: "uninstall", description: "卸载 plugin", argumentHint: "<name>" },
    { name: "list", description: "列出已安装 plugin" },
    { name: "enable", description: "启用 plugin", argumentHint: "<name>" },
    { name: "disable", description: "禁用 plugin", argumentHint: "<name>" },
    { name: "update", description: "更新 plugin", argumentHint: "[name]" },
  ],
};

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

export const BUILTIN_COMMANDS: readonly BuiltinCommandSpec[] = [PLUGIN, CLEAR];

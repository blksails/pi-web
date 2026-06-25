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

export const BUILTIN_COMMANDS: readonly BuiltinCommandSpec[] = [PLUGIN];

/**
 * to-rpc-command — 内置命令声明 → RpcSlashCommand 映射与合流(builtin-plugin-command 任务 1.x/2.3)。
 *
 * 客户端合流:把 tool-kit 的 BuiltinCommandSpec 映射为 source=builtin 的 RpcSlashCommand,
 * 前置合流到 agent 命令前;同名以内置优先(过滤同名 agent 命令)。内置命令无 agent 来源,
 * 故省略 sourceInfo(协议已将其设为可选)。
 */
import type { BuiltinCommandSpec } from "@blksails/pi-web-tool-kit/commands";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";

export function toRpcSlashCommand(spec: BuiltinCommandSpec): RpcSlashCommand {
  return {
    name: spec.name,
    ...(spec.description.length > 0 ? { description: spec.description } : {}),
    source: "builtin",
  };
}

/** 内置命令前置合流到 agent 命令前;同名内置优先。 */
export function mergeBuiltinCommands(
  builtin: readonly BuiltinCommandSpec[],
  agent: readonly RpcSlashCommand[],
): RpcSlashCommand[] {
  const builtinRpc = builtin.map(toRpcSlashCommand);
  const names = new Set(builtinRpc.map((c) => c.name));
  return [...builtinRpc, ...agent.filter((c) => !names.has(c.name))];
}

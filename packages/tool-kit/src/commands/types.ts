/**
 * commands/types — 内置斜杠命令声明(builtin-plugin-command 任务 1.1)。
 *
 * harness 级「内置命令」的纯声明(前端安全,零运行时依赖)。复刻 ToolSpec 的「声明 + handler
 * 双层」:声明在此(纯数据),client/server 各按 name 绑定 handler。内置命令执行 harness 逻辑,
 * **不进 LLM**(见分派);安装/卸载类 userOnly,模型不可触发。
 */

/** 执行落点:客户端逻辑 / 服务端动作 / 打开 UI 表面(slot)。 */
export type BuiltinCommandTarget =
  | { readonly kind: "client" }
  | { readonly kind: "server-action" }
  | { readonly kind: "ui-surface"; readonly slot: string };

export interface BuiltinSubcommand {
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
}

export interface BuiltinCommandSpec {
  /** 命令名(无前导 /)。 */
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly aliases?: readonly string[];
  readonly target: BuiltinCommandTarget;
  readonly subcommands?: readonly BuiltinSubcommand[];
  /** 仅用户可触发;模型不可调用(绝不进消息流/工具表)。恒 true。 */
  readonly userOnly: true;
}

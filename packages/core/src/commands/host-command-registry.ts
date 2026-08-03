/**
 * host-command-registry — 统一命令层(unified-command-result-layer)的 host 侧执行注册表。
 *
 * 决策 A:host 命令(如 /plugin)在**服务端**执行(不转 agent)。ui-rpc handler 收到
 * `point="command"` 且命令名已注册时,经本注册表执行,结果由 PiSession.emitUiRpcResponse 回流。
 * 执行器抛错由 `execute` 捕获为结构化 CommandResult(不使会话崩溃)。
 */
import type { CommandResult } from "@blksails/pi-web-protocol";
import type { PiSession } from "../session/pi-session.js";

/** host 命令执行上下文:目标会话 + 命令名之后的原始参数串。 */
export interface HostCommandContext {
  readonly session: PiSession;
  /** 命令名之后的原始串(如 "install local:/x");无参为 ""。 */
  readonly argv: string;
}

/** 单个 host 命令执行器。 */
export interface HostCommandHandler {
  readonly name: string;
  execute(ctx: HostCommandContext): Promise<CommandResult>;
}

export interface HostCommandRegistry {
  has(name: string): boolean;
  /** 执行;执行器抛错时返回 effect:"notify" 的失败结果(message=错误信息),不抛。 */
  execute(name: string, ctx: HostCommandContext): Promise<CommandResult>;
}

export function createHostCommandRegistry(
  handlers: readonly HostCommandHandler[],
): HostCommandRegistry {
  const map = new Map<string, HostCommandHandler>();
  for (const h of handlers) map.set(h.name, h);

  return {
    has(name: string): boolean {
      return map.has(name);
    },
    async execute(name: string, ctx: HostCommandContext): Promise<CommandResult> {
      const h = map.get(name);
      if (h === undefined) {
        return { command: name, effect: "notify", message: `未知命令: ${name}` };
      }
      try {
        return await h.execute(ctx);
      } catch (err) {
        return {
          command: name,
          effect: "notify",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

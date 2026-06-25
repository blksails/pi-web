/**
 * clear-host-command — `/clear` 的 host 侧执行器(unified-command-result-layer 扩展)。
 *
 * `/clear` 需双重清空:agent 上下文(server 经 PiSession.clearContext → pi RPC new_session)
 * + 前端聊天视图(UI effect: clear-transcript,由 pi-chat 应用)。补 agent 自带 /clear 在 web
 * 上「上下文清了但视觉不清」的缺口。agent 侧 best-effort(通道不支持时仅做 UI 清空)。
 */
import type {
  HostCommandContext,
  HostCommandHandler,
} from "@blksails/pi-web-server";
import type { CommandResult } from "@blksails/pi-web-protocol";

export function createClearHostCommand(): HostCommandHandler {
  return {
    name: "clear",
    async execute(ctx: HostCommandContext): Promise<CommandResult> {
      // agent 侧清空(best-effort:失败不阻断 UI 清空)。
      try {
        await ctx.session.clearContext();
      } catch {
        // 通道不支持/瞬时错误:忽略,前端仍执行 clear-transcript。
      }
      return { command: "clear", effect: "clear-transcript", message: "已清空对话" };
    },
  };
}

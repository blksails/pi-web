/**
 * plugin-host-command — `/plugin` 的 host 侧执行器(unified-command-result-layer 任务 3.1)。
 *
 * 实现 server 端 HostCommandHandler(name="plugin"),复用 extension-management 的核心
 * (checkAllowlist + assembleInstall/RemoveArgs + PiCli + SessionReloader),把 `/plugin`
 * 从前端 onBuiltinSelect 直调 REST + 手动刷新,迁移到统一命令通道:执行结果以 CommandResult
 * (effect 数据驱动 UI)回流,装/卸后触发会话重载使资源对运行中会话生效。
 *
 * 子命令(argv 为命令名之后的原始串):
 *   ""/list           → 列已装(open-panel / panel-refresh,data.extensions)
 *   install <源>      → 安装 + reload(panel-refresh)
 *   uninstall <名>    → 卸载 + reload(panel-refresh)
 * 错误(用法/门控/allowlist/pi 失败)抛出,由注册表包成 effect:"notify" + message(Req 3.3)。
 */
import {
  assembleInstallArgs,
  assembleRemoveArgs,
  checkAllowlist,
  type AllowlistConfig,
  type HostCommandContext,
  type HostCommandHandler,
  type InstalledExtension,
  type PiCli,
  type PiSession,
} from "@blksails/pi-web-server";
import type { CommandResult } from "@blksails/pi-web-protocol";

export interface PluginHostCommandDeps {
  readonly piCli: PiCli;
  readonly allowlist: AllowlistConfig;
  /** 安装/卸载是否放行(对应 admin/env 门控;默认关,只读列表始终可用)。 */
  readonly allowMutate: boolean;
  /** 装/卸成功后重载会话使资源生效(决策 A:host 命令 server 执行后回流前重载)。 */
  reload(session: PiSession): Promise<void>;
}

function tokens(argv: string): readonly string[] {
  return argv.trim().split(/\s+/).filter((t) => t.length > 0);
}

export function createPluginHostCommand(
  deps: PluginHostCommandDeps,
): HostCommandHandler {
  async function listSnapshot(): Promise<readonly InstalledExtension[]> {
    return deps.piCli.listExtensions();
  }

  async function result(
    effect: CommandResult["effect"],
    message?: string,
  ): Promise<CommandResult> {
    return {
      command: "plugin",
      effect,
      ...(message !== undefined ? { message } : {}),
      data: { extensions: await listSnapshot() },
    };
  }

  return {
    name: "plugin",
    async execute(ctx: HostCommandContext): Promise<CommandResult> {
      const ts = tokens(ctx.argv);
      const sub = ts[0];
      const target = ts[1];

      if (sub === undefined) return result("open-panel");
      if (sub === "list") return result("panel-refresh");

      if (sub === "install") {
        if (target === undefined) throw new Error("用法: /plugin install <源>");
        if (!deps.allowMutate) {
          throw new Error("安装被禁用(需管理员或配置 PI_WEB_EXT_ADMIN_ALLOW_ANY)");
        }
        const decision = checkAllowlist(target, deps.allowlist);
        if (!decision.allowed) throw new Error(`来源被拒: ${decision.reason}`);
        const { args, env } = assembleInstallArgs(decision.source);
        const r = await deps.piCli.runPiCommand(args, env);
        if (!r.ok) {
          throw new Error(r.errorSummary ?? `安装失败(exit ${String(r.exitCode)})`);
        }
        await deps.reload(ctx.session);
        return result("panel-refresh", `已安装 ${target}`);
      }

      if (sub === "uninstall") {
        if (target === undefined) throw new Error("用法: /plugin uninstall <名>");
        if (!deps.allowMutate) throw new Error("卸载被禁用(需管理员或配置)");
        const { args, env } = assembleRemoveArgs(target);
        const r = await deps.piCli.runPiCommand(args, env);
        if (!r.ok) {
          throw new Error(r.errorSummary ?? `卸载失败(exit ${String(r.exitCode)})`);
        }
        await deps.reload(ctx.session);
        return result("panel-refresh", `已卸载 ${target}`);
      }

      throw new Error(`未知子命令: ${sub}`);
    },
  };
}

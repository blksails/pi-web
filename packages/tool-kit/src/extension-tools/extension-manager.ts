/**
 * extension-manager — pi-web 内置「扩展管理扩展」(spec extension-install-agent-tools)。
 *
 * 经 `forcedExtensionPaths` 由 runner 强制注入**每个**会话（无需用户 agent 声明），向 agent 提供：
 *   - 工具 install_extension / uninstall_extension / list_extensions（LLM 可调）
 *   - 命令 /reload-runtime（工具装完排队 follow-up 触发，应用新扩展）
 *
 * 安装信息/进度走 pi 原生 `ctx.ui`（setStatus/notify/setWidget → StatusBar/通知/Widget，ambient
 * 非模态）。装包用 `pi.exec("pi install …")`（pi 未暴露 in-process 包管理 API），落到当前会话 agent
 * 的配置目录（子进程 env 决定，不污染真实 ~/.pi）。装前经 {@link gateInstall} 做来源白名单门控。
 *
 * 关键约束（pi docs）：工具 ctx 是 ExtensionContext，**不能直接 ctx.reload()**（会死锁）；reload 仅
 * ExtensionCommandContext 可调，故装完 `pi.sendUserMessage("/reload-runtime", { deliverAs:"followUp" })`
 * 排队命令触发。RPC 模式无内置 /reload，本扩展自带 reload-runtime 命令。
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { gateInstall, gateMutate, toInstallArg } from "./gate.js";

const STATUS_KEY = "ext-install";
const LIST_WIDGET_KEY = "ext-list";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/** 解析 `pi list` 输出为展示行（宽松：取非空非纯标题行，缩进保留）。 */
export function parseListLines(stdout: string): string[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
  return lines.length > 0 ? lines : ["(无已安装扩展)"];
}

/**
 * 注册扩展管理工具 + reload-runtime 命令。默认导出供 pi 按 forcedExtensionPaths 加载。
 */
export default function extensionManager(pi: ExtensionAPI): void {
  // reload 入口：仅命令的 ctx 可 reload();工具装完排队触发此命令。
  pi.registerCommand("reload-runtime", {
    description: "Reload extensions, skills, prompts, and themes (pi-web extension manager)",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  // install_extension：门控 → ctx.ui 进度 → pi.exec install → 排队 reload。
  pi.registerTool({
    name: "install_extension",
    label: "Install extension",
    description:
      "Install a pi extension/package for the current session and apply it. Sources: npm:@scope/pkg@x.y.z, git:host/path@ref, local:/abs/path. Progress shows in the status bar.",
    parameters: Type.Object({
      source: Type.String({
        description: "Source: npm:@scope/pkg@x.y.z | git:host/path@ref | local:/abs/path",
      }),
      local: Type.Optional(
        Type.Boolean({ description: "Install project-locally (.pi/settings.json) instead of global." }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx: ExtensionContext) {
      const p = params as { source: string; local?: boolean };
      const source = (p.source ?? "").trim();
      ctx.ui.setStatus(STATUS_KEY, `安装中: ${source}…`);

      const gate = gateInstall(source);
      if (!gate.allowMutate) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify("安装被禁用（需配置 PI_WEB_EXT_ADMIN_ALLOW_ANY=1）", "error");
        return textResult("Install disabled: PI_WEB_EXT_ADMIN_ALLOW_ANY is not set.");
      }
      if (!gate.decision.allowed) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify(`来源被拒: ${gate.decision.reason}`, "error");
        return textResult(`Source rejected: ${gate.decision.reason}`);
      }

      const installArg = toInstallArg(gate.decision.source);
      const args = ["install", installArg, "--no-approve", ...(p.local === true ? ["-l"] : [])];
      const res = await pi.exec("pi", args, { signal, timeout: 120_000 });
      if (res.code !== 0) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
        ctx.ui.notify(`安装失败: ${why}`, "error");
        return textResult(`Install failed: ${why}`);
      }

      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify(`已安装: ${source}（应用中…）`, "info");
      // 工具不能 ctx.reload();排队 /reload-runtime 命令以应用新扩展。
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return textResult(`Installed ${source}. Queued /reload-runtime to apply.`);
    },
  });

  // uninstall_extension：门控 → pi.exec remove → 排队 reload。
  pi.registerTool({
    name: "uninstall_extension",
    label: "Uninstall extension",
    description:
      "Uninstall a pi extension/package from the current session by its installed name/id, then reapply.",
    parameters: Type.Object({
      name: Type.String({ description: "Installed package id/name (see list_extensions)." }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx: ExtensionContext) {
      const p = params as { name: string };
      const name = (p.name ?? "").trim();
      ctx.ui.setStatus(STATUS_KEY, `卸载中: ${name}…`);

      if (!gateMutate()) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify("卸载被禁用（需配置 PI_WEB_EXT_ADMIN_ALLOW_ANY=1）", "error");
        return textResult("Uninstall disabled: PI_WEB_EXT_ADMIN_ALLOW_ANY is not set.");
      }
      if (name.length === 0) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify("卸载需要扩展名", "error");
        return textResult("uninstall_extension requires a name.");
      }

      const res = await pi.exec("pi", ["remove", name], { signal, timeout: 120_000 });
      if (res.code !== 0) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
        ctx.ui.notify(`卸载失败: ${why}`, "error");
        return textResult(`Uninstall failed: ${why}`);
      }

      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify(`已卸载: ${name}（应用中…）`, "info");
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return textResult(`Uninstalled ${name}. Queued /reload-runtime to apply.`);
    },
  });

  // list_extensions：pi list → setWidget（ambient 列表，非模态）。
  pi.registerTool({
    name: "list_extensions",
    label: "List extensions",
    description: "List installed pi extensions/packages for the current session (shown as a status widget).",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _onUpdate, ctx: ExtensionContext) {
      const res = await pi.exec("pi", ["list"], { signal, timeout: 30_000 });
      if (res.code !== 0) {
        const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
        ctx.ui.notify(`列出失败: ${why}`, "error");
        return textResult(`List failed: ${why}`);
      }
      const lines = parseListLines(res.stdout);
      ctx.ui.setWidget(LIST_WIDGET_KEY, lines, { placement: "aboveEditor" });
      return textResult(`Installed extensions:\n${lines.join("\n")}`);
    },
  });
}

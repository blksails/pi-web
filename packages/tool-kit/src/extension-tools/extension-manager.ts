/**
 * extension-manager — pi-web 内置「扩展管理扩展」(spec extension-install-agent-tools)。
 *
 * 经 `forcedExtensionPaths` 由 runner 强制注入**每个**会话（无需用户 agent 声明），向 agent 提供：
 *   - 工具 install_extension / uninstall_extension / list_extensions（LLM 可调）
 *   - 命令 /reload-runtime（工具装完排队 follow-up 触发，应用新扩展）
 *
 * （用户向的扩展管理入口已迁移至宿主侧 /install 命令，见 spec install-host-command。）
 *
 * 工具入口共用同一套装包逻辑与 pi 原生 `ctx.ui`（setStatus/notify/setWidget → StatusBar/通知/Widget，
 * ambient 非模态，**无任何前端面板**）。装包用 `pi.exec("pi install …")`（pi 未暴露 in-process 包管理
 * API），落到当前会话 agent 的配置目录（子进程 env 决定，不污染真实 ~/.pi）。装前经 {@link gateInstall}
 * 做来源白名单门控。
 *
 * 关键约束（pi docs）：**工具** ctx 是 ExtensionContext，不能直接 ctx.reload()（会死锁），故装完
 * `pi.sendUserMessage("/reload-runtime", { deliverAs:"followUp" })` 排队命令触发。**命令** ctx 是
 * ExtensionCommandContext，可直接 `ctx.reload()`，一步到位、无需排队。
 */
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
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

/** 装包共享逻辑：门控 → ctx.ui 进度 → pi.exec install → 结果通知。返回是否成功（供调用方决定 reload 方式）。 */
async function performInstall(
  pi: ExtensionAPI,
  ui: ExtensionUIContext,
  source: string,
  local: boolean,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; message: string }> {
  const src = (source ?? "").trim();
  if (src.length === 0) {
    ui.notify("安装需要来源（npm:/git:/local:）", "error");
    return { ok: false, message: "install requires a source." };
  }
  ui.setStatus(STATUS_KEY, `安装中: ${src}…`);

  const gate = gateInstall(src);
  if (!gate.allowMutate) {
    ui.setStatus(STATUS_KEY, undefined);
    ui.notify("安装被禁用（需配置 PI_WEB_EXT_ADMIN_ALLOW_ANY=1）", "error");
    return { ok: false, message: "Install disabled: PI_WEB_EXT_ADMIN_ALLOW_ANY is not set." };
  }
  if (!gate.decision.allowed) {
    ui.setStatus(STATUS_KEY, undefined);
    ui.notify(`来源被拒: ${gate.decision.reason}`, "error");
    return { ok: false, message: `Source rejected: ${gate.decision.reason}` };
  }

  const installArg = toInstallArg(gate.decision.source);
  const args = ["install", installArg, "--no-approve", ...(local ? ["-l"] : [])];
  const res = await pi.exec("pi", args, { signal, timeout: 120_000 });
  if (res.code !== 0) {
    ui.setStatus(STATUS_KEY, undefined);
    const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
    ui.notify(`安装失败: ${why}`, "error");
    return { ok: false, message: `Install failed: ${why}` };
  }

  ui.setStatus(STATUS_KEY, undefined);
  ui.notify(`已安装: ${src}（应用中…）`, "info");
  return { ok: true, message: `Installed ${src}.` };
}

/** 卸载共享逻辑：门控 → ctx.ui 进度 → pi.exec remove → 结果通知。 */
async function performUninstall(
  pi: ExtensionAPI,
  ui: ExtensionUIContext,
  name: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; message: string }> {
  const n = (name ?? "").trim();
  ui.setStatus(STATUS_KEY, `卸载中: ${n}…`);

  if (!gateMutate()) {
    ui.setStatus(STATUS_KEY, undefined);
    ui.notify("卸载被禁用（需配置 PI_WEB_EXT_ADMIN_ALLOW_ANY=1）", "error");
    return { ok: false, message: "Uninstall disabled: PI_WEB_EXT_ADMIN_ALLOW_ANY is not set." };
  }
  if (n.length === 0) {
    ui.setStatus(STATUS_KEY, undefined);
    ui.notify("卸载需要扩展名", "error");
    return { ok: false, message: "uninstall requires a name." };
  }

  const res = await pi.exec("pi", ["remove", n], { signal, timeout: 120_000 });
  if (res.code !== 0) {
    ui.setStatus(STATUS_KEY, undefined);
    const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
    ui.notify(`卸载失败: ${why}`, "error");
    return { ok: false, message: `Uninstall failed: ${why}` };
  }

  ui.setStatus(STATUS_KEY, undefined);
  ui.notify(`已卸载: ${n}（应用中…）`, "info");
  return { ok: true, message: `Uninstalled ${n}.` };
}

/** 列出共享逻辑：pi list → setWidget（ambient 列表，非模态）。 */
async function performList(
  pi: ExtensionAPI,
  ui: ExtensionUIContext,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; message: string }> {
  const res = await pi.exec("pi", ["list"], { signal, timeout: 30_000 });
  if (res.code !== 0) {
    const why = (res.stderr || res.stdout || `exit ${res.code}`).trim();
    ui.notify(`列出失败: ${why}`, "error");
    return { ok: false, message: `List failed: ${why}` };
  }
  const lines = parseListLines(res.stdout);
  // setWidget(aboveEditor) 在富布局渲染为常驻列表;notify 作为确定可见的兜底反馈
  // (扩展列表通常较短;部分精简布局不渲染 aboveEditor widget)。
  ui.setWidget(LIST_WIDGET_KEY, lines, { placement: "aboveEditor" });
  ui.notify(`已安装扩展:\n${lines.join("\n")}`, "info");
  return { ok: true, message: `Installed extensions:\n${lines.join("\n")}` };
}

/**
 * 注册扩展管理工具 + 用户向命令 + reload-runtime 命令。默认导出供 pi 按 forcedExtensionPaths 加载。
 */
export default function extensionManager(pi: ExtensionAPI): void {
  // reload 入口：工具装完排队触发此命令（工具 ctx 不能 reload）。
  pi.registerCommand("reload-runtime", {
    description: "Reload extensions, skills, prompts, and themes (pi-web extension manager)",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });

  // ── LLM 可调工具：自然语言「装个 X」时 agent 调用,共用同一套逻辑 ──

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
      const r = await performInstall(pi, ctx.ui, p.source, p.local === true, signal);
      if (!r.ok) return textResult(r.message);
      // 工具 ctx 不能 ctx.reload();排队 /reload-runtime 命令以应用新扩展。
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return textResult(`${r.message} Queued /reload-runtime to apply.`);
    },
  });

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
      const r = await performUninstall(pi, ctx.ui, p.name, signal);
      if (!r.ok) return textResult(r.message);
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return textResult(`${r.message} Queued /reload-runtime to apply.`);
    },
  });

  pi.registerTool({
    name: "list_extensions",
    label: "List extensions",
    description: "List installed pi extensions/packages for the current session (shown as a status widget).",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _onUpdate, ctx: ExtensionContext) {
      const r = await performList(pi, ctx.ui, signal);
      return textResult(r.message);
    },
  });
}

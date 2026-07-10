/**
 * install-host-command — `/install` 的 host 侧执行器(spec install-host-command,任务 2.1-2.4)。
 *
 * 薄适配层:argv 解析、门控、脱敏收集器、kind 分派与结果卡片组装全在本文件,安装/卸载/
 * 列出/更新的真实逻辑一律委托注入的 CLI install 子域端口(`Installer`/`PluginInstaller`,
 * `server/cli/install/*`)——不复制第二份安装逻辑(design.md「复用纪律」)。
 *
 * 门控顺序(Req 3.1-3.5):参数校验(纯本地,产出用法文本,effect:"none",无 data)→
 * `adminGate`(拒绝→失败卡片 + 审计)→ 进入 CLI 子域(allowlist 拒绝由 `resolveSource` 在
 * 编排内产生,handler 只负责把错误码装饰为可操作的 env 放行指引 + 审计)→ 结果组装。
 *
 * 生效分道(Req 4.1, 4.2):agent 通道成功恒不调用 `reloadRunner`,只给出 `effect:
 * "panel-refresh"` + 选择器切换指引;plugin 通道(install/uninstall/update)成功时**在
 * 返回前**恰调用一次 `reloadRunner(ctx.session)`,`effect:"notify"`。
 */
import type {
  HostCommandContext,
  HostCommandHandler,
  PiSession,
} from "@blksails/pi-web-server";
import type { CommandResult, InstallResultData, InstallStep, PluginKind } from "@blksails/pi-web-protocol";
import type { Installer, InstallerError } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";
import { redactSecrets } from "@/server/cli/reporter";

/**
 * `/install` 拒绝路径的审计事件(仅 adminGate 拒绝 / allowlist 拒绝两条路径触发,与
 * Req 3.5「记录与既有 REST 安装一致的审计事件」对齐)。本层不掌握 `AuthContext`(
 * `HostCommandContext` 只有 `session`/`argv`),故不直接复用 REST 的 `OnAudit`(其
 * `AuditRecord.actor` 需要 `AuthContext`)——装配层(pi-handler.ts,任务 4.3)负责把这个
 * 事件适配成完整的 `AuditRecord`(补 actor/at)后转发给同一个 `onAudit` 实例。
 */
export interface InstallAuditEvent {
  readonly action: "install" | "uninstall" | "list" | "update";
  readonly source?: string;
  readonly outcome: "rejected";
  readonly reason: string;
}

export interface InstallHostCommandDeps {
  /** 已注入 extAllowlist 的实例(装配层职责,本文件不重复判断白名单)。 */
  readonly installer: Installer;
  readonly pluginInstaller: PluginInstaller;
  /** extAllowMutate 同源的管理员判定。 */
  readonly adminGate: () => boolean;
  readonly reloadRunner: (session: PiSession) => Promise<void>;
  readonly audit?: (event: InstallAuditEvent) => void;
  /**
   * `resolveSource` 本地源解析基准的**装配兜底**。执行时优先用 `ctx.session.cwd`——
   * `/install install` 参数位补全(GET /sessions/:id/install-sources)按会话 cwd 扫描产出
   * `local:<rel>` 候选,执行与补全必须同基准,否则选中候选直接提交会解析失败(e2e 阶段
   * 抓到的真实体验缺陷:会话 cwd ≠ server defaultCwd 时补全候选 404)。
   */
  readonly cwd?: string;
}

const COMMAND_NAME = "install";

const USAGE_TEXT = [
  "用法: /install <install|uninstall|list|update> [参数]",
  "  install <source> [--kind agent|plugin]   安装 agent 或 plugin(kind 自动判别,可用 --kind 覆盖)",
  "  uninstall <id> [--kind agent|plugin]     卸载已安装的 agent 或 plugin",
  "  list [--outdated]                        列出已安装 plugin(--outdated 如实转达底层是否支持)",
  "  update [id]                              更新 plugin(仅支持 plugin 通道,不接受 --kind)",
  "注:来源/包标识暂不支持包含空格的路径。",
].join("\n");

function usageResult(message: string): CommandResult {
  return { command: COMMAND_NAME, effect: "none", message };
}

// ---------------------------------------------------------------------------
// argv 解析(空白分词,v1 不支持引号包裹路径)
// ---------------------------------------------------------------------------

type Action = "install" | "uninstall" | "list" | "update";

interface ParsedOptions {
  readonly positional: readonly string[];
  readonly kind: string | undefined;
  readonly hasKindFlag: boolean;
  readonly outdated: boolean;
}

function tokenize(argv: string): string[] {
  const trimmed = argv.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function parseOptions(tokens: readonly string[]): ParsedOptions {
  const positional: string[] = [];
  let kind: string | undefined;
  let hasKindFlag = false;
  let outdated = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok === "--kind") {
      hasKindFlag = true;
      kind = tokens[i + 1];
      i += 1;
    } else if (tok === "--outdated") {
      outdated = true;
    } else {
      positional.push(tok);
    }
  }
  return { positional, kind, hasKindFlag, outdated };
}

interface ValidatedInstall {
  readonly action: "install";
  readonly source: string;
  readonly kindHint: PluginKind | undefined;
}
interface ValidatedUninstall {
  readonly action: "uninstall";
  readonly id: string;
  readonly kindHint: PluginKind | undefined;
}
interface ValidatedList {
  readonly action: "list";
  readonly outdated: boolean;
}
interface ValidatedUpdate {
  readonly action: "update";
  readonly packageId: string | undefined;
}

type Validated = ValidatedInstall | ValidatedUninstall | ValidatedList | ValidatedUpdate;

type ParseOutcome = { readonly ok: true; readonly value: Validated } | { readonly ok: false; readonly message: string };

function parseKindOption(opts: ParsedOptions): { ok: true; value: PluginKind | undefined } | { ok: false; message: string } {
  if (!opts.hasKindFlag) return { ok: true, value: undefined };
  if (opts.kind === "agent" || opts.kind === "plugin") {
    return { ok: true, value: opts.kind };
  }
  return {
    ok: false,
    message: `--kind 取值须为 agent 或 plugin(收到 "${opts.kind ?? ""}")。`,
  };
}

/** 解析 `/install` 的 argv。裸命令与未知子动作返回专用用法文本;合法子动作各自校验必需参数。 */
function parseInstallArgv(argv: string): ParseOutcome {
  const tokens = tokenize(argv);
  const actionTok = tokens[0];
  if (actionTok === undefined) {
    return { ok: false, message: USAGE_TEXT };
  }
  if (actionTok !== "install" && actionTok !== "uninstall" && actionTok !== "list" && actionTok !== "update") {
    return { ok: false, message: `未知子动作 "${actionTok}"。\n${USAGE_TEXT}` };
  }
  const action: Action = actionTok;
  const opts = parseOptions(tokens.slice(1));

  if (action === "install") {
    const kindResult = parseKindOption(opts);
    if (!kindResult.ok) return { ok: false, message: kindResult.message };
    const source = opts.positional[0];
    if (source === undefined) {
      return {
        ok: false,
        message: `install 缺少 <source> 参数。\n用法: /install install <source> [--kind agent|plugin]`,
      };
    }
    return { ok: true, value: { action: "install", source, kindHint: kindResult.value } };
  }

  if (action === "uninstall") {
    const kindResult = parseKindOption(opts);
    if (!kindResult.ok) return { ok: false, message: kindResult.message };
    const id = opts.positional[0];
    if (id === undefined) {
      return {
        ok: false,
        message: `uninstall 缺少 <id> 参数。\n用法: /install uninstall <id> [--kind agent|plugin]`,
      };
    }
    return { ok: true, value: { action: "uninstall", id, kindHint: kindResult.value } };
  }

  if (action === "list") {
    return { ok: true, value: { action: "list", outdated: opts.outdated } };
  }

  // update:不接受 --kind(update 仅支持 plugin 通道)。
  if (opts.hasKindFlag) {
    return { ok: false, message: "update 不支持 --kind(仅支持 plugin 通道,不接受 kind 选择)。" };
  }
  return { ok: true, value: { action: "update", packageId: opts.positional[0] } };
}

// ---------------------------------------------------------------------------
// 脱敏收集器(内存 ProgressReporter 语义):每个执行类动作产出一个 InstallStep。
// ---------------------------------------------------------------------------

function completeStep(stage: string, detail?: string): InstallStep {
  return { stage, status: "complete", ...(detail !== undefined ? { detail: redactSecrets(detail) } : {}) };
}

function failStep(stage: string, code: string, message: string): InstallStep {
  return { stage, status: "failed", detail: redactSecrets(`[${code}] ${message}`) };
}

// ---------------------------------------------------------------------------
// InstallerError → 失败卡片(allowlist/component 等错误码的 message 装饰)
// ---------------------------------------------------------------------------

/** allowlist 拒绝原因按错误码附对应 env 放行指引(Req 3.3);git host 无 env 放行途径。 */
function decorateAllowlistReason(reason: string): string {
  if (reason.includes("local sources are not allowed")) {
    return `${reason}(设置环境变量 PI_WEB_EXT_ALLOW_LOCAL=1 以放行本地来源)`;
  }
  if (reason.includes("npm scope") || reason.includes("unscoped npm")) {
    return `${reason}(设置环境变量 PI_WEB_EXT_ALLOW_NPM=1 以放行任意 npm 包,仍要求精确版本固定)`;
  }
  if (reason.includes("git host")) {
    return `${reason}(git host 白名单当前不支持环境变量放行,需在部署配置中调整允许的 host 列表)`;
  }
  return reason;
}

function guidanceForInstallerError(error: InstallerError): string | undefined {
  if (error.code === "KIND_COMPONENT_UNSUPPORTED") {
    return "请在目标 source 目录内运行 `pi-web add` 安装组件包。";
  }
  if (error.code === "PROJECT_NOT_TRUSTED" && error.hint !== undefined) {
    return error.hint;
  }
  return undefined;
}

function messageForInstallerError(error: InstallerError): string {
  const decorated = error.code === "ALLOWLIST_REJECTED" ? decorateAllowlistReason(error.message) : error.message;
  return redactSecrets(decorated);
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

export function createInstallHostCommand(deps: InstallHostCommandDeps): HostCommandHandler {
  function adminDeniedResult(action: Action): CommandResult {
    const reason = "admin authorization denied";
    deps.audit?.({ action, outcome: "rejected", reason });
    const data: InstallResultData = {
      action,
      ok: false,
      steps: [],
      error: {
        code: "ADMIN_DENIED",
        message:
          "管理员权限校验未通过,拒绝执行。设置环境变量 PI_WEB_EXT_ADMIN_ALLOW_ANY=1 以放行" +
          "(仅限 dev/单用户自托管场景)。",
      },
    };
    return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
  }

  return {
    name: COMMAND_NAME,
    async execute(ctx: HostCommandContext): Promise<CommandResult> {
      const parsed = parseInstallArgv(ctx.argv);
      if (!parsed.ok) {
        return usageResult(parsed.message);
      }

      if (!deps.adminGate()) {
        return adminDeniedResult(parsed.value.action);
      }

      const v = parsed.value;
      // 本地源解析基准 = 会话 cwd(与 install-sources 补全端点同基准),装配 cwd 仅兜底。
      const cwd = ctx.session.cwd ?? deps.cwd;

      if (v.action === "install") {
        // v.source 是用户 argv 原样输入(可能内嵌 user:token@host 凭据):安装调用必须用
        // 原始值(凭据是拉取所需),但**一切输出面**(卡片 data.id / 审计事件)一律用脱敏副本
        // (Req 5.3——复核抓到的真实泄露路径,单测有带凭据 URL 的回归样本)。
        const safeSource = redactSecrets(v.source);
        const result = await deps.installer.install(v.source, { kindHint: v.kindHint, cwd });
        if (!result.ok) {
          if (result.error.code === "ALLOWLIST_REJECTED") {
            deps.audit?.({
              action: "install",
              source: safeSource,
              outcome: "rejected",
              reason: redactSecrets(result.error.message),
            });
          }
          const message = messageForInstallerError(result.error);
          const data: InstallResultData = {
            action: "install",
            ok: false,
            id: safeSource,
            guidance: guidanceForInstallerError(result.error),
            steps: [failStep("install", result.error.code, result.error.message)],
            error: { code: result.error.code, message },
          };
          return { command: COMMAND_NAME, effect: "notify", message, data };
        }

        const outcome = result.value;
        if (outcome.kind === "agent") {
          const guidance = `已安装到 ${outcome.result.location}。在 source 选择器中切换即可使用,无需重启会话。`;
          const data: InstallResultData = {
            action: "install",
            ok: true,
            kind: "agent",
            id: safeSource,
            location: outcome.result.location,
            guidance,
            steps: [completeStep("install:agent", outcome.result.location)],
          };
          return { command: COMMAND_NAME, effect: "panel-refresh", message: guidance, data };
        }

        await deps.reloadRunner(ctx.session);
        const guidance = "当前会话已重新加载,变更已生效。";
        const data: InstallResultData = {
          action: "install",
          ok: true,
          kind: "plugin",
          id: outcome.result.id,
          guidance,
          steps: [completeStep("install:plugin", outcome.result.id)],
        };
        return { command: COMMAND_NAME, effect: "notify", message: guidance, data };
      }

      if (v.action === "uninstall") {
        // 同 install:v.id 原样进卸载调用,输出面一律用脱敏副本(Req 5.3)。
        const safeId = redactSecrets(v.id);
        const result = await deps.installer.uninstall(v.id, { kindHint: v.kindHint, cwd });
        if (!result.ok) {
          if (result.error.code === "ALLOWLIST_REJECTED") {
            deps.audit?.({
              action: "uninstall",
              source: safeId,
              outcome: "rejected",
              reason: redactSecrets(result.error.message),
            });
          }
          const message = messageForInstallerError(result.error);
          const data: InstallResultData = {
            action: "uninstall",
            ok: false,
            id: safeId,
            guidance: guidanceForInstallerError(result.error),
            steps: [failStep("uninstall", result.error.code, result.error.message)],
            error: { code: result.error.code, message },
          };
          return { command: COMMAND_NAME, effect: "notify", message, data };
        }

        const outcome = result.value;
        if (outcome.kind === "agent") {
          const guidance = "已从 source 选择器中移除,无需重启会话。";
          const data: InstallResultData = {
            action: "uninstall",
            ok: true,
            kind: "agent",
            id: safeId,
            guidance,
            steps: [completeStep("uninstall:agent", safeId)],
          };
          return { command: COMMAND_NAME, effect: "panel-refresh", message: guidance, data };
        }

        await deps.reloadRunner(ctx.session);
        const guidance = "当前会话已重新加载,变更已生效。";
        const data: InstallResultData = {
          action: "uninstall",
          ok: true,
          kind: "plugin",
          id: outcome.result.id,
          guidance,
          steps: [completeStep("uninstall:plugin", outcome.result.id)],
        };
        return { command: COMMAND_NAME, effect: "notify", message: guidance, data };
      }

      if (v.action === "list") {
        const result = await deps.pluginInstaller.listInstalled({ outdated: v.outdated });
        if (!result.ok) {
          const data: InstallResultData = {
            action: "list",
            ok: false,
            steps: [failStep("list", result.error.code, result.error.message)],
            error: { code: result.error.code, message: redactSecrets(result.error.message) },
          };
          return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
        }
        const items = result.value.map((entry) => ({
          id: entry.id,
          version: entry.version,
          scope: entry.scope,
          kind: entry.kind,
        }));
        const data: InstallResultData = {
          action: "list",
          ok: true,
          items,
          steps: [],
        };
        return { command: COMMAND_NAME, effect: "notify", data };
      }

      // update
      const result = await deps.pluginInstaller.update({ packageId: v.packageId });
      if (!result.ok) {
        const data: InstallResultData = {
          action: "update",
          ok: false,
          steps: [failStep("update", result.error.code, result.error.message)],
          error: { code: result.error.code, message: redactSecrets(result.error.message) },
        };
        return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
      }

      const { outcomes, hasFailures } = result.value;
      const steps: InstallStep[] = outcomes.map((o) =>
        o.status === "failed"
          ? failStep(o.id, "PLUGIN_UPDATE_FAILED", o.reason ?? "update failed")
          : completeStep(o.id, o.reason),
      );
      const items = outcomes.map((o) => ({ id: o.id, kind: "plugin", scope: undefined, version: undefined }));

      if (!hasFailures) {
        await deps.reloadRunner(ctx.session);
      }

      const data: InstallResultData = {
        action: "update",
        ok: !hasFailures,
        kind: "plugin",
        steps,
        items,
        ...(hasFailures
          ? { error: { code: "PLUGIN_UPDATE_PARTIAL_FAILURE", message: "部分包更新失败,详见 steps。" } }
          : {}),
      };
      return {
        command: COMMAND_NAME,
        effect: "notify",
        message: hasFailures ? "部分包更新失败,详见 steps。" : "更新完成。",
        data,
      };
    },
  };
}

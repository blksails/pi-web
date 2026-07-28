/**
 * package-host-command — `/agent` 与 `/plugin` 两条 host 命令的执行器
 * (spec agent-plugin-commands,任务 2.1/2.2;取代 spec install-host-command 的单一 `/install`)。
 *
 * 一个**参数化工厂**产出两个 handler:两条命令的 argv 解析、门控、脱敏、结果组装完全同构,
 * 差异只有「承载类别」与「子动作集合」两个参数,故不复制两份实现——那只会让文案与门控漂移。
 *
 * 类别在**构造时固化**:调用 CLI install 子域时恒传 `kindHint = kind`,运行期不可被 argv 改写。
 * 这也是 `--kind` 被移除的原因:命令名即意图。安装/卸载/列出/更新的真实逻辑一律委托注入的
 * `Installer`/`PluginInstaller`(`server/cli/install/*`)——不复制第二份安装逻辑。
 *
 * 门控顺序(Req 6.1-6.2):参数校验(纯本地,产出用法文本,effect:"none",无 data)→ `adminGate`
 * (拒绝→失败卡片 + 审计)→ 进入 CLI 子域(allowlist 拒绝由编排内产生,handler 只负责把错误码
 * 装饰为可操作的 env 放行指引 + 审计)→ 结果组装。
 *
 * 生效分道(Req 1.7, 2.5):agent 通道成功恒不调用 `reloadRunner`,只给出 `effect:"panel-refresh"`
 * + 选择器切换指引;plugin 通道(install/uninstall/update)成功时**在返回前**恰调用一次
 * `reloadRunner(ctx.session)`,`effect:"notify"`。
 */
import type {
  HostCommandContext,
  HostCommandHandler,
  PiSession,
} from "@blksails/pi-web-server";
import type {
  CommandResult,
  InstallResultData,
  InstallStep,
  PluginKind,
  PublishPreviewData,
} from "@blksails/pi-web-protocol";
import { PUBLISH_PREVIEW_DATA_PART } from "@blksails/pi-web-protocol";
import * as path from "node:path";
// 相对路径 + `.js` 后缀是仓库唯一在三条解析链(vite dev / jiti 服务端 / esbuild 产物)上
// 都成立的形态——`@/` 别名 jiti 不认(bun dev 实证崩)、esbuild 靠自建插件才认。
import type { Installer, InstallerError } from "../../server/cli/install/installer.js";
import type { PluginInstaller } from "../../server/cli/install/plugin-installer.js";
import { redactSecrets } from "../../server/cli/reporter.js";
import { previewPublish } from "./publish-preview.js";

/**
 * 拒绝路径的审计事件(仅 adminGate 拒绝 / allowlist 拒绝两条路径触发,与既有 REST 安装的
 * 审计一致)。本层不掌握 `AuthContext`(`HostCommandContext` 只有 `session`/`argv`),故不直接
 * 复用 REST 的 `OnAudit`;装配层负责补 actor/at 后转发给同一个 `onAudit` 实例。
 */
export interface InstallAuditEvent {
  readonly action: "install" | "uninstall" | "list" | "update" | "publish";
  readonly source?: string;
  readonly outcome: "rejected";
  readonly reason: string;
}

/** 命令承载的类别。构造时固化,运行期不可覆盖。 */
export type PackageCommandKind = PluginKind;

/** `/agent list` 的数据源记录(投影自装配层的 agent 源枚举)。 */
export interface AgentSourceListItem {
  readonly id: string;
}

export interface PackageHostCommandDeps {
  /** 已注入 extAllowlist 的实例(装配层职责,本文件不重复判断白名单)。 */
  readonly installer: Installer;
  readonly pluginInstaller: PluginInstaller;
  /** extAllowMutate 同源的管理员判定。 */
  readonly adminGate: () => boolean;
  readonly reloadRunner: (session: PiSession) => Promise<void>;
  readonly audit?: (event: InstallAuditEvent) => void;
  /**
   * `/agent list` 的数据源。CLI install 子域的 agent 通道只有 install/uninstall,没有列举能力
   * (`AgentChannel`),故由装配层接既有的 agent 源枚举 provider(同 `GET /agent-sources`)。
   * 未注入 → `/agent list` 如实转达该部署不支持,而不是假装空列表。
   */
  readonly listAgentSources?: () => Promise<readonly AgentSourceListItem[]>;
  /**
   * `resolveSource` 本地源解析基准的**装配兜底**。执行时优先用 `ctx.session.cwd`——
   * install 参数位补全(GET /sessions/:id/install-sources)按会话 cwd 扫描产出 `local:<rel>`
   * 候选,执行与补全必须同基准,否则选中候选直接提交会解析失败。
   */
  readonly cwd?: string;
  /**
   * 发布前确保本机公钥已登记(spec publish-key-lifecycle,Req 2.1)。
   *
   * **best-effort**:未注入、或调用失败,`/agent publish` 的行为与输出**完全不变** ——
   * 登记只是发布的准备,不是发布本身。
   */
  readonly ensurePublishKeyRegistered?: () => Promise<unknown>;
  /**
   * 真实发布(spec publish-execution)。**未注入 → 裸 `publish` 仍返回
   * `PUBLISH_NOT_AVAILABLE`**,即"该部署未接入发布身份",语义与本 spec 引入前一致。
   */
  readonly executePublish?: (input: {
    readonly packageDir: string;
    readonly expectedKind: PluginKind;
    readonly channel?: string;
  }) => Promise<{ readonly data: PublishPreviewData; readonly message: string }>;
  /**
   * 发布结果审计。与 {@link audit} 分开:那个的 `outcome` 只有 `rejected`
   * (它服务的是门控拒绝),而发布需要记成功/失败两态。
   */
  readonly auditPublish?: (event: PublishAuditEvent) => void;
}

/** 发布动作的审计事件(spec publish-execution R6.4)。**不含任何凭据**。 */
export interface PublishAuditEvent {
  readonly action: "publish";
  readonly outcome: "succeeded" | "failed";
  /** `sourceId@version`;仅成功(或部分成功)时有。 */
  readonly source?: string;
  /** 失败时的错误码(**不是** message —— message 可能含用户路径)。 */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// 每类别的静态元数据(子动作集合 + 用法文本)
// ---------------------------------------------------------------------------

type Action = "install" | "uninstall" | "list" | "update" | "publish";

const AGENT_ACTIONS: readonly Action[] = ["install", "uninstall", "list", "publish"];
const PLUGIN_ACTIONS: readonly Action[] = ["install", "uninstall", "list", "update", "publish"];

function actionsFor(kind: PackageCommandKind): readonly Action[] {
  return kind === "agent" ? AGENT_ACTIONS : PLUGIN_ACTIONS;
}

function usageTextFor(kind: PackageCommandKind): string {
  if (kind === "agent") {
    return [
      "用法: /agent <install|uninstall|list|publish> [参数]",
      "  install <source>     安装 agent 源(本地目录、npm 包、git 仓库,或 registry 标识如 org/name)",
      "  uninstall <id>       卸载已安装的 agent 源",
      "  list                 列出已安装的 agent 源",
      "  publish <dir> [--channel <名>]  发布到注册表(需已登录;版本一经发布不可更改)",
      "  publish <dir> --dry-run   发布前预览(编译校验,不签名、不上传)",
      "注:本命令恒按 agent 处理来源,npm/git 直连来源亦然;plugin 请用 /plugin。",
      "注:来源/包标识暂不支持包含空格的路径。",
    ].join("\n");
  }
  return [
    "用法: /plugin <install|uninstall|list|update|publish> [参数]",
    "  install <source>     安装 plugin(本地目录、npm 包、git 仓库,或 registry 标识如 org/name)",
    "  uninstall <id>       卸载已安装的 plugin",
    "  list [--outdated]    列出已安装 plugin(--outdated 如实转达底层是否支持)",
    "  update [id]          更新 plugin",
    "  publish <dir> [--channel <名>]  发布到注册表(需已登录;版本一经发布不可更改)",
    "  publish <dir> --dry-run   发布前预览(编译校验,不签名、不上传)",
    "注:本命令恒按 plugin 处理来源;agent 源请用 /agent。",
    "注:来源/包标识暂不支持包含空格的路径。",
  ].join("\n");
}

/** `--kind` 已随命令拆分移除:静默忽略会让沿用旧习惯的人以为覆盖生效了,故显式报错。 */
const KIND_FLAG_REMOVED =
  "--kind 选项已移除:类别由命令名决定,请改用 /agent 或 /plugin。";

// ---------------------------------------------------------------------------
// argv 解析(空白分词,v1 不支持引号包裹路径)
// ---------------------------------------------------------------------------

interface ParsedOptions {
  readonly positional: readonly string[];
  readonly hasKindFlag: boolean;
  readonly outdated: boolean;
  readonly dryRun: boolean;
  /** `--channel <name>`(publish 用)。未给 → undefined,由下游落缺省。 */
  readonly channel?: string;
}

function tokenize(argv: string): string[] {
  const trimmed = argv.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

function parseOptions(tokens: readonly string[]): ParsedOptions {
  const positional: string[] = [];
  let hasKindFlag = false;
  let outdated = false;
  let dryRun = false;
  let channel: string | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok === "--kind") {
      hasKindFlag = true;
      i += 1; // 跳过其取值,避免它被当成位置参数。
    } else if (tok === "--outdated") {
      outdated = true;
    } else if (tok === "--dry-run") {
      dryRun = true;
    } else if (tok === "--channel") {
      // 取值同样要跳过,否则会被当成位置参数(与 --kind 同一坑)。
      channel = tokens[i + 1];
      i += 1;
    } else {
      positional.push(tok);
    }
  }
  return { positional, hasKindFlag, outdated, dryRun, ...(channel !== undefined ? { channel } : {}) };
}

interface ValidatedInstall {
  readonly action: "install";
  readonly source: string;
}
interface ValidatedUninstall {
  readonly action: "uninstall";
  readonly id: string;
}
interface ValidatedList {
  readonly action: "list";
  readonly outdated: boolean;
}
interface ValidatedUpdate {
  readonly action: "update";
  readonly packageId: string | undefined;
}
interface ValidatedPublish {
  readonly action: "publish";
  readonly dir: string;
  /** `--dry-run` = 预览;缺省 = **真正发布的意图**(见下方裁断)。 */
  readonly dryRun: boolean;
  /** `--channel <name>`;未给时由下游落缺省(`stable`)。 */
  readonly channel?: string;
}

type Validated =
  | ValidatedInstall
  | ValidatedUninstall
  | ValidatedList
  | ValidatedUpdate
  | ValidatedPublish;

type ParseOutcome =
  | { readonly ok: true; readonly value: Validated }
  | { readonly ok: false; readonly message: string };

/**
 * 解析 argv。裸命令与未知/越界子动作返回该命令专属用法文本;`--kind` 一律判为参数错误。
 * `kind` 决定合法子动作集合——agent 命令的 `update` 即"越界",按未知子动作处理。
 */
function parseArgv(kind: PackageCommandKind, argv: string): ParseOutcome {
  const usage = usageTextFor(kind);
  const tokens = tokenize(argv);
  const actionTok = tokens[0];
  if (actionTok === undefined) {
    return { ok: false, message: usage };
  }
  const actions = actionsFor(kind);
  if (!actions.includes(actionTok as Action)) {
    return { ok: false, message: `未知子动作 "${actionTok}"。\n${usage}` };
  }
  const action = actionTok as Action;
  const opts = parseOptions(tokens.slice(1));

  if (opts.hasKindFlag) {
    return { ok: false, message: `${KIND_FLAG_REMOVED}\n${usage}` };
  }

  if (action === "install") {
    const source = opts.positional[0];
    if (source === undefined) {
      return {
        ok: false,
        message: `install 缺少 <source> 参数。\n用法: /${kind} install <source>`,
      };
    }
    return { ok: true, value: { action: "install", source } };
  }

  if (action === "uninstall") {
    const id = opts.positional[0];
    if (id === undefined) {
      return {
        ok: false,
        message: `uninstall 缺少 <id> 参数。\n用法: /${kind} uninstall <id>`,
      };
    }
    return { ok: true, value: { action: "uninstall", id } };
  }

  if (action === "list") {
    return { ok: true, value: { action: "list", outdated: opts.outdated } };
  }

  if (action === "publish") {
    const dir = opts.positional[0];
    if (dir === undefined) {
      return {
        ok: false,
        message: `publish 缺少 <dir> 参数。\n用法: /${kind} publish <dir> --dry-run`,
      };
    }
    return {
      ok: true,
      value: {
        action: "publish",
        dir,
        dryRun: opts.dryRun,
        ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
      },
    };
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

/** allowlist 拒绝原因按错误码附对应 env 放行指引(Req 6.2);git host 无 env 放行途径。 */
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
  // registry 通道(spec installer-registry-channel):把「为什么不行」变成「该怎么办」。
  // 具体该改用哪条命令由 Installer 依**清单里的真实 kind** 写进 message,本层不重复判断。
  if (error.code === "REGISTRY_KIND_MISMATCH") {
    return "类别由命令名决定:请改用与该包实际类别匹配的那条命令重新安装。";
  }
  if (error.code === "REGISTRY_UNAVAILABLE") {
    return "线上包需要 registry 通道:请先登录;自托管部署请确认已配置云端地址(或 PI_WEB_REGISTRY_URL)。";
  }
  return undefined;
}

function messageForInstallerError(error: InstallerError): string {
  const decorated = error.code === "ALLOWLIST_REJECTED" ? decorateAllowlistReason(error.message) : error.message;
  return redactSecrets(decorated);
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 产出名为 `agent` 或 `plugin` 的 host 命令 handler。
 *
 * - `"agent"`:子动作 install / uninstall / list;成功恒 `panel-refresh`,不重载会话。
 * - `"plugin"`:子动作 install / uninstall / list / update;成功恰重载一次会话。
 */
export function createPackageHostCommand(
  kind: PackageCommandKind,
  deps: PackageHostCommandDeps,
): HostCommandHandler {
  const COMMAND_NAME = kind;

  function usageResult(message: string): CommandResult {
    return { command: COMMAND_NAME, effect: "none", message };
  }

  const ADMIN_DENIED_MESSAGE =
    "管理员权限校验未通过,拒绝执行。设置环境变量 PI_WEB_EXT_ADMIN_ALLOW_ANY=1 以放行" +
    "(仅限 dev/单用户自托管场景)。";

  function adminDeniedResult(action: Action): CommandResult {
    const reason = "admin authorization denied";
    deps.audit?.({ action, outcome: "rejected", reason });
    // publish 的结果形状与安装类不同 —— 拒绝态也必须走 publish 卡片,
    // 否则前端会拿 install 渲染器去渲染一个没有 action 字段的对象。
    if (action === "publish") {
      return publishResult(
        {
          ok: false,
          files: [],
          warnings: [],
          disclaimers: { unsigned: true, grantNotChecked: true },
          error: { code: "ADMIN_DENIED", message: ADMIN_DENIED_MESSAGE },
        },
        ADMIN_DENIED_MESSAGE,
      );
    }
    const data: InstallResultData = {
      action,
      ok: false,
      steps: [],
      error: { code: "ADMIN_DENIED", message: ADMIN_DENIED_MESSAGE },
    };
    return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
  }

  /** agent 成功路径:恒 panel-refresh,不重载会话。 */
  function agentSuccess(
    action: "install" | "uninstall",
    id: string,
    guidance: string,
    location?: string,
  ): CommandResult {
    const data: InstallResultData = {
      action,
      ok: true,
      kind: "agent",
      id,
      ...(location !== undefined ? { location } : {}),
      guidance,
      steps: [completeStep(`${action}:agent`, location ?? id)],
    };
    return { command: COMMAND_NAME, effect: "panel-refresh", message: guidance, data };
  }

  /** plugin 成功路径:先重载会话,再回结果。 */
  async function pluginSuccess(
    action: "install" | "uninstall",
    id: string,
    session: PiSession,
  ): Promise<CommandResult> {
    await deps.reloadRunner(session);
    const guidance = "当前会话已重新加载,变更已生效。";
    const data: InstallResultData = {
      action,
      ok: true,
      kind: "plugin",
      id,
      guidance,
      steps: [completeStep(`${action}:plugin`, id)],
    };
    return { command: COMMAND_NAME, effect: "notify", message: guidance, data };
  }

  function installerFailure(
    action: "install" | "uninstall",
    safeId: string,
    error: InstallerError,
  ): CommandResult {
    if (error.code === "ALLOWLIST_REJECTED") {
      deps.audit?.({
        action,
        source: safeId,
        outcome: "rejected",
        reason: redactSecrets(error.message),
      });
    }
    const message = messageForInstallerError(error);
    const data: InstallResultData = {
      action,
      ok: false,
      id: safeId,
      guidance: guidanceForInstallerError(error),
      steps: [failStep(action, error.code, error.message)],
      error: { code: error.code, message },
    };
    return { command: COMMAND_NAME, effect: "notify", message, data };
  }

  /** `/agent list`:数据源是装配层注入的 agent 源枚举(CLI agent 通道无列举能力)。 */
  async function listAgentSources(): Promise<CommandResult> {
    if (deps.listAgentSources === undefined) {
      const data: InstallResultData = {
        action: "list",
        ok: false,
        steps: [],
        error: {
          code: "AGENT_LIST_NOT_SUPPORTED",
          message: "当前部署未提供 agent 源枚举能力。",
        },
      };
      return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
    }
    const sources = await deps.listAgentSources();
    const data: InstallResultData = {
      action: "list",
      ok: true,
      items: sources.map((s) => ({ id: s.id, kind: "agent" })),
      steps: [],
    };
    return { command: COMMAND_NAME, effect: "notify", data };
  }

  async function listPlugins(outdated: boolean): Promise<CommandResult> {
    const result = await deps.pluginInstaller.listInstalled({ outdated });
    if (!result.ok) {
      const data: InstallResultData = {
        action: "list",
        ok: false,
        steps: [failStep("list", result.error.code, result.error.message)],
        error: { code: result.error.code, message: redactSecrets(result.error.message) },
      };
      return { command: COMMAND_NAME, effect: "notify", message: data.error!.message, data };
    }
    const data: InstallResultData = {
      action: "list",
      ok: true,
      items: result.value.map((entry) => ({
        id: entry.id,
        version: entry.version,
        scope: entry.scope,
        kind: entry.kind,
      })),
      steps: [],
    };
    return { command: COMMAND_NAME, effect: "notify", data };
  }

  /** publish 类结果:卡片形状与安装类不同,故经 `dataPart` 显式指定渲染器。 */
  function publishResult(data: PublishPreviewData, message: string): CommandResult {
    return {
      command: COMMAND_NAME,
      // 预览不改变会话可用能力,故不重载会话、不刷面板。
      effect: "notify",
      message,
      data,
      dataPart: PUBLISH_PREVIEW_DATA_PART,
    };
  }

  /**
   * `publish` 子动作。
   *
   * ★ 语义裁断(agent-plugin-commands 原文,**至今未变**):`--dry-run` = 预览;
   *   **裸 `publish` = 真正发布的意图**。当时它返回 `PUBLISH_NOT_AVAILABLE`,并写着
   *   「云端发布身份就绪后,裸 publish 直接开始工作,语义不变、文案无需改」——
   *   spec publish-execution 兑现的正是这句:此处换成真实发布,语义与文案确实一字未改。
   *
   * 未注入 `executePublish`(该部署未接入发布身份)→ 仍返回 `PUBLISH_NOT_AVAILABLE`。
   */
  async function publishPreview(
    dir: string,
    dryRun: boolean,
    cwd: string | undefined,
    channel?: string,
  ): Promise<CommandResult> {
    if (!dryRun) {
      if (deps.executePublish === undefined) {
        const message = "该部署尚未接入发布身份,无法执行真正的发布。";
        return publishResult(
          {
            ok: false,
            files: [],
            warnings: [],
            disclaimers: { unsigned: true, grantNotChecked: true },
            error: {
              code: "PUBLISH_NOT_AVAILABLE",
              message,
              hint: "加 --dry-run 可做发布前预览(编译校验、文件清单与告警),不产生任何外部写。",
            },
          },
          message,
        );
      }
      // 真实发布。相对路径基准与预览一致(见下方同一裁断)。
      const absDir = path.isAbsolute(dir) ? dir : path.resolve(cwd ?? process.cwd(), dir);
      const outcome = await deps.executePublish({
        packageDir: absDir,
        expectedKind: kind,
        ...(channel !== undefined ? { channel } : {}),
      });
      // 审计:记录动作与结果,**不含任何凭据**(结果数据本身已保证无 token)。
      deps.auditPublish?.({
        action: "publish",
        outcome: outcome.data.ok ? "succeeded" : "failed",
        ...(outcome.data.published !== undefined
          ? { source: `${outcome.data.published.sourceId}@${outcome.data.published.version}` }
          : {}),
        ...(outcome.data.error !== undefined ? { reason: outcome.data.error.code } : {}),
      });
      return publishResult(outcome.data, outcome.message);
    }
    // 发布前**尽力**确保本机公钥已登记(spec publish-key-lifecycle)。
    // ★ 刻意吞掉一切失败且不改下方任何输出:预览本可以照常给出编译校验与文件清单,
    //   登记不上不该让它整个崩。
    try {
      await deps.ensurePublishKeyRegistered?.();
    } catch {
      /* best-effort;失败对本命令的输出零影响 */
    }
    // 相对路径以会话 cwd 为基准 —— 必须与补全端点同基准,否则选中候选提交即失败。
    const abs = path.isAbsolute(dir) ? dir : path.resolve(cwd ?? process.cwd(), dir);
    const outcome = await previewPublish(abs, kind);
    return publishResult(outcome.data, outcome.message);
  }

  async function updatePlugins(
    packageId: string | undefined,
    session: PiSession,
  ): Promise<CommandResult> {
    const result = await deps.pluginInstaller.update({ packageId });
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
      await deps.reloadRunner(session);
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
  }

  return {
    name: COMMAND_NAME,
    async execute(ctx: HostCommandContext): Promise<CommandResult> {
      const parsed = parseArgv(kind, ctx.argv);
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
        // 原始值(凭据是拉取所需),但**一切输出面**(卡片 data.id / 审计事件)一律用脱敏副本。
        const safeSource = redactSecrets(v.source);
        const result = await deps.installer.install(v.source, { kindHint: kind, cwd });
        if (!result.ok) {
          return installerFailure("install", safeSource, result.error);
        }
        const outcome = result.value;
        if (outcome.kind === "agent") {
          return agentSuccess(
            "install",
            safeSource,
            `已安装到 ${outcome.result.location}。在 source 选择器中切换即可使用,无需重启会话。`,
            outcome.result.location,
          );
        }
        return pluginSuccess("install", outcome.result.id, ctx.session);
      }

      if (v.action === "uninstall") {
        // 同 install:v.id 原样进卸载调用,输出面一律用脱敏副本。
        const safeId = redactSecrets(v.id);
        const result = await deps.installer.uninstall(v.id, { kindHint: kind, cwd });
        if (!result.ok) {
          return installerFailure("uninstall", safeId, result.error);
        }
        const outcome = result.value;
        if (outcome.kind === "agent") {
          return agentSuccess("uninstall", safeId, "已从 source 选择器中移除,无需重启会话。");
        }
        return pluginSuccess("uninstall", outcome.result.id, ctx.session);
      }

      if (v.action === "list") {
        return kind === "agent" ? listAgentSources() : listPlugins(v.outdated);
      }

      if (v.action === "publish") {
        return publishPreview(v.dir, v.dryRun, cwd, v.channel);
      }

      // update:仅 plugin 命令可达(agent 命令的 update 已在解析层按未知子动作拒绝)。
      return updatePlugins(v.packageId, ctx.session);
    },
  };
}

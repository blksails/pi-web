/**
 * Installer — 按包类型分派安装通道的统一端口(spec cli-package-commands,任务 4.5,
 * Req 3.1, 3.2, 3.3)。
 *
 * 调用方(未来的 `install`/`uninstall` 子命令,任务 6.1)只调用 `Installer.install()` /
 * `Installer.uninstall()` 这一个方法,不感知底层走的是 agent 通道(`installAgentSource`,
 * 4.4)还是 plugin 通道(`createPluginInstaller`,4.3)——分派完全在本文件内部完成。
 *
 * ## 决策 1:`kind` 的确定策略
 *
 * `resolveSource()`(4.2)对本地路径来源读取目标目录的 `pi-web.json#kind`,是**真实**
 * 判据,直接信任。但对 npm/git 直连来源,`kind` 在下载前无从得知(4.2 的占位值恒为
 * `"agent"`,是设计缺口,详见该文件头 DESIGN_GAP),**不可直接信任**。
 *
 * 本文件的裁断(父级已裁定):
 *   - 本地路径来源 → 信任 `resolveSource()` 给出的 `kind`。
 *   - npm/git 直连来源且未显式指定 → **默认按 `"plugin"` 处理**,走 `PluginInstaller`
 *     (`pi install`)。这是一条**约定**,不是探测结果 —— pi 自身的包管理是 plugin 包的
 *     自然归宿;agent source 的远程分发是注册表(Wave 2)的职责,那时 `kind` 来自已
 *     验签的 manifest,可信。直连 npm/git 装 agent 是罕见场景,交给显式 `kindHint` 覆盖。
 *   - `install()` 接受可选的 `kindHint`,给出时以它为准(任务 6.1 会把
 *     `install --kind <agent|plugin>` 接到这里)。
 *   - 绝不静默误判:不把 plugin 装进 agent 源根,也不反过来。
 *
 * ## 决策 1b:`uninstall()` 的 kind 判定(缺陷修复)
 *
 * `uninstall()` 只有一个台账 `id`,没有 `resolveSource()` 那样的「先解析来源读
 * `pi-web.json#kind`」的机会 —— 此前的实现因此**缺省一律按 `"plugin"` 处理**,把本地
 * agent 目录送去 `pi remove`,必定 `Not installed`(已由端到端复现的缺陷)。
 * 裁断:显式 `kindHint` 仍然优先;否则用 `isAgentSourceInstalled()`(只读探测,见
 * `agent-installer.ts`)查询这个 `id` 是否是 agent 通道已安装的源,命中则走 agent 通道,
 * 否则默认 `"plugin"`。选择「默认 plugin」而非「默认 agent」的理由:agent 通道对不
 * 匹配的 id 返回 `NOT_INSTALLED`(安全,不会误删任何东西),但 plugin 通道对不认识的
 * id 同样只是报错而非误删 —— 两者都安全,但 plugin 是历史默认约定,变更面更小。
 * 真正的修复价值在探测本身:只要探测命中 agent 通道,就不会再落到 plugin 通道报错。
 *
 * ## 决策 2:scope 语义
 *
 * 默认 `"user"`;显式 `"project"`。
 *   - **plugin 通道落 project** —— `assembleInstallArgs()`(`packages/server`,只读、不改)
 *     不产出 `-l`(pi 的 project 级标志)。追加 `-l` 的后处理内联在
 *     `plugin-installer.ts` 的 `install(source, { scope })` 里(它在 4.5 的边界内),
 *     本文件只是把 `scope` 透传下去,不再自行装配参数 —— 否则安装逻辑会存在于两处、必然漂移。
 *   - **agent 通道不支持 project** —— `~/.pi-web/agents` 是全局源根,project 作用域对它
 *     无意义。`scope === "project"` 且分派到 agent 通道时,返回
 *     `{ code: "AGENT_SCOPE_UNSUPPORTED" }`,不静默降级为 user,**不调用任何通道**。
 *
 * ## 决策 3:信任门控
 *
 * 用 `makeProjectTrustPolicy()`(从 `@blksails/pi-web-server/trust` **子路径**导入,
 * 刻意解耦 pi SDK、bundle 安全;不从 barrel 主入口拿)。CLI 无交互流程,故只有
 * `"always"` 视为已信任;`"never"`/`"ask"` 一律视为未信任。判定发生在任何安装/卸载动作
 * 之前,且只在 `scope === "project"` 时进行。未信任 → `{ code: "PROJECT_NOT_TRUSTED",
 * dir, hint }`,附带可操作的信任指引;`TrustPolicy` 可注入(测试用替身,不碰真实
 * trust store)。
 *
 * ## 实现笔记:plugin 通道的生产实现直接委托 `createPluginInstaller()`(任务 4.5 缺口 2)
 *
 * 此前 `createPluginInstaller(...).install(source)` 不接受 scope,本文件为了在装配参数
 * 与执行之间插入 `-l` 而重新实现了一遍 assemble+execute——安装逻辑因此存在于两处,
 * 必然漂移(已发现的重复实现缺陷)。现 `plugin-installer.ts` 的 `install()` 本身接受
 * 可选的 `{ scope }`(见该文件头设计裁决 2),内部完成 `-l` 后处理;本文件的
 * `PluginChannel.install` 因此**直接委托** `createPluginInstaller().install(source, { scope })`,
 * 不再重复 assemble+execute。`uninstall`/`listInstalled` 同样直接委托。
 */
import {
  type AllowlistConfig,
  type ExtSource,
  type PiCli,
} from "@blksails/pi-web-server";
import { makeProjectTrustPolicy } from "@blksails/pi-web-server/trust";
import type { PluginKind } from "@blksails/pi-web-protocol";
import {
  createPluginInstaller,
  type InstallPluginResult,
  type PluginInstallError,
  type UninstallPluginResult,
} from "./plugin-installer.js";
import {
  installAgentSource,
  uninstallAgentSource,
  isAgentSourceInstalled,
  type AgentInstallerOptions,
  type AgentInstallError,
  type AgentInstallResult,
  type AgentUninstallError as AgentUninstallErrorFromChannel,
} from "./agent-installer.js";
import { resolveSource, CLI_ALLOWLIST, type ResolveError, type ResolvedSource } from "./source-resolver.js";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 安装作用域:未指定即用户级;显式指定即项目级(Req 3.2)。 */
export type Scope = "user" | "project";

/**
 * 项目信任策略契约(结构上与 `@blksails/pi-web-server` 的 `agent-source` 内部类型一致,
 * 在此本地重声明以避免从主 barrel 值导入 —— 只需要类型,不需要值)。
 */
export interface TrustPolicyInput {
  /** 待判定信任的项目目录(绝对路径)。 */
  readonly dir: string;
  /** 来源标识,供「按来源记忆信任」的策略实现使用。 */
  readonly source: string;
  /** 显式信任意图;CLI 无交互流程,恒为 `undefined`。 */
  readonly requestTrust?: boolean;
}
export type TrustDecision = "always" | "never" | "ask";
export type TrustPolicy = (input: TrustPolicyInput) => TrustDecision;

// ---------------------------------------------------------------------------
// 通道端口(两条通道实现同一形状,分派器内部按 kind 选择)
// ---------------------------------------------------------------------------

export interface AgentUninstallResult {
  readonly id: string;
}

/** 复用 4.5 缺口 1 补齐的 `uninstallAgentSource()` 错误码,不重复定义。 */
export type AgentUninstallError = AgentUninstallErrorFromChannel;

/** agent 通道端口。project 作用域从不下发到这里(分派器提前短路)。 */
export interface AgentChannel {
  install(source: ExtSource): Promise<Result<AgentInstallResult, AgentInstallError>>;
  uninstall(sourceId: string): Promise<Result<AgentUninstallResult, AgentUninstallError>>;
}

/** plugin 通道端口。`scope` 由分派器传入,通道自行决定如何落实(`-l` 后处理)。 */
export interface PluginChannel {
  install(
    source: ExtSource,
    scope: Scope,
  ): Promise<Result<InstallPluginResult, PluginInstallError>>;
  uninstall(
    sourceId: string,
    scope: Scope,
  ): Promise<Result<UninstallPluginResult, PluginInstallError>>;
}

// ---------------------------------------------------------------------------
// Installer 端口(调用方唯一入口,不感知通道差异)
// ---------------------------------------------------------------------------

export interface InstallOptions {
  /** 缺省 `"user"`。 */
  readonly scope?: Scope;
  /** 显式覆盖 npm/git 直连来源的默认 `"plugin"` 约定(见决策 1)。 */
  readonly kindHint?: PluginKind;
  /** 相对路径解析基准 + 信任判定目标目录;缺省 `process.cwd()`(测试注入)。 */
  readonly cwd?: string;
}

export interface UninstallOptions {
  readonly scope?: Scope;
  readonly kindHint?: PluginKind;
  readonly cwd?: string;
}

export type InstallOutcome =
  | { readonly kind: "agent"; readonly result: AgentInstallResult }
  | { readonly kind: "plugin"; readonly result: InstallPluginResult };

export type UninstallOutcome =
  | { readonly kind: "agent"; readonly result: AgentUninstallResult }
  | { readonly kind: "plugin"; readonly result: UninstallPluginResult };

export type InstallerErrorCode =
  | "ALLOWLIST_REJECTED"
  | "REGISTRY_NOT_IMPLEMENTED"
  | "AGENT_SCOPE_UNSUPPORTED"
  | "PROJECT_NOT_TRUSTED"
  | "AGENT_INSTALL_FAILED"
  | "PLUGIN_INSTALL_FAILED"
  | "AGENT_UNINSTALL_FAILED"
  | "PLUGIN_UNINSTALL_FAILED"
  | "KIND_COMPONENT_UNSUPPORTED";

export interface InstallerError {
  readonly code: InstallerErrorCode;
  readonly message: string;
  /** 仅 `PROJECT_NOT_TRUSTED` 携带:未信任的项目目录。 */
  readonly dir?: string;
  /** 仅 `PROJECT_NOT_TRUSTED` 携带:可操作的信任指引文案。 */
  readonly hint?: string;
}

export interface Installer {
  install(spec: string, options?: InstallOptions): Promise<Result<InstallOutcome, InstallerError>>;
  uninstall(id: string, options?: UninstallOptions): Promise<Result<UninstallOutcome, InstallerError>>;
}

export interface CreateInstallerOptions {
  /** 测试注入通道替身;缺省用生产实现(见下方 `createDefaultAgentChannel`/`createDefaultPluginChannel`)。 */
  readonly agentChannel?: AgentChannel;
  readonly pluginChannel?: PluginChannel;
  /** 测试注入信任策略替身;缺省 `makeProjectTrustPolicy()`(真实 trust store)。 */
  readonly trustPolicy?: TrustPolicy;
  /** env 源,缺省 `process.env`;测试注入以覆盖 `PI_WEB_EXT_ALLOW_NPM`,不直接读 `process.env`。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 生产 agent 通道所需的落盘配置(`sourcesRoot` 等);未提供且分派到 agent 通道时报错。 */
  readonly agentInstallerOptions?: AgentInstallerOptions;
  /** 生产 plugin 通道的 `PiCli` 注入(测试替身,或留空走 `piCliFactory`)。 */
  readonly piCli?: PiCli;
  readonly piCliFactory?: () => PiCli;
  /**
   * `resolveSource()` 的白名单配置注入接缝(spec install-host-command,任务 1.2)。
   * 未注入时行为与此前逐字节一致:`buildAllowlistConfig(env)`(`CLI_ALLOWLIST` 叠加
   * `PI_WEB_EXT_ALLOW_NPM`)。注入后**直接使用注入值**,不再叠加 env —— 调用方
   * (host 命令装配层)对 allowlist 的取舍已经做完,本文件不重复判断。
   */
  readonly allowlistConfig?: AllowlistConfig;
}

// ---------------------------------------------------------------------------
// 纯函数:project 作用域的 pi 参数后处理(决策 2)
// ---------------------------------------------------------------------------

/** `PI_WEB_EXT_ALLOW_NPM` 的真值判定:`"1"`/`"true"`(大小写不敏感,两端空白容忍)。 */
export function isAllowAnyNpmEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env["PI_WEB_EXT_ALLOW_NPM"];
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function buildAllowlistConfig(env: NodeJS.ProcessEnv): AllowlistConfig {
  return { ...CLI_ALLOWLIST, allowAnyNpm: isAllowAnyNpmEnabled(env) };
}

// ---------------------------------------------------------------------------
// 生产通道实现
// ---------------------------------------------------------------------------

/**
 * 生产 plugin 通道:`install`/`uninstall`/`listInstalled` 全部直接委托既有
 * `createPluginInstaller()`(任务 4.5 缺口 2:消除此前在本文件里重复的 assemble+execute)。
 * `install` 把分派器传入的 `scope` 原样转给 `createPluginInstaller().install()` 的第二个
 * 参数,由 `plugin-installer.ts` 自己完成 `-l` 后处理(见该文件设计裁决 2)。
 */
function createDefaultPluginChannel(options: {
  readonly piCli?: PiCli;
  readonly piCliFactory?: () => PiCli;
}): PluginChannel {
  const base = createPluginInstaller(options);
  return {
    async install(source, scope) {
      return base.install(source, { scope });
    },
    async uninstall(sourceId, scope) {
      void scope;
      return base.uninstall(sourceId);
    },
  };
}

/**
 * 生产 agent 通道:`install` 委托 `installAgentSource()`(4.4)。`uninstall` 委托
 * `uninstallAgentSource()`(4.5 缺口 1),把结果的 `location` 映射为端口约定的 `id` 字段。
 */
function createDefaultAgentChannel(agentInstallerOptions: AgentInstallerOptions | undefined): AgentChannel {
  return {
    async install(source) {
      if (agentInstallerOptions === undefined) {
        return {
          ok: false,
          error: {
            code: "STAGE_FAILED",
            message: "agent installer is not configured: missing sourcesRoot",
          },
        };
      }
      return installAgentSource(source, agentInstallerOptions);
    },
    async uninstall(sourceId) {
      if (agentInstallerOptions === undefined) {
        return {
          ok: false,
          error: {
            code: "NOT_CONFIGURED",
            message: "agent installer is not configured: missing sourcesRoot",
          },
        };
      }
      const res = await uninstallAgentSource(sourceId, agentInstallerOptions);
      if (!res.ok) return res;
      return { ok: true, value: { id: res.value.location } };
    },
  };
}

// ---------------------------------------------------------------------------
// kind 判定(决策 1)
// ---------------------------------------------------------------------------

function determineKind(
  resolved: Extract<ResolvedSource, { via: "direct" }>,
  kindHint: PluginKind | undefined,
): PluginKind {
  if (kindHint !== undefined) return kindHint;
  // 本地路径:resolveSource() 已读取 pi-web.json 得到真实 kind,直接信任。
  if (resolved.source.kind === "local") return resolved.kind;
  // npm/git 直连:kind 在下载前不可信(占位值),按约定默认 plugin(见决策 1)。
  return "plugin";
}

function mapResolveError(error: ResolveError): InstallerError {
  switch (error.code) {
    case "ALLOWLIST_REJECTED":
      return { code: "ALLOWLIST_REJECTED", message: error.reason };
    case "REGISTRY_NOT_IMPLEMENTED":
      return {
        code: "REGISTRY_NOT_IMPLEMENTED",
        message: `registry sources are not yet supported: ${error.spec}`,
      };
  }
}

const TRUST_HINT = (dir: string): string =>
  `Project "${dir}" is not trusted for project-scope installs. ` +
  `Run pi-web (or pi) against this directory once and accept the trust prompt, ` +
  `or use user-level scope (omit the project flag) to install without project trust.`;

/**
 * 装配 `Installer`(Req 3.1, 3.2, 3.3)。构造本身不做 IO(通道/信任策略的解析延后到
 * 各方法调用时,除非调用方显式注入替身)。
 */
export function createInstaller(options: CreateInstallerOptions = {}): Installer {
  const env = options.env ?? process.env;
  const trustPolicy = options.trustPolicy ?? makeProjectTrustPolicy();
  const agentChannel = options.agentChannel ?? createDefaultAgentChannel(options.agentInstallerOptions);
  const pluginChannel =
    options.pluginChannel ??
    createDefaultPluginChannel({ piCli: options.piCli, piCliFactory: options.piCliFactory });

  async function checkProjectTrust(cwd: string, source: string): Promise<InstallerError | undefined> {
    const decision = trustPolicy({ dir: cwd, source });
    if (decision === "always") return undefined;
    return {
      code: "PROJECT_NOT_TRUSTED",
      message: `project not trusted: ${cwd}`,
      dir: cwd,
      hint: TRUST_HINT(cwd),
    };
  }

  return {
    async install(spec, installOptions = {}) {
      const scope: Scope = installOptions.scope ?? "user";
      const cwd = installOptions.cwd ?? process.cwd();

      const allowlistConfig = options.allowlistConfig ?? buildAllowlistConfig(env);
      const resolved = await resolveSource(spec, { allowlistConfig, cwd });
      if (!resolved.ok) return { ok: false, error: mapResolveError(resolved.error) };
      if (resolved.value.via === "registry") {
        return { ok: false, error: mapResolveError({ code: "REGISTRY_NOT_IMPLEMENTED", spec: resolved.value.spec }) };
      }
      const resolvedDirect = resolved.value;

      const kind = determineKind(resolvedDirect, installOptions.kindHint);

      // component 包不走任何安装通道(spec install-host-command,任务 1.3):既不进 agent 源根,
      // 也不进 pi 的 plugin 目录。指引到组件安装器(`pi-web add`,在目标 source 目录内运行)。
      if (kind === "component") {
        return {
          ok: false,
          error: {
            code: "KIND_COMPONENT_UNSUPPORTED",
            message:
              "component packages are not supported by install/uninstall; run `pi-web add` inside the target source directory instead.",
          },
        };
      }

      if (scope === "project") {
        if (kind === "agent") {
          return {
            ok: false,
            error: {
              code: "AGENT_SCOPE_UNSUPPORTED",
              message:
                "project scope is not supported for agent sources; agent sources always install to the user-level source root (~/.pi-web/agents)",
            },
          };
        }
        const trustError = await checkProjectTrust(cwd, spec);
        if (trustError !== undefined) return { ok: false, error: trustError };
      }

      if (kind === "agent") {
        const res = await agentChannel.install(resolvedDirect.source);
        if (!res.ok) {
          return { ok: false, error: { code: "AGENT_INSTALL_FAILED", message: res.error.message } };
        }
        return { ok: true, value: { kind: "agent", result: res.value } };
      }

      const res = await pluginChannel.install(resolvedDirect.source, scope);
      if (!res.ok) {
        return { ok: false, error: { code: "PLUGIN_INSTALL_FAILED", message: res.error.message } };
      }
      return { ok: true, value: { kind: "plugin", result: res.value } };
    },

    async uninstall(id, uninstallOptions = {}) {
      const scope: Scope = uninstallOptions.scope ?? "user";
      const cwd = uninstallOptions.cwd ?? process.cwd();
      // kind 判定(缺陷修复:此前缺省一律走 plugin 通道,导致本地 agent 目录必定
      // `Not installed`)。显式 kindHint 覆盖一切;否则用只读探测
      // `isAgentSourceInstalled()` 查询这个 id 是否是 agent 通道管的已安装源 ——
      // 命中则走 agent 通道,否则默认 plugin(与安装侧 npm/git 直连的默认约定一致)。
      // 探测需要 `agentInstallerOptions`(sourcesRoot/registryPath);未配置时无从探测,
      // 保守回退默认 plugin(与此前行为一致,不引入新的不确定性)。
      const kind: PluginKind =
        uninstallOptions.kindHint ??
        (options.agentInstallerOptions !== undefined &&
        (await isAgentSourceInstalled(id, options.agentInstallerOptions)).installed
          ? "agent"
          : "plugin");

      // component 包不走任何卸载通道(spec install-host-command,任务 1.3);只有显式
      // `kindHint: "component"` 能到达这里(探测本身不产出 component)。
      if (kind === "component") {
        return {
          ok: false,
          error: {
            code: "KIND_COMPONENT_UNSUPPORTED",
            message:
              "component packages are not supported by install/uninstall; run `pi-web add` inside the target source directory instead.",
          },
        };
      }

      if (scope === "project") {
        if (kind === "agent") {
          return {
            ok: false,
            error: {
              code: "AGENT_SCOPE_UNSUPPORTED",
              message:
                "project scope is not supported for agent sources; agent sources always live in the user-level source root (~/.pi-web/agents)",
            },
          };
        }
        const trustError = await checkProjectTrust(cwd, id);
        if (trustError !== undefined) return { ok: false, error: trustError };
      }

      if (kind === "agent") {
        const res = await agentChannel.uninstall(id);
        if (!res.ok) {
          return { ok: false, error: { code: "AGENT_UNINSTALL_FAILED", message: res.error.message } };
        }
        return { ok: true, value: { kind: "agent", result: res.value } };
      }

      const res = await pluginChannel.uninstall(id, scope);
      if (!res.ok) {
        return { ok: false, error: { code: "PLUGIN_UNINSTALL_FAILED", message: res.error.message } };
      }
      return { ok: true, value: { kind: "plugin", result: res.value } };
    },
  };
}

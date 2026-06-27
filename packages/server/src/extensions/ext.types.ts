/**
 * extension-management — 本层共享类型(消费上游契约,不重定义)。
 *
 * `TrustDecision`/`TrustFragment` 与 `applyTrust` 一律从 `../agent-source/` 的 PUBLIC
 * 导出面导入(非 deep path);`AuthContext`/`RouteHandler`/`RequestContext` 取自 `../http/`;
 * `SessionManager`/`SessionStore`/`PiSession` 取自 `../session/`。
 *
 * 对外 DTO(扩展列表 / 安装请求 / 安装结果):`@blksails/pi-web-protocol` 尚未导出 extension-management
 * 的 DTO,故在此以与 protocol 一致的命名风格本地定义,并注明对齐来源(Req 1.5);一旦上游
 * 导出对应 schema,应改为从 `@blksails/pi-web-protocol` 导入并移除本地定义。命令清单 DTO 归 `http-api`
 * 的 `GET /sessions/:id/commands`,本层不定义。
 */
import type { AuthContext } from "../http/index.js";
import type {
  SessionManager,
  SessionStore,
  PiSession,
} from "../session/index.js";
import type {
  AgentMode,
  TrustDecision,
  TrustFragment,
} from "../agent-source/index.js";

export type { AgentMode, TrustDecision, TrustFragment };

/** 扩展来源类型(npm/git/local 判别)。 */
export type ExtSourceKind = "npm" | "git" | "local";

/** 扩展作用域(全局 / 项目)。 */
export type ExtScope = "global" | "project";

/**
 * 解析后的扩展来源判别联合。`source-allowlist` 把原始 `source` 字符串解析为此形状,
 * 携带已固定的版本 / ref。
 */
export type ExtSource =
  | { readonly kind: "npm"; readonly scope?: string; readonly name: string; readonly version: string }
  | { readonly kind: "git"; readonly host: string; readonly repoPath: string; readonly ref: string }
  | { readonly kind: "local"; readonly path: string };

/** 来源白名单与版本固定配置。 */
export interface AllowlistConfig {
  /** 允许的 npm scope(如 ["@pi-web","@earendil-works"])。 */
  readonly npmScopes: readonly string[];
  /** 允许的 git host(如 ["github.com"])。 */
  readonly gitHosts: readonly string[];
  /** 是否允许 `local:<path>` 源(默认仅受控环境开启)。 */
  readonly allowLocal: boolean;
  /**
   * 放宽 npm scope 白名单:开启后允许**任意** npm 包(含无 scope),
   * 但**仍要求精确版本固定**(`@x.y.z`),保留供应链防护。
   * 默认未开;供单用户自托管/管理员经 `PI_WEB_EXT_ALLOW_NPM=1` 开启。
   */
  readonly allowAnyNpm?: boolean;
}

/** 白名单 + 版本固定校验结果(纯函数产出)。 */
export type AllowlistDecision =
  | { readonly allowed: true; readonly source: ExtSource; readonly canonical: string }
  | { readonly allowed: false; readonly reason: string };

/** `pi` 命令装配结果(args + 运行 env);可日志字段不含敏感值。 */
export interface InstallArgs {
  readonly args: readonly string[];
  readonly env: Record<string, string>;
}

/** 审计记录(脱敏)。 */
export interface AuditRecord {
  /** 操作者身份(来自 AuthContext;匿名为 "anonymous")。 */
  readonly actor: string;
  /** ISO 时间戳。 */
  readonly at: string;
  /** 操作类型。 */
  readonly action: "install" | "remove";
  /** 来源标识(脱敏)。 */
  readonly source: string;
  /** 结果。 */
  readonly outcome: "success" | "failure" | "rejected";
  /** 失败 / 被拒绝原因摘要(无 env / 凭据)。 */
  readonly reason?: string;
}

/** 审计接缝(Req 8.3)。 */
export type OnAudit = (record: AuditRecord) => void;

/** 管理员判定接缝(消费 http-api 的 AuthContext,Req 7.5)。 */
export type AdminPolicy = (auth: AuthContext) => boolean;

/**
 * 会话重载接缝:重建给定会话的运行时(重启子进程 / `new_session`)。重启编排本体归
 * `session-engine`,本层仅消费此接缝触发重载(Req 4.1)。
 */
export type SessionReloader = (
  session: PiSession,
  fragment: TrustFragment,
) => Promise<void>;

/** 已安装扩展条目(对外列表 DTO,protocol 对齐)。 */
export interface InstalledExtension {
  /** 来源标识(规范化)。 */
  readonly id: string;
  readonly kind: ExtSourceKind;
  /** 版本 / ref(如有)。 */
  readonly version?: string;
  readonly scope: ExtScope;
}

/** `pi` 子进程执行结果(脱敏)。 */
export interface PiCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly exitCode: number | null;
  /** 脱敏错误摘要(无 env / 凭据)。 */
  readonly errorSummary?: string;
}

/** 唯一 IO 适配点:执行 `pi list/install/remove`。 */
export interface PiCli {
  runPiCommand(
    args: readonly string[],
    env: Record<string, string>,
    opts?: { readonly timeoutMs?: number },
  ): Promise<PiCommandResult>;
  listExtensions(): Promise<readonly InstalledExtension[]>;
}

/** `createExtensionRoutes` 装配选项。 */
export interface ExtManagementOptions {
  /** 默认 child_process 实现;测试注入替身(Req 10.5)。 */
  readonly piCli: PiCli;
  /** 会话检索(reload)。 */
  readonly store: SessionStore;
  /** 会话编排(reload 时重建)。 */
  readonly manager: SessionManager;
  /** 重载接缝;缺省走默认实现(经 manager / 通道 new_session 重建)。 */
  readonly reloadSession?: SessionReloader;
  /** 管理员判定;缺省显式默认(默认拒绝,Req 7.3)。 */
  readonly adminPolicy?: AdminPolicy;
  /** 审计接缝;缺省结构化输出(Req 8.3)。 */
  readonly onAudit?: OnAudit;
  /** 信任策略;缺省 "ask"(消费 agent-source-resolver,Req 6.6)。 */
  readonly trustPolicy?: (source: string) => TrustDecision;
  /** 来源白名单配置;缺省由实现给出受控默认。 */
  readonly allowlist?: AllowlistConfig;
  /** 子进程超时上限(毫秒,Req 9.2)。 */
  readonly piInstallTimeoutMs?: number;
}

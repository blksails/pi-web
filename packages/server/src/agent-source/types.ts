/**
 * agent-source-resolver — 共享类型与插件接口。
 *
 * `SpawnSpec` 由上游 `@blksails/pi-web-protocol`(protocol-contract)拥有,本模块经
 * `import type { SpawnSpec } from "@blksails/pi-web-protocol"` 复用,绝不在本地定义/重声明。
 * `TrustFragment`(applyTrust 的返回形状)在此定义并导出。
 */
import type { SpawnSpec } from "@blksails/pi-web-protocol";

export type { SpawnSpec };

/** agent 启动模式:存在入口文件 → custom;否则 → 通用 pi CLI。 */
export type AgentMode = "custom" | "cli";

/** 信任决策:是否信任 `.pi/` 项目资源。 */
export type TrustDecision = "always" | "never" | "ask";

/** 信任策略输入。trust 以解析后的本地工作目录 `dir`(= spawnSpec.cwd,`.pi/` 所在)为主键。 */
export interface TrustPolicyInput {
  /** 解析后的本地工作目录(绝对路径)。`.pi/` 在此目录下,trust 据此判定与记忆。 */
  dir: string;
  /** 来源标识(原始 source 或缺省 cwd),供"按来源记忆信任"的策略使用。 */
  source: string;
  /** 按请求的显式信任意图(来自建会话 DTO 的 `trust` 字段);未指定为 undefined。 */
  requestTrust?: boolean;
}

/** 信任策略:输入 → 决策。默认实现返回 "ask"(headless 安全默认)。 */
export type TrustPolicy = (input: TrustPolicyInput) => TrustDecision;

/** applyTrust 产出的信任片段,合并进 spawnSpec 的 args/env。 */
export interface TrustFragment {
  extraArgs: string[];
  extraEnv: Record<string, string>;
}

/** 解析结果四元组——本模块对外的唯一数据契约。 */
export interface ResolvedSource {
  mode: AgentMode;
  spawnSpec: SpawnSpec;
  /** 与 spawnSpec.cwd 一致。 */
  cwd: string;
  trust: TrustDecision;
}

/** 源类型识别结果。 */
export type IdentifiedSource =
  | { kind: "dir"; path: string }
  | { kind: "git"; git: GitSource }
  | { kind: "plugin"; plugin: SourceResolverPlugin; source: string }
  | { kind: "default" };

/** git 源描述(克隆 URL、固定 ref、host 与仓库路径)。 */
export interface GitSource {
  /** 传给 `git clone` 的 URL(或本地路径 remote)。 */
  url: string;
  /** 固定 ref;缺省时为 "HEAD"(远端默认分支)。 */
  ref: string;
  /** 用于派生缓存路径的 host(本地路径 remote 时为 "local")。 */
  host: string;
  /** 用于派生缓存路径的仓库路径片段。 */
  repoPath: string;
  /** 调用方未显式指定 @ref(使用远端默认分支)。 */
  refIsDefault: boolean;
}

/** 入口探测结果。 */
export type EntryProbe =
  | { kind: "entry"; path: string }
  | { kind: "none" };

/** 可插拔的源解析插件,在内置 dir/git 之外扩展源类型。 */
export interface SourceResolverPlugin {
  canHandle(source: string): boolean;
  /** 返回供探测的本地目录。 */
  resolve(source: string, opts: ResolveOptions): Promise<{ localDir: string }>;
}

/** 解析选项。 */
export interface ResolveOptions {
  /** 默认工作区(source 缺省 / 相对路径基准)。 */
  cwd?: string;
  /** → spawnSpec.env.PI_CODING_AGENT_DIR。 */
  agentDir?: string;
  /** 额外 env(如 provider key),并入 spawnSpec.env。 */
  env?: Record<string, string>;
  /** 注入的基础 env(默认 {} —— 本模块不读取 process.env)。 */
  baseEnv?: Record<string, string>;
  /** 信任策略;默认返回 "ask"(headless 安全默认)。以解析后的本地 dir 为主键。 */
  trustPolicy?: TrustPolicy;
  /** 按请求的显式信任意图(来自建会话 DTO 的 `trust`);透传给 trustPolicy.requestTrust。 */
  requestTrust?: boolean;
  /** 扩展源类型。 */
  sourceResolver?: SourceResolverPlugin;
  /** bootstrap runner 路径(custom 模式 spawnSpec 目标;本模块不提供 runner 本体)。 */
  runnerEntry?: string;
  /** pi CLI 入口(cli 模式 spawnSpec 目标)。 */
  piCliEntry?: string;
  /** git 缓存根目录(默认 ~/.pi-web/agents/git)。 */
  gitCacheRoot?: string;
  /**
   * 追加到 agent 进程 argv 末尾的额外 CLI 参数(custom 与 cli 两模式)。调用方据上层
   * 配置注入,如 `--no-skills`/`--no-extensions`(关闭系统 skills/extensions 载入)。
   * 本模块不解释其含义,仅原样透传给 assemble-spawn。
   */
  extraArgs?: readonly string[];
}

export interface AgentSourceResolver {
  resolve(source: string | undefined, opts?: ResolveOptions): Promise<ResolvedSource>;
}

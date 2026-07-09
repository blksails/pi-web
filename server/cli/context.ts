/**
 * context — 共享的运行上下文装配(spec cli-package-commands,任务 1.2,Req 3.10, 10.2)。
 *
 * 各子命令(scaffold/install/publish)不应各自读 `process.env` 解析工作目录 / pi 配置
 * 目录 / agent 源根 —— 统一从 `CliContext` 取值,便于测试注入与后续统一改约定。
 *
 * 约定对齐既有实现(不重新发明):
 * - `agentDir` 与 `packages/server/src/config/config-codec.ts` 的 `resolveDefaultRoot()`
 *   同规则:`PI_WEB_AGENT_DIR` 环境变量,未配时回落 `~/.pi/agent`。
 * - `sourcesRoot` 与 `lib/app/pi-handler.ts` 的 `defaultSourcesRoot()` 同默认值
 *   (`~/.pi-web/agents`)。该文件的 `resolveSourcesScanRoots()` 是「多根扫描」语义
 *   (`PI_WEB_SOURCES_ROOT` 用 `path.delimiter` 分隔多个、完全接管扫描列表);
 *   `CliContext.sourcesRoot` 是单个**写入目标目录**(供 `install` 落盘),取同一环境变量
 *   的第一段作为写入目标,未配时回落同一默认值 —— 不搬入多根扫描语义。
 */
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import {
  createProgressReporter,
  type ProgressReporter,
} from "./reporter.js";

export interface CliContext {
  /** 命令调用时的工作目录(绝对路径)。 */
  readonly cwd: string;
  /** pi 配置目录(`~/.pi/agent` 或 `PI_WEB_AGENT_DIR` 覆盖)。 */
  readonly agentDir: string;
  /** agent 源根的写入目标目录(`~/.pi-web/agents` 或 `PI_WEB_SOURCES_ROOT` 首段)。 */
  readonly sourcesRoot: string;
  /** 阶段性进度与脱敏错误渲染,注入而非各子命令各自 new。 */
  readonly reporter: ProgressReporter;
}

export interface CreateCliContextOptions {
  /** 调用目录(缺省 `process.cwd()`);测试注入以避免依赖真实 cwd。 */
  readonly cwd?: string;
  /** 环境变量源(缺省 `process.env`);测试注入以覆盖 `PI_WEB_*`。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 进度报告器(缺省新建一个 `console.log` 实现);测试注入以捕获输出。 */
  readonly reporter?: ProgressReporter;
}

/** 解析 pi 配置目录:`PI_WEB_AGENT_DIR` 优先,否则 `~/.pi/agent`。 */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["PI_WEB_AGENT_DIR"];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), ".pi", "agent");
}

/** agent 源根默认值(与 `lib/app/pi-handler.ts` 的 `defaultSourcesRoot()` 一致)。 */
export function defaultSourcesRoot(): string {
  return join(homedir(), ".pi-web", "agents");
}

/**
 * 解析 agent 源根的**写入目标**目录:取 `PI_WEB_SOURCES_ROOT` 按 `path.delimiter`
 * 分隔后的第一个非空段(相对路径以 `cwd` 绝对化);未配置或全为空段时回落默认值。
 */
export function resolveSourcesRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const raw = env["PI_WEB_SOURCES_ROOT"];
  if (raw !== undefined) {
    const first = raw
      .split(delimiter)
      .map((segment) => segment.trim())
      .find((segment) => segment.length > 0);
    if (first !== undefined) {
      return isAbsolute(first) ? first : resolve(cwd, first);
    }
  }
  return defaultSourcesRoot();
}

/** 子进程环境白名单:只透传子进程确需的变量,不透传调用者完整环境(Req 10.2)。 */
const CHILD_ENV_ALLOWLIST = ["PATH", "HOME"] as const;

/**
 * 构造子进程环境:仅从 `callerEnv` 摘取 {@link CHILD_ENV_ALLOWLIST} 中的变量,注入
 * 非交互兜底(`GIT_TERMINAL_PROMPT=0` / `CI=1`),再叠加调用方显式声明的 `extra`。
 *
 * 与 `packages/server/src/extensions/cli/pi-cli.ts` 内部的 `childEnv()` 同策略 ——
 * 该函数未导出(模块私有),故此处按同规则独立实现一份纯函数,而非修改该文件的导出面
 * (超出本任务边界)。见任务报告 NOTES 的选择理由。
 */
export function buildChildEnv(
  extra: Readonly<Record<string, string>> = {},
  callerEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = callerEnv[key];
    if (value !== undefined) allowed[key] = value;
  }
  return {
    ...allowed,
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    ...extra,
  };
}

/** 装配 `CliContext`:集中解析 cwd / agentDir / sourcesRoot,供子命令注入使用。 */
export function createCliContext(options: CreateCliContextOptions = {}): CliContext {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    agentDir: resolveAgentDir(env),
    sourcesRoot: resolveSourcesRoot(env, cwd),
    reporter: options.reporter ?? createProgressReporter(),
  };
}

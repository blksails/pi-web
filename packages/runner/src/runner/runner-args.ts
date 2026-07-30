/**
 * runner-args — runner 子进程的 argv 解析与 agent 命名空间推导。
 *
 * 自 `runner.ts` 原样析出(SRP:进程引导不该同时承担参数解析)。行为逐字保持,
 * `runner.ts` 继续 re-export 这三个符号,既有 import 路径零改动。
 */

/** Parsed runner CLI arguments. */
export interface RunnerArgs {
  agent: string;
  cwd: string;
  agentDir?: string;
  /** External trust decision (default: untrusted). */
  trusted: boolean;
  /**
   * Explicit session id. Mirrors pi CLI semantics (main.js:255-261): if a session
   * with this id already exists it is opened (history loaded); otherwise a new
   * session is created with this id — aligning the persisted file id with the
   * host's sessionId for URL-based resume.
   */
  sessionId?: string;
  /** Model id recorded into the piweb.session creation metadata. */
  model?: string;
  /** Agent source recorded into the piweb.session creation metadata (for cold resume). */
  sourceMeta?: string;
  /**
   * `--no-skills`:`true` → 不载入系统/包/内置 skills(对齐 pi CLI `--no-skills`)。
   * `undefined`(未传)→ 按默认载入。`--no-skills=false` → 显式开启(`false`)。
   */
  noSkills?: boolean;
  /**
   * `--no-extensions`:`true` → 不载入系统/包 extensions(经强制注入路径提供的扩展
   * 如 pi-sandbox 仍加载)。语义与 `noSkills` 对称,二者相互独立。
   */
  noExtensions?: boolean;
  /**
   * 无法识别的 `--` 前缀参数名(不含 `=value`),仅在非空时出现。
   *
   * ★ 解析器**刻意不因未知参数报错**:runner 的调用方(主进程装配、烘焙镜像的
   * `AGENT_CMD`、沙箱编排)可能比 runner 新,拒绝未知参数会让升级顺序变成硬约束。
   * 但**静默吞掉**同样有害 —— 拼错的开关(如 `--no-skill` 少个 s)会无声退回默认行为,
   * 零诊断(`--no-skills` 曾被丢过一次,正是这个形态)。折中:照常解析,把未识别项
   * 带出来交给调用方记一条 warn。
   */
  unknownArgs?: readonly string[];
}

/** Raised for missing/invalid CLI arguments. */
export class RunnerArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerArgsError";
  }
}

/**
 * Parse runner argv (the portion after `node script.js`). Recognizes
 * `--agent`, `--cwd`, `--agent-dir`, `--trusted`, `--session-id`, `--model`,
 * `--source-meta`. Throws {@link RunnerArgsError} when `--agent` is missing.
 */
export function parseRunnerArgs(argv: readonly string[]): RunnerArgs {
  let agent: string | undefined;
  let cwd: string | undefined;
  let agentDir: string | undefined;
  let trusted = false;
  let sessionId: string | undefined;
  let model: string | undefined;
  let sourceMeta: string | undefined;
  let noSkills: boolean | undefined;
  let noExtensions: boolean | undefined;
  const unknownArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (name: string): string => {
      const eq = arg!.indexOf("=");
      if (eq !== -1) return arg!.slice(eq + 1);
      const next = argv[i + 1];
      if (next === undefined) {
        throw new RunnerArgsError(`Missing value for ${name}`);
      }
      i++;
      return next;
    };
    if (arg === "--agent" || arg!.startsWith("--agent=")) {
      agent = takeValue("--agent");
    } else if (arg === "--cwd" || arg!.startsWith("--cwd=")) {
      cwd = takeValue("--cwd");
    } else if (arg === "--agent-dir" || arg!.startsWith("--agent-dir=")) {
      agentDir = takeValue("--agent-dir");
    } else if (arg === "--session-id" || arg!.startsWith("--session-id=")) {
      sessionId = takeValue("--session-id");
    } else if (arg === "--model" || arg!.startsWith("--model=")) {
      model = takeValue("--model");
    } else if (arg === "--source-meta" || arg!.startsWith("--source-meta=")) {
      sourceMeta = takeValue("--source-meta");
    } else if (arg === "--trusted" || arg!.startsWith("--trusted=")) {
      if (arg === "--trusted") {
        trusted = true;
      } else {
        trusted = takeValue("--trusted") !== "false";
      }
    } else if (arg === "--no-skills" || arg!.startsWith("--no-skills=")) {
      // 系统资源开关:裸 flag → true(关闭);`=false` → 显式开启。与 `--trusted` 同款。
      noSkills = arg === "--no-skills" ? true : takeValue("--no-skills") !== "false";
    } else if (arg === "--no-extensions" || arg!.startsWith("--no-extensions=")) {
      noExtensions =
        arg === "--no-extensions" ? true : takeValue("--no-extensions") !== "false";
    } else if (arg!.startsWith("--")) {
      // 未识别的开关:登记但不抛(见 `RunnerArgs.unknownArgs` 的说明)。取 `=` 之前的
      // 名字,避免把值(可能含路径/凭据)带进诊断输出。
      const eq = arg!.indexOf("=");
      unknownArgs.push(eq === -1 ? arg! : arg!.slice(0, eq));
    }
  }

  if (agent === undefined || agent === "") {
    throw new RunnerArgsError("Missing required argument: --agent <entry path>");
  }

  const resolvedCwd = cwd ?? process.cwd();
  const result: RunnerArgs = { agent, cwd: resolvedCwd, trusted };
  if (agentDir !== undefined) result.agentDir = agentDir;
  if (sessionId !== undefined) result.sessionId = sessionId;
  if (model !== undefined) result.model = model;
  if (sourceMeta !== undefined) result.sourceMeta = sourceMeta;
  if (noSkills !== undefined) result.noSkills = noSkills;
  if (noExtensions !== undefined) result.noExtensions = noExtensions;
  // 仅在有未识别项时出现,使既有「全字段相等」的断言与调用方零感知。
  if (unknownArgs.length > 0) result.unknownArgs = unknownArgs;
  return result;
}

/**
 * Generic entry-point basenames that should fall back to parent directory name.
 * Extend this set when additional conventional entry names are found in the wild.
 */
const GENERIC_ENTRY_NAMES = new Set(["index", "main", "mod", "entry"]);

/**
 * Derive the logger namespace for a runner agent from its entry-file path.
 *
 * Rules (in priority order):
 * 1. Strip the file extension from the basename.
 * 2. If that basename is a generic entry name (index, main, mod, entry …),
 *    fall back to the **parent directory** name.
 * 3. If the result is still empty, fall back to the literal string "agent".
 * 4. The returned value is always prefixed with "agent:".
 *
 * @example
 *   deriveAgentNamespace("./examples/logging-demo-agent/index.ts")
 *   // → "agent:logging-demo-agent"
 *   deriveAgentNamespace("/path/to/my-agent.ts")
 *   // → "agent:my-agent"
 */
export function deriveAgentNamespace(agentPath: string): string {
  // Normalise separators so we can use a single split strategy.
  const normalised = agentPath.replace(/\\/g, "/");
  const parts = normalised.split("/").filter((p) => p !== "");

  // basename without extension (last non-empty segment).
  const rawBasename = parts[parts.length - 1] ?? "";
  const basename = rawBasename.replace(/\.[^.]+$/, "");

  let name: string;
  if (GENERIC_ENTRY_NAMES.has(basename) || basename === "") {
    // Fall back to parent directory name.
    name = parts[parts.length - 2] ?? "";
  } else {
    name = basename;
  }

  return `agent:${name || "agent"}`;
}

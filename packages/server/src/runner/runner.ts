/**
 * Bootstrap runner subprocess entry.
 *
 * Parses `--agent` (required), `--cwd` and optional `--agent-dir`, normalizes
 * the user entry into a runtime factory (agent-loader), builds the runtime via
 * `createAgentSessionRuntime`, and enters standard RPC mode with `runRpcMode`.
 *
 * Isolation: this file is the *only* process entry; user code is executed only
 * here (in the spawned subprocess), never inside the pi-web backend process.
 *
 * Launch (example):
 *   node --import jiti/register packages/server/src/runner/runner.ts \
 *     --agent <entry> --cwd <work> [--agent-dir <dir>]
 */
import {
  createAgentSessionRuntime,
  getAgentDir,
  runRpcMode,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createLogger, initConfigFromEnv } from "@blksails/pi-web-logger";
import type { AgentContext } from "./agent-definition.js";
import { wireCommandMarkerPersistence } from "./command-marker.js";
import { loadAgentDefinition } from "./agent-loader.js";
import { makeResolveProjectTrust } from "./project-trust.js";
import {
  createSessionEntryStore,
  mirrorSessionManagerToStore,
  sessionStoreConfigFromEnv,
} from "../session-store/index.js";
import { wireAttachmentBridge } from "./attachment-wiring.js";
import { wireSessionTitlePersistence } from "./session-title-wiring.js";

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

/**
 * Build the runtime and enter RPC mode. Returns the (never-resolving) promise
 * from `runRpcMode`. Separated from {@link main} for testability.
 */
export async function startRunner(args: RunnerArgs): Promise<never> {
  // Populate the globalThis.__PI_WEB_FS__ seam used by @blksails/pi-web-logger's file-sink.
  // file-sink.ts itself contains zero built-in specifier references (R1.6); instead
  // it reads fs from this seam which is filled here, in the Node-only runner, before
  // any logger call so file output is ready from the first log line.
  {
    const _fs = await import("node:fs");
    (globalThis as Record<string, unknown>)["__PI_WEB_FS__"] ??=
      (_fs as { default?: unknown }).default ?? _fs;
  }

  // Apply logger configuration from environment variables (including file output).
  // Must be called before any logger is created so config is in place.
  initConfigFromEnv();

  const agentDir = args.agentDir ?? getAgentDir();
  // Derive a namespace from the agent path. Generic entry names (index, main …)
  // fall back to the parent directory name so `logging-demo-agent/index.ts`
  // gets namespace `agent:logging-demo-agent` instead of `agent:index`.
  const agentNamespace = deriveAgentNamespace(args.agent);
  const ctx: AgentContext = {
    cwd: args.cwd,
    agentDir,
    env: process.env,
    logger: createLogger({ namespace: agentNamespace }),
  };

  // 信任来源:`--trusted` CLI 参数,或 custom 模式经 spawnSpec.env 注入的
  // PI_WEB_TRUST_PROJECT=1(agent-source/trust-apply 的 custom + always 信号)。
  // 二者任一为真即放行项目级 `.pi/`(extensions/agents/skills)。
  const trusted = args.trusted || process.env.PI_WEB_TRUST_PROJECT === "1";
  const trust = makeResolveProjectTrust(trusted);
  // 「扩展 → 系统资源」开关透传:custom 模式(shape a/b)据此清空 skills / 关闭系统 extensions。
  const factory = await loadAgentDefinition(args.agent, ctx, trust, {
    ...(args.noSkills !== undefined ? { noSkills: args.noSkills } : {}),
    ...(args.noExtensions !== undefined ? { noExtensions: args.noExtensions } : {}),
  });

  // open-or-create by id(对齐 pi CLI main.js:255-261):给定 --session-id 时,若该 id 的
  // 会话文件已存在则 open 加载历史(恢复),否则以该 id 新建——使持久化文件 id 与主进程
  // sessionId 对齐,支撑 URL 冷恢复。未给 id 则保持既有行为(随机新建)。
  let sessionManager: SessionManager;
  let isNewSession = true;
  if (args.sessionId !== undefined) {
    const existing = (await SessionManager.list(args.cwd)).find(
      (s) => s.id === args.sessionId,
    );
    if (existing !== undefined) {
      sessionManager = SessionManager.open(existing.path, undefined, args.cwd);
      isNewSession = false;
    } else {
      sessionManager = SessionManager.create(args.cwd, undefined, {
        id: args.sessionId,
      });
    }
  } else {
    sessionManager = SessionManager.create(args.cwd);
  }

  // 可选:把会话镜像到配置的 SessionEntryStore(sqlite/postgres)。fs 由 pi 原生负责,
  // 不镜像(否则双写同一文件)。镜像是 best-effort 旁路,初始化失败不影响 agent。
  const storeConfig = sessionStoreConfigFromEnv();
  if (storeConfig.kind !== "fs") {
    try {
      const store = await createSessionEntryStore(storeConfig);
      await mirrorSessionManagerToStore(sessionManager, store, (err) =>
        process.stderr.write(`runner: session-store mirror error: ${String(err)}\n`),
      );
    } catch (err) {
      process.stderr.write(
        `runner: failed to init session store (${storeConfig.kind}): ${String(err)}\n`,
      );
    }
  }

  // 仅新建会话时写入 pi-web 创建元数据(source/cwd/model),供主进程冷恢复读取(custom 模式)。
  // 放在 mirror 装配之后,使 sqlite/postgres 后端也镜像到这条 custom entry;fs 由 pi 原生写。
  if (isNewSession) {
    try {
      sessionManager.appendCustomEntry("piweb.session", {
        source: args.sourceMeta,
        cwd: args.cwd,
        ...(args.model !== undefined ? { model: args.model } : {}),
      });
    } catch (err) {
      process.stderr.write(
        `runner: failed to write piweb.session metadata: ${String(err)}\n`,
      );
    }
  }

  const runtime = await createAgentSessionRuntime(factory, {
    cwd: args.cwd,
    agentDir,
    sessionManager,
  });

  // attachment-tool-bridge 装配(task 5.1):实例化子进程 store、把属主校验闸门接到
  // 执行前 hook、把 base64 剥离闸门接到结果出口 hook、把 tool 接入上下文经 globalThis seam
  // 透给运行在本子进程的 customTools;store env 缺失时优雅降级(闸门 fail-closed / ctx
  // available:false),不崩溃。env 由 attachment-store 经 spawn env 下发(DIR + SECRET)。
  const attachmentWiring = wireAttachmentBridge(runtime, {
    env: process.env,
    sessionId: runtime.session.sessionId,
  });

  // 标题持久化(spec auto-session-title, Req 8):包装 uiContext.setTitle,使经 ctx.ui.setTitle
  // 设置的标题在原展示(ambient.title 帧)之外,持久化为会话名(appendSessionInfo)→ 经既有镜像
  // 落 store + pi 原生 fs,使会话历史显示标题并冷恢复后保留。best-effort,失败不阻塞会话。
  //
  // 取**当前被绑定 session 的** sessionManager(而非启动时捕获的 `sessionManager` 变量):
  // 进程内 `new_session`/`switchSession`/`fork` 会换新 SessionManager(新会话 id/文件),
  // 必须按 bind 时的 session 取,标题才写进**当前**会话(否则写回旧会话,新会话无名)。
  wireSessionTitlePersistence(runtime, (title, boundSession) => {
    const sm = (boundSession as { sessionManager?: SessionManager } | null)?.sessionManager;
    (sm ?? sessionManager).appendSessionInfo(title);
  });

  // 会话生命周期结束(子进程终止)→ 触发会话级临时文件回收 + 清理 seam(Req 2.3)。
  // runRpcMode 自身在 SIGTERM / stdin end 时 dispose 运行时并 process.exit;本回收作为
  // 旁路 best-effort 在同样的终止信号上触发(幂等、吞错不抛,不阻断 rpc-mode 收尾)。
  const runSessionCleanup = (): void => {
    void attachmentWiring.cleanup().catch((err) => {
      process.stderr.write(
        `runner: attachment session cleanup error: ${String(err)}\n`,
      );
    });
  };
  process.once("SIGTERM", runSessionCleanup);
  process.once("SIGINT", runSessionCleanup);
  process.once("beforeExit", runSessionCleanup);

  // 纯扩展命令历史持久化(spec plugin-system-unification R13):在进入 SDK 拥有的 RPC 循环前
  // 包裹 session.prompt——纯命令(handler 跑完不留 message、不进 streaming)经 appendCustomEntry
  // 持久化 LLM-clean 的 piweb.command 标记,服务端 GET /messages 据此合并 surfacing,使冷恢复
  // 仍见 /review 气泡。best-effort:包裹失败不阻断会话启动。
  try {
    wireCommandMarkerPersistence(runtime.session, sessionManager);
  } catch (err) {
    process.stderr.write(
      `runner: failed to wire command marker persistence: ${String(err)}\n`,
    );
  }

  return runRpcMode(runtime);
}

/** Process entry: parse argv, start the runner, surface fatal errors. */
export async function main(argv: readonly string[]): Promise<void> {
  let args: RunnerArgs;
  try {
    args = parseRunnerArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`runner: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    await startRunner(args);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`runner: failed to start: ${message}\n`);
    process.exitCode = 1;
  }
}

// Execute when run as the process entry (not when imported by tests).
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main(process.argv.slice(2));
}

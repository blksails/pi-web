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
  initTheme,
  runRpcMode,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createLogger, initConfigFromEnv } from "@blksails/pi-web-logger";
import type { AgentContext } from "./agent-definition.js";
import { InvalidAgentDefinitionError, loadAgentDefinition } from "./agent-loader.js";
import { emitSlashCompletions } from "./slash-completions-wiring.js";
import {
  emitAttachmentProfile,
  isAttachmentProfileDisabled,
} from "./attachment-profile-wiring.js";
import { makeResolveProjectTrust } from "./project-trust.js";
import {
  createSessionEntryStore,
  mirrorSessionManagerToStore,
  sessionStoreConfigFromEnv,
} from "../session-store/index.js";
import { ATTACHMENT_BACKENDS_ENV, parseBackendsEnv } from "../attachment/backends-config.js";
import { wireAttachmentBridge } from "./attachment-wiring.js";
import { wireSessionTitlePersistence } from "./session-title-wiring.js";
import { wireStateBridge } from "./state-wiring.js";
import { wireSurfaceBridge } from "./surface-wiring.js";
import { wireClearQueueBridge } from "./clear-queue-wiring.js";
import { wireAgentRoutesBridge } from "./agent-routes-wiring.js";
import { wireAttachmentCatalogBridge } from "./attachment-catalog-wiring.js";

// runner 自身启动生命周期日志(命名空间 runner:boot)。走 stderr(nodeSink 默认),
// 绝不写 stdout —— 主 stdout 是 RPC 协议帧通道。与下方注入 agent 的 ctx.logger
// (命名空间=agent 目录名)互不相干。config 在 emit 时惰性读取,故模块顶层创建安全:
// initConfigFromEnv() 在 startRunner 内先跑,门控在首次日志调用时才生效。
const bootLog = createLogger({ namespace: "runner:boot" });

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
 * 装配期白名单校验(spec agent-attachment-profile,任务 3.1;Req 2.1/2.2/5.1)。
 *
 * 权威在子进程:definition(`factory.attachmentProfile`)与拓扑 env 都在子进程手里。
 * 校验顺序(design.md §行为规约):
 *  1. 关断(`PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED === "1"`)生效 → 视同未声明,直接放行
 *     (不校验、后续 wiring 也不覆盖写路由/不发帧);
 *  2. 未声明 `attachmentProfile` → 放行(existing agents 零行为变化,Req 1.2);
 *  3. 声明存在且未关断 → 对照 `parseBackendsEnv(env)` 的具名后端集合校验:未命中(**含宿主
 *     未声明任何拓扑,即 `parseBackendsEnv` 返回 `undefined` 的情形**)→ 抛
 *     {@link InvalidAgentDefinitionError}(message 含该 profile 名与已注册名字集),经
 *     `startRunner` 冒泡 → 进程 ready 前退出(exit-before-ready 失败链,复用既有机制,不新增
 *     握手语义)。
 *
 * 导出为独立纯函数(签名仅吃 `profile`/`env`/`agentPath`)以便直接单测,不需要拉起完整
 * `startRunner`/子进程(与 `agent-loader-routes.test.ts` 的隔离粒度一致)。
 */
export function validateAttachmentProfileWhitelist(
  profile: string | undefined,
  env: NodeJS.ProcessEnv,
  agentPath: string,
): void {
  if (isAttachmentProfileDisabled(env)) return; // 关断优先于一切(Req 5.1)。
  if (profile === undefined) return; // 未声明 → 现状零行为变化(Req 1.2)。

  const topology = parseBackendsEnv(env[ATTACHMENT_BACKENDS_ENV]);
  const known = topology?.backends.map((b) => b.name) ?? [];
  if (!known.includes(profile)) {
    const registered =
      known.length > 0
        ? known.join(", ")
        : "(no PI_WEB_ATTACHMENT_BACKENDS topology configured on this host)";
    throw new InvalidAgentDefinitionError(
      agentPath,
      `attachmentProfile "${profile}" is not among the host's registered backend names: ${registered}`,
    );
  }
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

  bootLog.info("runner boot", {
    agent: args.agent,
    cwd: args.cwd,
    trusted: args.trusted,
    ...(args.model !== undefined ? { model: args.model } : {}),
  });

  // RPC 模式(headless)下 pi SDK 从不调用 initTheme,而 ctx.ui.theme 仍是读 globalThis
  // 主题单例的 Proxy —— 任何扩展调用 `ctx.ui.theme.fg(...)`(如 npm:pi-sandbox 在
  // session_start 给状态栏上色)都会抛 "Theme not initialized. Call initTheme() first.",
  // 被扩展 catch 后误报成 "Sandbox initialization failed: …" 红色 toast(沙箱其实已初始化)。
  // 在任何会话/扩展 hook 之前补一次默认主题初始化(不开文件 watcher),消除该硬依赖崩点。
  // ANSI 着色字符串在 web 端不显示,主题取默认即可;失败内部回退 dark,best-effort 不抛。
  initTheme(undefined, false);

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

  // agent-attachment-profile:装配期白名单校验(Req 2.1/2.2/5.1)。权威在子进程——definition
  // 与拓扑 env 都在这里。未命中(含宿主未声明任何拓扑)抛 InvalidAgentDefinitionError,冒泡到
  // main() 的 catch → 非零 exitCode → 进程在 ready 前退出,复用既有 exit-before-ready 失败链
  // (不新增握手语义)。关断优先于校验(disabled → 视同未声明,不抛)。
  const attachmentProfileDisabled = isAttachmentProfileDisabled(process.env);
  validateAttachmentProfileWhitelist(
    factory.attachmentProfile,
    process.env,
    args.agent,
  );

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
  bootLog.debug("runtime built");

  // attachment-tool-bridge 装配(task 5.1):实例化子进程 store、把属主校验闸门接到
  // 执行前 hook、把 base64 剥离闸门接到结果出口 hook、把 tool 接入上下文经 globalThis seam
  // 透给运行在本子进程的 customTools;store env 缺失时优雅降级(闸门 fail-closed / ctx
  // available:false),不崩溃。env 由 attachment-store 经 spawn env 下发(DIR + SECRET)。
  // writeProfile:白名单校验已通过(或关断/未声明为 undefined)的 profile 名,静态覆盖写路由
  // (agent-attachment-profile spec,Req 3.2)。
  const effectiveWriteProfile = attachmentProfileDisabled
    ? undefined
    : factory.attachmentProfile;
  const attachmentWiring = wireAttachmentBridge(runtime, {
    env: process.env,
    sessionId: runtime.session.sessionId,
    writeProfile: effectiveWriteProfile,
  });
  bootLog.debug("attachment wiring", { available: attachmentWiring.available });

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

  // 状态注入桥(state-injection-bridge)装配:建子进程权威 KV、挂 globalThis seam(供作者工具经
  // getSessionState 读写)、订阅变更→stdout 下行帧、在 runRpcMode 之前给 stdin 挂第二个读取器接写回。
  // 失败优雅降级(内部吞错),不阻断会话启动。
  const stateWiring = wireStateBridge(runtime, {
    sessionId: runtime.session.sessionId,
  });

  // agent 权威 surface(agent-authoritative-surface)桥:补齐 state-injection-bridge 留下的
  // 「ui-rpc 命令真实接收方」缺口——在 runRpcMode 之前给 stdin 挂第二个读取器,截获转发进子进程的
  // surface 命令行(point=command/action=execute + SurfaceCommandPayload),按 domain 派发进程内
  // surface 注册表,经 fd1 直写回流 ui_rpc_response。非 surface 行放行;无注册惰性 no-op。
  // 装配序:wireStateBridge 之后、runRpcMode 之前(命令内 ctx.setState 复用 wireStateBridge 的下行)。
  const surfaceWiring = wireSurfaceBridge(runtime, {
    sessionId: runtime.session.sessionId,
  });

  // message-queue-ui「取回」桥(clearQueue):在 runRpcMode 之前给 stdin 挂第二个读取器,
  // 截获 server 下发的 piweb_clear_queue 请求行 → 调当前 session.clearQueue() → 写回结果行。
  // 优雅降级(内部吞错),不阻断会话启动。
  const clearQueueWiring = wireClearQueueBridge(runtime, {
    sessionId: runtime.session.sessionId,
  });

  // agent-declared-routes 分发桥:装配期 routes 非空则经 stdout 发一条 agent_routes 声明帧
  // (纯数据投影,handler 不出进程),并在 runRpcMode 之前给 stdin 挂第二个读取器,只消费
  // piweb_agent_route_request 请求帧 → 进程内 registry 派发 handler → fd1 直写结果帧。
  // 空声明零帧零读取器(存量 source 零行为变化)。装配序:state/surface/clearQueue 之后、
  // runRpcMode 之前。优雅降级(内部吞错),不阻断会话启动。
  const agentRoutesWiring = wireAgentRoutesBridge({
    sessionId: runtime.session.sessionId,
    routes: factory.routes,
  });

  // agent-attachment-catalog 分发桥:装配期声明存在则经 stdout 发一条 agent_attachment_catalog
  // 声明帧,并在 runRpcMode 之前给 stdin 挂第三个读取器,只消费 piweb_attachment_catalog_request
  // 请求帧 → list 派发到 agent handler / materialize 走幂等物化通路(经 attachmentWiring.store
  // 落库,继承拓扑/profile 写路由)→ fd1 直写结果帧。无声明零帧零读取器(存量 source 零行为变化)。
  // 装配序:agent-routes 之后、runRpcMode 之前。优雅降级(内部吞错),不阻断会话启动。
  const attachmentCatalogWiring = wireAttachmentCatalogBridge({
    sessionId: runtime.session.sessionId,
    catalog: factory.attachmentCatalog,
    store: attachmentWiring.store,
  });

  // agent-slash-completion:把 agent 声明的静态 slash 补全候选经 stdout 帧推给 server
  // 主进程(在 runRpcMode 接管 stdout 之前)。无声明则不发帧,会话行为不变。
  emitSlashCompletions(factory);

  // agent-attachment-profile:装配期单帧发射(slash_completions 同族),关断或未声明 → 零帧
  // (Req 2.3/5.1)。已通过白名单校验(disabled 时视同未声明,attachmentProfileDisabled 门控)。
  emitAttachmentProfile(factory, attachmentProfileDisabled);

  bootLog.info("entering rpc mode");

  // 会话生命周期结束(子进程终止)→ 触发会话级临时文件回收 + 清理 seam(Req 2.3)。
  // runRpcMode 自身在 SIGTERM / stdin end 时 dispose 运行时并 process.exit;本回收作为
  // 旁路 best-effort 在同样的终止信号上触发(幂等、吞错不抛,不阻断 rpc-mode 收尾)。
  const runSessionCleanup = (): void => {
    bootLog.debug("runner cleanup");
    void attachmentWiring.cleanup().catch((err) => {
      process.stderr.write(
        `runner: attachment session cleanup error: ${String(err)}\n`,
      );
    });
    try {
      stateWiring.cleanup();
    } catch (err) {
      process.stderr.write(
        `runner: state-bridge session cleanup error: ${String(err)}\n`,
      );
    }
    try {
      surfaceWiring.cleanup();
    } catch (err) {
      process.stderr.write(
        `runner: surface bridge session cleanup error: ${String(err)}\n`,
      );
    }
    try {
      clearQueueWiring.cleanup();
    } catch (err) {
      process.stderr.write(
        `runner: clear-queue bridge session cleanup error: ${String(err)}\n`,
      );
    }
    try {
      agentRoutesWiring.cleanup();
    } catch (err) {
      process.stderr.write(
        `runner: agent-routes bridge session cleanup error: ${String(err)}\n`,
      );
    }
    try {
      attachmentCatalogWiring.cleanup();
    } catch (err) {
      process.stderr.write(
        `runner: attachment-catalog bridge session cleanup error: ${String(err)}\n`,
      );
    }
  };
  process.once("SIGTERM", runSessionCleanup);
  process.once("SIGINT", runSessionCleanup);
  process.once("beforeExit", runSessionCleanup);

  return runRpcMode(runtime);
}

/** Process entry: parse argv, start the runner, surface fatal errors. */
export async function main(argv: readonly string[]): Promise<void> {
  let args: RunnerArgs;
  try {
    args = parseRunnerArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootLog.error("runner fatal", { message });
    process.stderr.write(`runner: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    await startRunner(args);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    bootLog.error("runner fatal", { message });
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

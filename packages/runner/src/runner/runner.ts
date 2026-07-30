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
 *   node --import jiti/register packages/runner/src/runner/runner.ts \
 *     --agent <entry> --cwd <work> [--agent-dir <dir>]
 */
import {
  createAgentSessionRuntime,
  getAgentDir,
  initTheme,
  runRpcMode,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { pathToFileURL } from "node:url";
import { createLogger, initConfigFromEnv } from "@blksails/pi-web-logger";
import type { AgentContext } from "@blksails/pi-web-core/agent-definition.js";
import { InvalidAgentDefinitionError, loadAgentDefinition } from "./agent-loader.js";
import { emitSlashCompletions } from "./slash-completions-wiring.js";
import {
  emitAttachmentProfile,
  isAttachmentProfileDisabled,
} from "./attachment-profile-wiring.js";
import { makeResolveProjectTrust } from "./project-trust.js";
import { resolveAssemblySourceSettings } from "./source-settings-assembly-wiring.js";
import {
  mirrorSessionManagerToStore,
  sessionStoreConfigFromEnv,
} from "@blksails/pi-web-core/session-store/index.js";
import { ATTACHMENT_BACKENDS_ENV, parseBackendsEnv } from "@blksails/pi-web-core/attachment/backends-config.js";
import { wireSessionTitlePersistence } from "./session-title-wiring.js";
import { createInboundFrameRouter, disposeAll } from "./frame-channel/index.js";
import { openOrCreateSession } from "./open-or-create-session.js";
import { wireSessionBridges } from "./session-bridges.js";
import {
  deriveAgentNamespace,
  parseRunnerArgs,
  RunnerArgsError,
  type RunnerArgs,
} from "./runner-args.js";

// argv 解析与命名空间推导已析出至 `runner-args.ts`(SRP);此处原样再导出,
// 使既有 `from ".../runner.js"` 的 import 路径零改动。
export { deriveAgentNamespace, parseRunnerArgs, RunnerArgsError };
export type { RunnerArgs };

// runner 自身启动生命周期日志(命名空间 runner:boot)。走 stderr(nodeSink 默认),
// 绝不写 stdout —— 主 stdout 是 RPC 协议帧通道。与下方注入 agent 的 ctx.logger
// (命名空间=agent 目录名)互不相干。config 在 emit 时惰性读取,故模块顶层创建安全:
// initConfigFromEnv() 在 startRunner 内先跑,门控在首次日志调用时才生效。
const bootLog = createLogger({ namespace: "runner:boot" });

/**
 * 装配期「降级但不致命」的失败出口。
 *
 * ★ 两处都写,缺一不可:
 *  - `bootLog` 受日志门控,开启时进文件 sink —— 事后排查线上问题只能靠它;
 *  - `stderr` 无条件可见 —— 日志**默认关闭**,不写 stderr 就等于这条失败从未发生过。
 *
 * 改造前 session-store 与 piweb.session 两处只写 stderr,恰恰是「进不了日志文件」的
 * 那两条;而其余装配失败只走 bootLog,又是「默认配置下看不见」的那些。统一到此。
 */
function reportBootFailure(what: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  bootLog.error(what, { message });
  process.stderr.write(`runner: ${what}: ${message}\n`);
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

  // 未识别的 CLI 开关:解析器刻意放行(调用方可能比 runner 新),但必须可见 ——
  // 静默吞掉会让拼错的开关无声退回默认行为。同时写 stderr,因为日志默认关闭时
  // bootLog 不产生任何输出,而这条恰恰是「我明明传了参数却没生效」的唯一线索。
  if (args.unknownArgs !== undefined) {
    const names = args.unknownArgs.join(", ");
    bootLog.warn("unrecognized runner arguments (ignored)", { args: args.unknownArgs });
    process.stderr.write(`runner: unrecognized arguments ignored: ${names}\n`);
  }

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

  // 信任来源:`--trusted` CLI 参数,或 custom 模式经 spawnSpec.env 注入的
  // PI_WEB_TRUST_PROJECT=1(agent-source/trust-apply 的 custom + always 信号)。
  // 二者任一为真即放行项目级 `.pi/`(extensions/agents/skills)。提到 ctx 构造之前算好,
  // 因为 per-source settings 的 scope:"project" 注入(下方)复用同一信任判定作门控。
  const trusted = args.trusted || process.env.PI_WEB_TRUST_PROJECT === "1";
  const trust = makeResolveProjectTrust(trusted);

  // per-source settings 装配期注入(spec: source-settings-and-slots,任务 3.1,通道 a,
  // Req 4.1-4.5):best-effort 读取该 source 已保存的设置值,失败/未声明一律降级 `{}`,
  // 与 option-mapper.ts 装配期读 auth.json 的先例同法,不阻断装配。
  const settings = await resolveAssemblySourceSettings({
    agentPath: args.agent,
    cwd: args.cwd,
    agentDir,
    trusted,
  });

  const ctx: AgentContext = {
    cwd: args.cwd,
    agentDir,
    env: process.env,
    settings,
    logger: createLogger({ namespace: agentNamespace }),
  };
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

  // 会话打开或新建(open-or-create by id);纯逻辑见 open-or-create-session。
  // 沙盒模式(spec sandbox-baked-agent-image)兜底:烘焙镜像的 AGENT_CMD 定死于构建期,
  // per-session 的 --session-id 塞不进 argv,改经 configure→子进程 env 下发 PI_WEB_SESSION_ID;
  // argv 优先(本地模式零变化),env 兜底使沙盒内会话身份与宿主对齐(附件属主校验依赖)。
  const sessionId = args.sessionId ?? process.env["PI_WEB_SESSION_ID"];
  const { sessionManager, isNewSession } = await openOrCreateSession(
    args.cwd,
    sessionId,
  );

  // 可选:把会话镜像到配置的 SessionEntryStore(sqlite/postgres)。fs 由 pi 原生负责,
  // 不镜像(否则双写同一文件)。镜像是 best-effort 旁路,初始化失败不影响 agent。
  const storeConfig = sessionStoreConfigFromEnv();
  if (storeConfig.kind !== "fs") {
    try {
      // ★ 动态 import 取装配缝:store 的**选型工厂**属 adapters,与 runner 同层,
      //   静态 import 就是一条反向依赖(守卫会拦)。同 model-sources 的处理。
      // ★ 拆包后写成包级 specifier:兼容层**不在**本包的依赖声明里(那会是一条反向的
      //   包依赖),由宿主在运行期提供 —— 见 composeModelSources 的长注释。
      const { createSessionEntryStore } = await import(
        "@blksails/pi-web-server/host-assembly/session-store.js"
      );
      const store = await createSessionEntryStore(storeConfig);
      await mirrorSessionManagerToStore(sessionManager, store, (err) =>
        reportBootFailure("session-store mirror error", err),
      );
    } catch (err) {
      reportBootFailure(`failed to init session store (${storeConfig.kind})`, err);
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
      reportBootFailure("failed to write piweb.session metadata", err);
    }
  }

  const runtime = await createAgentSessionRuntime(factory, {
    cwd: args.cwd,
    agentDir,
    sessionManager,
  });
  bootLog.debug("runtime built");

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

  // 父子 IPC 帧通道(runner-frame-channel):server(父)↔ runner(子)之间的单一入站帧通道。
  // 对 process.stdin **只挂一个** data 读取器、**只维护一个** JsonlLineReader,按 frame.type 分发到
  // 下方各桥注册的 handler;未注册 / 非 JSON / schema 失败的行放行(pi 的 runRpcMode 读取器独立处理)。
  // 上行帧经通道统一 fd1 writer 直写(绕 takeOverStdout)。在 runRpcMode **之前**创建并完成所有 register。
  const frameChannel = createInboundFrameRouter({
    sessionId: runtime.session.sessionId,
  });

  // 会话桥装配:清单与顺序语义见 `session-bridges.ts`(attachment → state → surface →
  // clear-queue → agent-routes → attachment-catalog)。各桥内部实现未变,此处只是把
  // 「逐个手工接线 + 手工维护 dispose 数组」换成按单一清单遍历 —— 新增桥只改清单一处。
  // 单桥装配抛错不阻断其余(与各 wiring 既有的优雅降级语义一致)。
  const { wirings, installed } = wireSessionBridges(
    {
      channel: frameChannel,
      runtime,
      sessionId: runtime.session.sessionId,
      factory,
      env: process.env,
      shared: {},
    },
    // 桥装配失败 = 该能力本会话整个缺失,与 session-store 同属「降级但不致命」,
    // 走同一出口(日志 + stderr),不因日志默认关闭而隐身。
    (id, error) => reportBootFailure(`session bridge "${id}" failed to wire`, error),
  );
  bootLog.debug("session bridges wired", { installed });

  // agent-slash-completion:把 agent 声明的静态 slash 补全候选经 stdout 帧推给 server
  // 主进程(在 runRpcMode 接管 stdout 之前)。无声明则不发帧,会话行为不变。
  emitSlashCompletions(factory);

  // agent-attachment-profile:装配期单帧发射(slash_completions 同族),关断或未声明 → 零帧
  // (Req 2.3/5.1)。已通过白名单校验(disabled 时视同未声明,attachmentProfileDisabled 门控)。
  emitAttachmentProfile(factory, attachmentProfileDisabled);

  bootLog.info("entering rpc mode");

  // 会话生命周期结束(子进程终止)→ 统一释放所有接线 + 会话级临时文件回收(Req 2.3, 6.3)。
  // runRpcMode 自身在 SIGTERM / stdin end 时 dispose 运行时并 process.exit;本回收作为旁路
  // best-effort 在同样的终止信号上触发。disposeAll 遍历 cleanup、单点抛错记诊断并续跑,永不抛。
  // 帧通道最后释放(卸载唯一 stdin 读取器);各桥 cleanup 先解绑各自注册。
  // 注:session-title 是 prototype patch(机制 C),按既有行为不随会话结束还原,不入此列表。
  // `process.once` 只保证「每个事件一次」,四个事件可能先后触发(SIGTERM → exit)。各桥的
  // cleanup 本就声明为幂等,但在此显式收口一次,使收尾语义不依赖下游每个实现都记得幂等。
  let cleanedUp = false;
  const runSessionCleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    bootLog.debug("runner cleanup");
    disposeAll([...wirings, frameChannel], process.stderr);
  };
  process.once("SIGTERM", runSessionCleanup);
  process.once("SIGINT", runSessionCleanup);
  process.once("beforeExit", runSessionCleanup);
  // ★ `beforeExit` 在**显式 `process.exit()` 时不触发**,而 runRpcMode 正是在 stdin end
  //   / SIGTERM 后 dispose 运行时并 `process.exit` —— 即最常见的正常退出路径恰好绕开上面
  //   三个钩子,会话级临时文件不回收。补挂 `exit`。
  //   注意:`exit` 处理器内只有**同步**工作会完成,`disposeAll` 中返回 Promise 的
  //   cleanup(attachment 桥的临时文件回收)其同步段之后的部分不保证跑完 —— 这是 Node
  //   的硬约束,不是本处可以修的。`process.once` 保证与上面三条互不重复执行。
  process.once("exit", runSessionCleanup);

  return runRpcMode(runtime);
}

/** Process entry: parse argv, start the runner, surface fatal errors. */
/**
 * 装配 pi-web 内置模型源(spec: kernel-boundary-decoupling,任务 4.3)。
 *
 * ★ 为什么在这里、而且用**动态**导入:
 *   - runner 有**两条被支持的入口**:`runner-bootstrap.mjs`(生产)与直接跑
 *     `src/runner/runner.ts`(本文件顶部注释就文档化了这种用法,另有 2 个 it 档 +
 *     4 个 node e2e 这么起)。装配缝只放在 bootstrap 会让直接入口静默丢掉模型源 ——
 *     表现正是「会话起得来但模型找不到」(实测被 egress 登录闭环用例抓到)。
 *     故必须落在两条入口的**汇合点**,也就是 main()。
 *   - 用动态导入而非静态 import:静态 import 会让 `runner → host-assembly → adapters`
 *     成为编译期依赖,切包后 runner 包直接拖上 adapters 包。动态导入把它降级为
 *     **运行期组合** —— 拆包已完成,该模块由宿主在运行期提供:兼容层**不出现在**
 *     本包的依赖声明里(那会是一条反向的包依赖),specifier 由 Node 从宿主的
 *     node_modules 解析。取不到时走下面的 catch,退化为「两个源都未配置 env」。
 *   ★ 这条边**已在依赖守卫的 ALLOWED_EDGES 中显式登记**,并非靠"守卫看不见"蒙混过关。
 *
 * 失败不阻断启动:未装配模型源时的行为等同「两个源都未配置 env」,即 SDK 默认路径。
 */
async function composeModelSources(): Promise<void> {
  try {
    const mod = await import("@blksails/pi-web-server/host-assembly/model-sources.js");
    mod.registerBuiltinModelSources();
  } catch (error) {
    bootLog.warn("model sources not composed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  await composeModelSources();
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

/**
 * 本模块是否就是进程入口(而非被测试 import)。
 *
 * ★ 必须用 `pathToFileURL` 而非拼 `file://${argv1}`:后者不做 percent 编码,路径含空格
 *   (`/Users/a b/x.ts` → 真实 URL 是 `file:///Users/a%20b/x.ts`)或在 Windows 上
 *   (`file:///C:/…` vs `file://C:\…`)一律不相等 → `main()` 不执行、进程零输出以 0 退出。
 *   那是最难归因的失败形态:看起来「跑完了」,实际什么都没做。
 *
 * 抽成纯函数以便直测(两个入参都可注入,不依赖真实 `import.meta` / `process.argv`)。
 */
export function isEntryModule(metaUrl: string, argv1: string | undefined): boolean {
  if (typeof argv1 !== "string" || argv1.length === 0) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    // argv[1] 不是合法路径(理论上不可能)——不误判为入口。
    return false;
  }
}

// Execute when run as the process entry (not when imported by tests).
if (isEntryModule(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2));
}

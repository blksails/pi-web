/**
 * pi-handler — the singleton `createPiWebHandler` assembly.
 *
 * First call assembles the session dependencies (SessionManager + SessionStore
 * from @blksails/pi-web-server) plus a `createChannel` seam, injects config defaults,
 * and constructs `createPiWebHandler`. The instance is pinned on `globalThis`
 * so it survives Next dev hot-reload and is reused across requests (Req 2.5).
 *
 * In stub-agent mode (config.stubAgent) `createChannel` ignores the resolved
 * spawn spec and spawns the local stub process instead — reusing the entire
 * real channel/session/SSE chain offline with no API key. In real mode the
 * default `createChannel` (rpc-channel + PiRpcProcess on resolved.spawnSpec) is
 * used; provider keys are passed through to the agent process via env.
 *
 * Provider keys are never logged or echoed (Req 3.5).
 */
import path from "node:path";
import fs from "node:fs";
import {
  createPiWebHandler,
  type PiWebHandler,
  SessionManager,
  InMemorySessionStore,
  PiRpcProcess,
  AgentSourceResolver,
  resolvePiCliEntry,
  runnerBootstrapPath,
  createConfigRoutes,
  createSandboxProjectRoutes,
  createExtensionsConfigRoutes,
  createMcpConfigRoutes,
  createAttachmentRoutes,
  createBashRoutes,
  createSessionListRoutes,
  createExtensionRoutes,
  createHostCommandRegistry,
  ChildProcessPiCli,
  DEFAULT_ALLOWLIST,
  attachmentStoreConfigFromEnv,
  resolveSandboxEntry,
  sessionStoreConfigFromEnv,
  ConfigCodec,
  type AllowlistConfig,
  type ResolvedSource,
  type SessionChannel,
  type CreateChannelOpts,
} from "@blksails/pi-web-server";
import { loggingConfigSchema } from "@blksails/pi-web-protocol";
import { configureLogger } from "@blksails/pi-web-logger";
// trust 策略经子路径导入(不走 barrel),使 Next serverExternalPackages 对 pi SDK 的
// external 正确生效,避免 pi SDK/pi-ai 被打进路由 bundle(node:fs 解析失败)。
import { makeProjectTrustPolicy } from "@blksails/pi-web-server/trust";
import { resolveBashEnabled } from "./bash-default.js";
// listModelOptions 同理走子路径(它 import pi SDK,用于 settings 的 provider/model 下拉)。
// parseHiddenProviders/excludeProviders 为纯函数,经同一子路径转出,用于按
// PI_WEB_HIDE_PROVIDERS 部署期开关从下拉中剔除指定 provider 的模型。
import {
  listModelOptions,
  parseHiddenProviders,
  excludeProviders,
} from "@blksails/pi-web-server/model-options";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { loadConfig, type AppConfig } from "./config.js";
// 扩展管理扩展文件路径解析(纯路径模块,不拉 pi SDK,安全进 Next bundle):
// spec extension-install-agent-tools —— 经 spawn env 下发给 agent 子进程强制注入。
import { extensionManagerEntryPath } from "@blksails/pi-web-tool-kit/extension-entry";
// 自动会话标题扩展文件路径解析(同样为纯路径模块,不拉 pi SDK):spec auto-session-title ——
// 总开关 PI_WEB_AUTO_TITLE 开启(默认)时经 spawn env 下发给 agent 子进程强制注入。
import { autoTitleEntryPath } from "@blksails/pi-web-tool-kit/auto-title-entry";
import { createClearHostCommand } from "./clear-host-command.js";
import { resolveLoggingEnvDefault } from "./logging-default.js";
import { makeResumeMetaLoader } from "./resume-meta.js";
import { systemResourceArgs } from "./system-resource-args.js";

/**
 * Real-mode resolver wrapper.
 *
 * `create-session` only forwards `{ cwd }` to `resolver.resolve`. The REAL
 * spawn requires `runnerEntry` (the cwd-independent bootstrap) and `piCliEntry`
 * (the pi CLI bin), or `assemble` throws (custom mode used a placeholder runner
 * path that crashed instantly → onClosed → store.delete → 404 on :id routes).
 *
 * This wrapper anchors those entries so resolved spawn specs point at real,
 * cwd-independent module-resolution roots. `agentDir` is threaded through when
 * the app pins an isolated PI_CODING_AGENT_DIR.
 */
function makeRealResolver(config: AppConfig): {
  resolve: (
    source: string | undefined,
    opts?: { cwd?: string; trust?: boolean },
  ) => Promise<ResolvedSource>;
} {
  const runnerEntry = runnerBootstrapPath();
  const piCliEntry = resolvePiCliEntry();
  // Pin the pi config dir so the agent process reads ~/.pi/agent/auth.json
  // (credentials from `pi` login) and settings.json (default provider/model,
  // installed packages). assemble-spawn writes this as PI_CODING_AGENT_DIR last,
  // so it cannot be shadowed by baseEnv/trust fragments.
  const agentDir = config.agentDir;
  // The agent-source module never reads process.env itself (Req 7.x); it builds
  // spawnSpec.env solely from baseEnv + env + trust fragment. The spawned child
  // therefore needs the host environment threaded in as baseEnv — without PATH
  // the OS cannot even locate `node`, and the child fails to spawn (exit
  // code:null/signal:null with no stderr) → onClosed → session deleted → 404.
  const baseEnv = process.env as Record<string, string>;
  // 项目信任策略(C-P1/C-P4):复用 pi 的 ProjectTrustStore(同一 agentDir),叠加 trustedRoots。
  // 决定 custom 模式是否向 runner 传放行信号 → SDK 才加载工作目录下的项目级 `.pi/`
  // (扩展/子代理/技能)。仅值导入被 Next serverExternalPackages 外置的 SDK,不打进 bundle。
  //
  // 默认信任 app 所服务的项目根(`config.defaultCwd` = PI_WEB_DEFAULT_CWD ?? process.cwd())
  // 及其子树:运行 pi-web 即隐含信任你所服务的项目(其 agent 代码本就在子进程执行),使
  // 仓库内 `.pi/`(含 examples/* 示例)开箱即加载。可经 PI_WEB_TRUST_DEFAULT_CWD=false 关闭;
  // 外部 git/任意路径源不在该子树内,仍默认不信任(secure-by-default 仍成立)。
  // 额外受信根经 PI_WEB_TRUSTED_ROOTS(路径分隔符分隔)叠加。
  const trustDefaultCwd = process.env.PI_WEB_TRUST_DEFAULT_CWD !== "false";
  const trustedRoots = [
    ...(trustDefaultCwd ? [config.defaultCwd] : []),
    ...(process.env.PI_WEB_TRUSTED_ROOTS ?? "")
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  ];
  const trustPolicy = makeProjectTrustPolicy({
    ...(agentDir !== undefined ? { agentDir } : {}),
    trustedRoots,
  });
  return {
    resolve: async (source, opts) => {
      const cwd = opts?.cwd ?? config.defaultCwd;
      // 「扩展」面板开关:关闭系统 skills/extensions → 注入 --no-skills/--no-extensions。
      // 项目级开关须读 **agent source 自身目录** 的 .pi/settings.json(本地目录源即项目根,
      // 与 runner 资源发现的 cwd 一致),否则被 handler defaultCwd 遮蔽 → per-source
      // loadSystemSkills 覆盖失效(plugin-system-unification R12 Fix#1)。git/cli 源回退 cwd。
      let resourceCwd = cwd;
      if (typeof source === "string" && source.length > 0) {
        try {
          const abs = path.resolve(cwd, source);
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) resourceCwd = abs;
        } catch {
          // 解析失败(非本地路径/权限)→ 保持 cwd。
        }
      }
      const extraArgs = await systemResourceArgs(agentDir, resourceCwd);
      return AgentSourceResolver.resolve(source, {
        cwd,
        runnerEntry,
        piCliEntry,
        agentDir,
        baseEnv,
        trustPolicy,
        // DTO `trust` → 显式信任意图;缺省时由 trustPolicy(信任库/trustedRoots/默认)决定。
        ...(opts?.trust !== undefined ? { requestTrust: opts.trust } : {}),
        ...(extraArgs.length > 0 ? { extraArgs } : {}),
      });
    },
  };
}

/**
 * Absolute path to the stub agent script. Resolved from the project root
 * (`process.cwd()`, where the Next server runs) so it is stable regardless of
 * how this module is bundled. Overridable via PI_WEB_STUB_AGENT_PATH.
 */
function stubAgentPath(): string {
  const override = process.env.PI_WEB_STUB_AGENT_PATH;
  if (override !== undefined && override !== "") {
    // Resolve against the project root (`process.cwd()`, where the Next server
    // runs) so a RELATIVE override works regardless of the stub's spawn cwd
    // (= the `@blksails/pi-web-server` package dir). `path.resolve` passes an absolute
    // override through unchanged.
    return path.resolve(process.cwd(), override);
  }
  return path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs");
}

/**
 * Attachment spawn-env passthrough (attachment-store, Req 7.3/7.4).
 *
 * Build the env entries the main process downstreams to a session child so a
 * FUTURE runner child can share the SAME local backend: the storage-dir
 * convention `PI_WEB_ATTACHMENT_DIR` AND the signing secret
 * `PI_WEB_ATTACHMENT_SECRET`. Both values are taken from the MAIN-process
 * attachment store config (`attachmentStoreConfigFromEnv()`'s `dir`/`secret`),
 * NOT recomputed — so the child points at the same directory and holds the same
 * HMAC secret (otherwise a child-produced tool-output `/raw` signed URL would
 * 401 in the main process).
 *
 * This slice ONLY downstreams the convention + secret. It does NOT instantiate
 * a store in the child nor do any cross-process resolve — that is owned by the
 * downstream `attachment-tool-bridge` spec, which must not edit this passthrough
 * (it only verifies the child received both vars). The secret is never logged.
 */
function attachmentSpawnEnv(
  attachment: { dir: string; secret: string },
): Record<string, string> {
  return {
    PI_WEB_ATTACHMENT_DIR: attachment.dir,
    PI_WEB_ATTACHMENT_SECRET: attachment.secret,
    // 分发 URL base path:子进程产出的 tool-output 签名 URL 需带 app 挂载前缀 `/api`
    // 才直接可达(与主进程一致;否则前端取该签名 URL 会 404)。
    PI_WEB_ATTACHMENT_URL_BASE: "/api",
  };
}

interface HandlerSingleton {
  readonly handler: PiWebHandler;
  readonly manager: SessionManager;
}

const GLOBAL_KEY = Symbol.for("pi-web.app.handler");

type GlobalWithHandler = typeof globalThis & {
  [GLOBAL_KEY]?: HandlerSingleton;
};

/**
 * Build the stub spawn spec (local node + stub script), inheriting env.
 *
 * `--import jiti/register` lets the stub `.mjs` import the TS-source `@blksails/pi-web-server`
 * (no dist build) so it can persist/resume via the shared `SessionEntryStore`.
 * Session identity + creation metadata are passed via `PI_WEB_STUB_*` env so the
 * stub aligns its persisted session id with the host sessionId and can cold-resume.
 * `SESSION_STORE*` is already inherited from `process.env`.
 */
function stubSpawnSpec(
  config: AppConfig,
  opts: CreateChannelOpts,
  sessionCwd: string,
  attachment: { dir: string; secret: string },
): SpawnSpec {
  // Run with cwd = @blksails/pi-web-server package dir so `--import jiti/register`
  // resolves jiti from the server package (pnpm does not hoist it to the app
  // root). The session cwd is conveyed separately via PI_WEB_STUB_CWD (used by
  // the stub to write the session header / piweb.session metadata).
  const serverPkgDir = path.dirname(runnerBootstrapPath());
  return {
    cmd: process.execPath,
    args: ["--import", "jiti/register", stubAgentPath()],
    cwd: serverPkgDir,
    env: {
      ...process.env,
      ...config.providerKeys,
      // 附件目录约定 + 签名 secret 经 spawn env 下发(Req 7.3/7.4),取自主进程 store
      // 配置,保证主/子进程一致;最后写入,防止被 process.env 既有同名变量遮蔽。
      ...attachmentSpawnEnv(attachment),
      PI_WEB_STUB_SESSION_ID: opts.sessionId,
      PI_WEB_STUB_CWD: sessionCwd,
      ...(opts.source !== undefined ? { PI_WEB_STUB_SOURCE: opts.source } : {}),
      ...(opts.model !== undefined ? { PI_WEB_STUB_MODEL: opts.model } : {}),
    } as Record<string, string>,
  };
}

function buildSingleton(): HandlerSingleton {
  const config = loadConfig();

  // 主进程自身 logger 的 runtime 门控:主进程不像 runner 那样调 initConfigFromEnv,
  // 库默认 enabled=true 会让 server 侧 createLogger(pi-session 等)无条件打到 server stderr。
  // 在此按同一 env 默认(PI_WEB_LOG_*,默认关)对齐,避免未开日志时刷终端;PI_WEB_LOG_ENABLED=1
  // 时主进程与 runner 同步开启。(注:此为主进程自身日志门控,runner 日志→UI 仍由
  // loggingConfigProvider/gateConfig 单独控制。)
  configureLogger(resolveLoggingEnvDefault());

  const store = new InMemorySessionStore(true);

  // 日志门控 provider（Req 6.4/6.5/6.6 / task 4.4）：每次新会话创建时读取最新配置。
  // 缺文件/空配置/读失败 → env 推导默认（日志默认**关闭**；`PI_WEB_LOG_ENABLED` 存在且
  // 非 "false" 时强制开启，无需经 Settings；级别/命名空间一并取自 PI_WEB_LOG_* env，
  // 见 resolveLoggingEnvDefault）。有内容 → parse(raw) 应用 Settings 已保存的配置。
  const loggingConfigProvider = async () => {
    try {
      const codec = new ConfigCodec(config.agentDir);
      const raw = await codec.load("logging");
      if (raw === null || typeof raw !== "object" || Object.keys(raw).length === 0) {
        return loggingConfigSchema.parse(resolveLoggingEnvDefault());
      }
      return loggingConfigSchema.parse(raw);
    } catch {
      return loggingConfigSchema.parse(resolveLoggingEnvDefault());
    }
  };

  // readinessHandshake: 开启会话就绪握手(spec session-readiness-handshake) —— 仅生产 app 接线开启,
  // 使前端在 agent 真正就绪前门控发送、就绪通告经粘性 session-status 帧投递。可经 env 关闭以回退。
  // snapshotAuthority: 开启会话权威快照(spec session-snapshot-authority) —— 仅生产 app 接线开启,
  // 使 busy/stats/lifecycle 经单一权威 session-state 帧投递、前端纯投影。可经 env 关闭以一步回退。
  // ⚠ 与 readinessHandshake 存在耦合:lifecycle 仅经 setLifecycle 入快照(后者在握手关闭时早返回),
  // 故若开此而关 readinessHandshake,snapshot.lifecycle 恒为 initializing。二者应同开同关(默认皆开)。
  const manager = new SessionManager({
    store,
    idleMs: 0,
    loggingConfigProvider,
    readinessHandshake: process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE !== "1",
    snapshotAuthority: process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY !== "1",
  });

  // 强制注入:解析 pi-sandbox 入口一次(env 覆盖 > <agentDir>/npm/.../pi-sandbox/index.ts)。
  // 使沙箱 enforcement **不依赖** pi 默认扩展发现:cli 模式经 `-e <entry>` 显式加载;
  // custom 模式经 env `PI_WEB_SANDBOX_ENTRY` 由 runner option-mapper 追加到 additionalExtensionPaths。
  // 未安装时为 undefined → 跳过注入(不报错,行为回退到默认发现)。
  const sandboxEntry = resolveSandboxEntry(config.agentDir);
  // 扩展管理扩展入口(spec extension-install-agent-tools):强制注入每个会话,经 spawn env
  // 下发,runner option-mapper 加入 forcedExtensionPaths。解析不到(异常布局)→ undefined,跳过注入。
  const extToolsEntry = extensionManagerEntryPath();
  // 自动会话标题扩展入口(spec auto-session-title):总开关 PI_WEB_AUTO_TITLE 默认开,
  // 关闭(="0")时不解析、不下发 → 扩展根本不注入(服务端权威门控,零开销)。
  // 解析不到(异常布局)→ undefined,跳过注入,不阻塞会话创建。
  const autoTitleEnabled = process.env.PI_WEB_AUTO_TITLE !== "0";
  const autoTitleEntry = autoTitleEnabled ? autoTitleEntryPath() : undefined;

  // 附件存储(attachment-store,Req 7.1):在主进程实例化一次,经 env 约定解析落盘目录
  // (PI_WEB_ATTACHMENT_DIR)与稳定签名 secret(PI_WEB_ATTACHMENT_SECRET),构造本地后端门面。
  // store 随 handler 单例 pin 在 globalThis(此函数仅首次调用),故读(上传落库)/写(分发取流)
  // 两路径共用同一主进程实例。下游 attachment-tool-bridge 的 spawn env 透传(目录+secret)归
  // task 5.2,不在此装配。
  // 同时取出 dir/secret(task 5.2,Req 7.3/7.4):经 spawn env 下发给子进程,
  // 为未来 runner 子进程共享同一本地后端预留接缝,并保证签名 secret 主/子进程一致。
  // 仅下发——本切片不在子进程实例化 store(那是 attachment-tool-bridge)。
  const {
    store: attachmentStore,
    dir: attachmentDir,
    secret: attachmentSecret,
    // 主进程 store 也用 `/api` 前缀(上传端点返回的 displayUrl 与 tool-output 一致可达)。
  } = attachmentStoreConfigFromEnv(process.env, { urlBasePath: "/api" });
  const attachmentEnv = { dir: attachmentDir, secret: attachmentSecret };

  const createChannel = (
    resolved: ResolvedSource,
    opts: CreateChannelOpts,
  ): SessionChannel => {
    if (config.stubAgent) {
      // Deterministic offline agent: reuse the real channel over the stub spec,
      // threading session identity + metadata via env (resolved cwd kept aligned).
      return new PiRpcProcess(
        stubSpawnSpec(config, opts, resolved.spawnSpec.cwd, attachmentEnv),
      );
    }
    // Real mode: append session-alignment args by source mode. Both modes take
    // --session-id (agent-side open-or-create); custom (runner) also takes
    // --source-meta for piweb.session metadata; cli (pi) takes --model natively.
    const extraArgs: string[] = ["--session-id", opts.sessionId];
    if (opts.model !== undefined) extraArgs.push("--model", opts.model);
    if (resolved.mode === "custom" && opts.source !== undefined) {
      extraArgs.push("--source-meta", opts.source);
    }
    // cli 模式显式加载沙箱扩展(`--extension, -e <path>`,不依赖 user-scope 注册表)。
    if (resolved.mode === "cli" && sandboxEntry !== undefined) {
      extraArgs.push("-e", sandboxEntry);
    }
    const spec: SpawnSpec = {
      ...resolved.spawnSpec,
      args: [...resolved.spawnSpec.args, ...extraArgs],
      env: {
        ...resolved.spawnSpec.env,
        ...config.providerKeys,
        // custom 模式据此在 runner 内强制注入;cli 模式无害(由上面的 -e 生效)。
        ...(sandboxEntry !== undefined ? { PI_WEB_SANDBOX_ENTRY: sandboxEntry } : {}),
        // 扩展管理扩展入口 → runner forcedExtensionPaths(spec extension-install-agent-tools)。
        ...(extToolsEntry !== undefined ? { PI_WEB_EXT_TOOLS_ENTRY: extToolsEntry } : {}),
        // 自动会话标题扩展入口 → runner forcedExtensionPaths(spec auto-session-title)。
        ...(autoTitleEntry !== undefined ? { PI_WEB_AUTO_TITLE_ENTRY: autoTitleEntry } : {}),
        // 附件目录约定 + 签名 secret 经 spawn env 下发(Req 7.3/7.4),取自主进程 store
        // 配置,保证主/子进程一致(子进程产出的 tool-output /raw 签名 URL 才能在主进程通过校验)。
        ...attachmentSpawnEnv(attachmentEnv),
      },
    };
    return new PiRpcProcess(spec);
  };

  // extension-management + 统一命令层(unified-command-result-layer)共享的安装治理依赖。
  // host 命令(/plugin)与 REST 路由复用同一 piCli/allowlist/reload + env 门控,保持一致。
  const extPiCli = new ChildProcessPiCli();
  const extAllowMutate = process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY === "1";
  // allowlist 放宽开关(各自独立、可叠加):
  //   PI_WEB_EXT_ALLOW_LOCAL=1 → 放行 `local:<path>` 源
  //   PI_WEB_EXT_ALLOW_NPM=1   → 放行任意 npm 包(含无 scope),仍要求精确版本固定
  const extAllowlist: AllowlistConfig = {
    ...DEFAULT_ALLOWLIST,
    ...(process.env.PI_WEB_EXT_ALLOW_LOCAL === "1" ? { allowLocal: true } : {}),
    ...(process.env.PI_WEB_EXT_ALLOW_NPM === "1" ? { allowAnyNpm: true } : {}),
  };
  const reloadRunner = async (session: {
    restartRunner(): Promise<void>;
  }): Promise<void> => {
    await session.restartRunner();
  };

  const handler = createPiWebHandler({
    manager,
    store,
    // host 命令通道(server 侧执行,结果同步 HTTP 回流)。/plugin 已迁出:扩展安装改为
    // agent 回合内的内置工具(spec extension-install-agent-tools),用 ctx.ui 呈现,不再走
    // host 命令 + 模态面板。此处仅保留 /clear(agent 上下文清空 + 前端 clear-transcript)。
    hostCommands: createHostCommandRegistry([createClearHostCommand()]),
    // 附件元数据源:makeMessagesHandler 据请求 body.attachmentIds 经 head(id) 取
    // {id,mimeType,name} 注入 prompt 文本引用(attachment-tool-bridge task 5.2);
    // 与 vision/images base64 并存,不内联字节。
    attachmentStore,
    // Inject the real-mode entries (bootstrap runner + pi CLI) so resolved
    // custom/cli spawn specs are cwd-independent and never crash on a
    // placeholder path. In stub mode the resolved spec is discarded by
    // createChannel, but resolve() still runs without throwing.
    resolver: makeRealResolver(config),
    createChannel,
    // Cold-resume reader: POST /sessions { resumeId } loads {source, cwd, model}
    // from the configured SessionEntryStore (same SESSION_STORE backend) by id.
    loadResumeMeta: makeResumeMetaLoader(sessionStoreConfigFromEnv()),
    // Inject config endpoints — schema-driven settings UI persistence.
    //  - GET/PUT /config/:domain → ~/.pi/agent/{auth,settings,sandbox}.json
    //    (sandbox = pi-sandbox 全局策略,方案 A)。codec 读 PI_WEB_AGENT_DIR
    //    (默认 ~/.pi/agent);adminPolicy 默认放行(P0)。
    //  - GET/PUT /config/sandbox/project[?cwd] → <cwd>/.pi/sandbox.json(方案 B +
    //    项目级覆盖)。cwd 缺省取所服务项目根,且限定在该子树内防越权写。
    //  - GET/PUT /config/extensions/{global,project} → settings.json 的 commands +
    //    顶层 per-扩展 KV 互映(全局 <agentDir>/settings.json,项目 <cwd>/.pi/settings.json)。
    routes: [
      // 独立「MCP」配置域:GET·PUT /config/mcp → <agentDir>/mcp.json(pi-mcp-adapter)。
      // 必须排在通用 /config/:domain **之前**,否则 2 段路径被 :domain 抢匹配致 DOMAIN_NOT_FOUND。
      ...createMcpConfigRoutes({ agentDir: config.agentDir }),
      ...createConfigRoutes({
        rootDir: config.agentDir,
        // settings 域:把 defaultProvider/defaultModel 升级为运行时下拉(选项 = 该
        // agentDir 下已配置凭证的可用模型,含 models.json 自定义 provider)。
        // 经 PI_WEB_HIDE_PROVIDERS(逗号分隔)剔除部署期不想暴露的 provider 及其模型。
        listModelOptions: () => {
          const hidden = parseHiddenProviders(process.env.PI_WEB_HIDE_PROVIDERS);
          return excludeProviders(listModelOptions(config.agentDir), hidden);
        },
      }),
      ...createSandboxProjectRoutes({ defaultCwd: config.defaultCwd }),
      ...createExtensionsConfigRoutes({
        agentDir: config.agentDir,
        defaultCwd: config.defaultCwd,
      }),
      // 会话列表(sessions-list):GET /sessions 只读列表端点。复用与冷恢复同一存储
      // 配置来源(sessionStoreConfigFromEnv),保证读到同一后端。系统(全机器)视图经
      // NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL 门控,默认关闭——关闭时 scope=all 返回 403、
      // 不触达存储(同名 NEXT_PUBLIC_ 变量前端亦读取以隐藏「全部」Tab,两端一致)。
      ...createSessionListRoutes({
        storeConfig: sessionStoreConfigFromEnv(),
        globalEnabled:
          process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "true" ||
          process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "1",
        defaultCwd: config.defaultCwd,
      }),
      // 附件上传(POST /sessions/:id/attachments,经 Router :id 会话门控)+ 分发
      // (GET /attachments/:attachmentId/raw,靠签名自洽鉴权)两端点,经同一注入接缝挂载,
      // 在 /api/** 下可达(Req 7.1)。
      ...createAttachmentRoutes(attachmentStore),
      // bang shell 命令(spec bang-shell-command):POST /sessions/:id/bash。
      // 服务端权威门控——默认关闭(secure by default),仅 PI_WEB_BASH_ENABLED 显式开启;
      // 关闭时端点返回 404(任意 shell 执行属高危,远程/多用户环境必须默认关)。
      ...createBashRoutes(store, { enabled: resolveBashEnabled() }),
      // 扩展安装管理(extension-management,builtin-plugin-command 任务 2.2):挂载既有
      // GET/POST /extensions、DELETE /extensions/:extId、POST /sessions/:id/reload。
      // 注入 SessionReloader:经 PiSession.restartRunner() 重 spawn runner 续会话、重解析
      // 资源,使 /plugin 安装/卸载对运行中的会话生效(Req 4.1/5.x/6.1)。
      ...createExtensionRoutes({
        piCli: extPiCli,
        store,
        manager,
        // 安装治理由 env 配置(运营者必需;默认沿用 extension-management 的安全默认:
        // 管理员门控拒绝匿名/非管理员、白名单仅 @pi-web/@earendil-works npm + github.com、禁本地)。
        //   PI_WEB_EXT_ADMIN_ALLOW_ANY=1  → 放行安装(dev/单用户自托管;生产应改用真实 adminPolicy)
        //   PI_WEB_EXT_ALLOW_LOCAL=1      → 允许本地路径来源(与 host 命令共享 extAllowlist)
        ...(extAllowMutate ? { adminPolicy: (): boolean => true } : {}),
        allowlist: extAllowlist,
        reloadSession: reloadRunner,
      }),
    ],
    // The app mounts the handler under `/api/**`; the handler's internal routes
    // are `/sessions/**` and `/config/**`, so strip the `/api` prefix.
    sse: { basePath: "/api" },
  });

  return { handler, manager };
}

function getSingleton(): HandlerSingleton {
  const g = globalThis as GlobalWithHandler;
  let singleton = g[GLOBAL_KEY];
  if (singleton === undefined) {
    singleton = buildSingleton();
    g[GLOBAL_KEY] = singleton;
  }
  return singleton;
}

/** Return the process-resident singleton handler. */
export function getHandler(): PiWebHandler {
  return getSingleton().handler;
}

/** Graceful shutdown passthrough (host SIGTERM). */
export async function shutdownHandler(): Promise<void> {
  const g = globalThis as GlobalWithHandler;
  await g[GLOBAL_KEY]?.manager.shutdown();
}

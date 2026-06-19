/**
 * pi-handler — the singleton `createPiWebHandler` assembly.
 *
 * First call assembles the session dependencies (SessionManager + SessionStore
 * from @pi-web/server) plus a `createChannel` seam, injects config defaults,
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
  resolveSandboxEntry,
  sessionStoreConfigFromEnv,
  type ResolvedSource,
  type SessionChannel,
  type CreateChannelOpts,
} from "@pi-web/server";
// trust 策略经子路径导入(不走 barrel),使 Next serverExternalPackages 对 pi SDK 的
// external 正确生效,避免 pi SDK/pi-ai 被打进路由 bundle(node:fs 解析失败)。
import { makeProjectTrustPolicy } from "@pi-web/server/trust";
import type { SpawnSpec } from "@pi-web/protocol";
import { loadConfig, type AppConfig } from "./config.js";
import { makeResumeMetaLoader } from "./resume-meta.js";

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
    resolve: (source, opts) =>
      AgentSourceResolver.resolve(source, {
        cwd: opts?.cwd ?? config.defaultCwd,
        runnerEntry,
        piCliEntry,
        agentDir,
        baseEnv,
        trustPolicy,
        // DTO `trust` → 显式信任意图;缺省时由 trustPolicy(信任库/trustedRoots/默认)决定。
        ...(opts?.trust !== undefined ? { requestTrust: opts.trust } : {}),
      }),
  };
}

/**
 * Absolute path to the stub agent script. Resolved from the project root
 * (`process.cwd()`, where the Next server runs) so it is stable regardless of
 * how this module is bundled. Overridable via PI_WEB_STUB_AGENT_PATH.
 */
function stubAgentPath(): string {
  return (
    process.env.PI_WEB_STUB_AGENT_PATH ??
    path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs")
  );
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
 * `--import jiti/register` lets the stub `.mjs` import the TS-source `@pi-web/server`
 * (no dist build) so it can persist/resume via the shared `SessionEntryStore`.
 * Session identity + creation metadata are passed via `PI_WEB_STUB_*` env so the
 * stub aligns its persisted session id with the host sessionId and can cold-resume.
 * `SESSION_STORE*` is already inherited from `process.env`.
 */
function stubSpawnSpec(
  config: AppConfig,
  opts: CreateChannelOpts,
  sessionCwd: string,
): SpawnSpec {
  // Run with cwd = @pi-web/server package dir so `--import jiti/register`
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
      PI_WEB_STUB_SESSION_ID: opts.sessionId,
      PI_WEB_STUB_CWD: sessionCwd,
      ...(opts.source !== undefined ? { PI_WEB_STUB_SOURCE: opts.source } : {}),
      ...(opts.model !== undefined ? { PI_WEB_STUB_MODEL: opts.model } : {}),
    } as Record<string, string>,
  };
}

function buildSingleton(): HandlerSingleton {
  const config = loadConfig();

  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });

  // 强制注入:解析 pi-sandbox 入口一次(env 覆盖 > <agentDir>/npm/.../pi-sandbox/index.ts)。
  // 使沙箱 enforcement **不依赖** pi 默认扩展发现:cli 模式经 `-e <entry>` 显式加载;
  // custom 模式经 env `PI_WEB_SANDBOX_ENTRY` 由 runner option-mapper 追加到 additionalExtensionPaths。
  // 未安装时为 undefined → 跳过注入(不报错,行为回退到默认发现)。
  const sandboxEntry = resolveSandboxEntry(config.agentDir);

  const createChannel = (
    resolved: ResolvedSource,
    opts: CreateChannelOpts,
  ): SessionChannel => {
    if (config.stubAgent) {
      // Deterministic offline agent: reuse the real channel over the stub spec,
      // threading session identity + metadata via env (resolved cwd kept aligned).
      return new PiRpcProcess(
        stubSpawnSpec(config, opts, resolved.spawnSpec.cwd),
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
      },
    };
    return new PiRpcProcess(spec);
  };

  const handler = createPiWebHandler({
    manager,
    store,
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
      ...createConfigRoutes({ rootDir: config.agentDir }),
      ...createSandboxProjectRoutes({ defaultCwd: config.defaultCwd }),
      ...createExtensionsConfigRoutes({
        agentDir: config.agentDir,
        defaultCwd: config.defaultCwd,
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

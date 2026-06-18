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
  type ResolvedSource,
  type SessionChannel,
} from "@pi-web/server";
import type { SpawnSpec } from "@pi-web/protocol";
import { loadConfig, type AppConfig } from "./config.js";

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
    opts?: { cwd?: string },
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
  return {
    resolve: (source, opts) =>
      AgentSourceResolver.resolve(source, {
        cwd: opts?.cwd ?? config.defaultCwd,
        runnerEntry,
        piCliEntry,
        agentDir,
        baseEnv,
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

/** Build the stub spawn spec (local node + stub script), inheriting env. */
function stubSpawnSpec(config: AppConfig): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [stubAgentPath()],
    cwd: config.defaultCwd,
    env: { ...process.env, ...config.providerKeys } as Record<string, string>,
  };
}

function buildSingleton(): HandlerSingleton {
  const config = loadConfig();

  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });

  const createChannel = (resolved: ResolvedSource): SessionChannel => {
    if (config.stubAgent) {
      // Deterministic offline agent: reuse the real channel over the stub spec.
      return new PiRpcProcess(stubSpawnSpec(config));
    }
    // Real mode: spawn the resolved agent, passing provider keys through env.
    const spec: SpawnSpec = {
      ...resolved.spawnSpec,
      env: { ...resolved.spawnSpec.env, ...config.providerKeys },
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
    // Inject config endpoints (GET/PUT /config/:domain) — schema-driven settings
    // UI persistence for ~/.pi/agent/auth.json + settings.json. The codec reads
    // PI_WEB_AGENT_DIR (default ~/.pi/agent); adminPolicy defaults to allow (P0).
    routes: createConfigRoutes({ rootDir: config.agentDir }),
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

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
import type { AgentContext } from "./agent-definition.js";
import { loadAgentDefinition } from "./agent-loader.js";
import { makeResolveProjectTrust } from "./project-trust.js";
import {
  createSessionEntryStore,
  mirrorSessionManagerToStore,
  sessionStoreConfigFromEnv,
} from "../session-store/index.js";

/** Parsed runner CLI arguments. */
export interface RunnerArgs {
  agent: string;
  cwd: string;
  agentDir?: string;
  /** External trust decision (default: untrusted). */
  trusted: boolean;
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
 * `--agent`, `--cwd`, `--agent-dir`, `--trusted`. Throws {@link RunnerArgsError}
 * when `--agent` is missing.
 */
export function parseRunnerArgs(argv: readonly string[]): RunnerArgs {
  let agent: string | undefined;
  let cwd: string | undefined;
  let agentDir: string | undefined;
  let trusted = false;

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
    } else if (arg === "--trusted" || arg!.startsWith("--trusted=")) {
      if (arg === "--trusted") {
        trusted = true;
      } else {
        trusted = takeValue("--trusted") !== "false";
      }
    }
  }

  if (agent === undefined || agent === "") {
    throw new RunnerArgsError("Missing required argument: --agent <entry path>");
  }

  const resolvedCwd = cwd ?? process.cwd();
  const result: RunnerArgs = { agent, cwd: resolvedCwd, trusted };
  if (agentDir !== undefined) result.agentDir = agentDir;
  return result;
}

/**
 * Build the runtime and enter RPC mode. Returns the (never-resolving) promise
 * from `runRpcMode`. Separated from {@link main} for testability.
 */
export async function startRunner(args: RunnerArgs): Promise<never> {
  const agentDir = args.agentDir ?? getAgentDir();
  const ctx: AgentContext = {
    cwd: args.cwd,
    agentDir,
    env: process.env,
  };

  const trust = makeResolveProjectTrust(args.trusted);
  const factory = await loadAgentDefinition(args.agent, ctx, trust);

  const sessionManager = SessionManager.create(args.cwd);

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

  const runtime = await createAgentSessionRuntime(factory, {
    cwd: args.cwd,
    agentDir,
    sessionManager,
  });

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

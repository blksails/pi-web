/**
 * spawnSpec 装配(纯函数,Req 4.1–4.4, 7.1, 7.2)。
 *
 * - custom:`node <runnerEntry> --agent <entry> --cwd <work>`,其中 `runnerEntry`
 *   是 cwd-无关的引导脚本(packages/server/runner-bootstrap.mjs)的绝对路径。
 *   引导脚本自身在 @blksails/server 包内,负责构造 jiti 并以 jiti 解析 TS runner
 *   及 pi SDK——因此无需 `--import jiti/register`,模块解析不依赖 spawnSpec.cwd。
 * - cli:`node <piCliEntry> --mode rpc --cwd <source>`。
 * - env 合并:base + PI_CODING_AGENT_DIR(来自 agentDir) + 额外 env + trust 片段;
 *   隔离关键变量 PI_CODING_AGENT_DIR 不被额外 env / trust 片段覆盖。
 * - spawnSpec.cwd === 顶层 cwd。
 *
 * `runnerEntry`(custom)与 `piCliEntry`(cli)必须由调用方注入真实绝对路径;
 * 缺省即抛错(而非静默指向占位路径导致子进程秒崩 → 会话丢失 → 404)。
 */
import { AgentSourceError } from "./errors.js";
import type { ResolveOptions, SpawnSpec, TrustFragment } from "./types.js";

export interface AssembleCustomParams {
  mode: "custom";
  cwd: string;
  entryPath: string;
}

export interface AssembleCliParams {
  mode: "cli";
  cwd: string;
}

export type AssembleParams = AssembleCustomParams | AssembleCliParams;

/** 合并 env,保证隔离关键变量不被覆盖。 */
function buildEnv(opts: ResolveOptions, fragment: TrustFragment): Record<string, string> {
  const env: Record<string, string> = {
    ...(opts.baseEnv ?? {}),
    ...(opts.env ?? {}),
    ...fragment.extraEnv,
  };
  // 隔离关键变量最后写入,防止 opts.env / trust 片段覆盖(Req 7.2)。
  if (opts.agentDir !== undefined) {
    env["PI_CODING_AGENT_DIR"] = opts.agentDir;
  }
  return env;
}

export function assemble(
  params: AssembleParams,
  fragment: TrustFragment,
  opts: ResolveOptions,
): SpawnSpec {
  const env = buildEnv(opts, fragment);

  if (params.mode === "custom") {
    const runnerEntry = opts.runnerEntry;
    if (runnerEntry === undefined || runnerEntry === "") {
      throw new AgentSourceError(
        "MISSING_RUNNER_ENTRY",
        "custom mode requires opts.runnerEntry (absolute path to the runner bootstrap).",
      );
    }
    const args = [
      runnerEntry,
      "--agent",
      params.entryPath,
      "--cwd",
      params.cwd,
      ...(opts.agentDir !== undefined ? ["--agent-dir", opts.agentDir] : []),
      ...fragment.extraArgs,
      ...(opts.extraArgs ?? []),
    ];
    return { cmd: "node", args, cwd: params.cwd, env };
  }

  const piCliEntry = opts.piCliEntry;
  if (piCliEntry === undefined || piCliEntry === "") {
    throw new AgentSourceError(
      "MISSING_PI_CLI_ENTRY",
      "cli mode requires opts.piCliEntry (absolute path to the pi CLI entry).",
    );
  }
  // NOTE: the pi CLI has NO `--cwd` flag (it reads the process working dir).
  // The working dir is set via spawnSpec.cwd below; passing `--cwd` makes pi
  // exit with "Unknown option: --cwd" → channel crash → session deleted → 404.
  const args = [
    piCliEntry,
    "--mode",
    "rpc",
    ...fragment.extraArgs,
    ...(opts.extraArgs ?? []),
  ];
  return { cmd: "node", args, cwd: params.cwd, env };
}

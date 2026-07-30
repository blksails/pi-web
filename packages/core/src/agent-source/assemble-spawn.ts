/**
 * spawnSpec 装配(纯函数,Req 4.1–4.4, 7.1, 7.2)。
 *
 * - custom:`node <runnerEntry> --agent <entry> --cwd <work>`,其中 `runnerEntry`
 *   是 cwd-无关的引导脚本(packages/server/runner-bootstrap.mjs)的绝对路径。
 *   引导脚本自身在 @blksails/pi-web-server 包内,负责构造 jiti 并以 jiti 解析 TS runner
 *   及 pi SDK——因此无需 `--import jiti/register`,模块解析不依赖 spawnSpec.cwd。
 * - cli:`node <piCliEntry> --mode rpc --cwd <source>`。
 * - env 合并:base + PI_CODING_AGENT_DIR(来自 agentDir) + 额外 env + trust 片段;
 *   隔离关键变量 PI_CODING_AGENT_DIR 不被额外 env / trust 片段覆盖。
 * - spawnSpec.cwd === 顶层 cwd。
 *
 * `runnerEntry`(custom)与 `piCliEntry`(cli)必须由调用方注入真实绝对路径;
 * 缺省即抛错(而非静默指向占位路径导致子进程秒崩 → 会话丢失 → 404)。
 *
 * 调试:env `PI_RUNNER_INSPECT` 开启时,在脚本路径前注入 Node inspector flag
 * (`--inspect[=port]` / `--inspect-brk`),仅作用于 runner 子进程(见 {@link inspectFlag})。
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

/**
 * 调试门控:`PI_RUNNER_INSPECT` → 为 runner 子进程注入 Node inspector flag
 * (必须置于脚本路径之前,node 解析约束)。只作用于 runner 子进程,主进程不受影响
 * (故不能用 NODE_OPTIONS——那会被子进程继承并与主进程抢同一端口报 EADDRINUSE)。
 *
 * 空/未设 → 不注入。否则(值大小写不敏感):
 *   "1" | "true" | "on"   → --inspect(127.0.0.1:9229,chrome://inspect 自动发现)
 *   "0"                   → --inspect=0(自动空闲端口;多会话并发不冲突,从子进程
 *                           stderr 的 "Debugger listening on ws://…" 读实际端口)
 *   "<port>"(如 "9230")  → --inspect=<port>
 *   "brk" | "brk:<port>"  → --inspect-brk[=<port>](首行即断住,用于调 runner 启动链路)
 *
 * 注:每会话 spawn 一个 runner;固定端口下并发会话会抢占同端口,调试时建议一次只开一个
 * 会话,或用 PI_RUNNER_INSPECT=0 让每个子进程自动取空闲端口。
 */
function inspectFlag(env: Record<string, string>): string | undefined {
  const raw = (env["PI_RUNNER_INSPECT"] ?? "").trim().toLowerCase();
  if (raw === "") return undefined;
  const brk = raw === "brk" || raw.startsWith("brk:") || raw.startsWith("brk=");
  const base = brk ? "--inspect-brk" : "--inspect";
  if (raw === "1" || raw === "true" || raw === "on" || raw === "brk") return base;
  const port = raw.match(/(\d+)$/)?.[1];
  return port !== undefined ? `${base}=${port}` : base;
}

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
  // 调试:置于脚本路径前的 node inspector flag(由 PI_RUNNER_INSPECT 门控,缺省无)。
  const inspect = inspectFlag(env);
  const nodeArgs = inspect !== undefined ? [inspect] : [];
  // spec pi-web-desktop:子进程可执行文件读**已构造的 env** 里的 PI_WEB_NODE_BIN,
  // 缺省回退 "node"。桌面版(Electron 薄壳)注入自身「Electron 充当 Node」二进制路径
  // (process.execPath),使 runner 子进程在无系统 Node 的机器上也能启动;未注入时行为
  // 与改动前完全一致(CLI/dev 零回归)。读 env(非 process.env)保持本模块「不直接读
  // 进程全局环境」的纯函数不变式。
  const cmd = env["PI_WEB_NODE_BIN"] ?? "node";

  if (params.mode === "custom") {
    const runnerEntry = opts.runnerEntry;
    if (runnerEntry === undefined || runnerEntry === "") {
      throw new AgentSourceError(
        "MISSING_RUNNER_ENTRY",
        "custom mode requires opts.runnerEntry (absolute path to the runner bootstrap).",
      );
    }
    const args = [
      ...nodeArgs,
      runnerEntry,
      "--agent",
      params.entryPath,
      "--cwd",
      params.cwd,
      ...(opts.agentDir !== undefined ? ["--agent-dir", opts.agentDir] : []),
      ...fragment.extraArgs,
      ...(opts.extraArgs ?? []),
    ];
    return { cmd, args, cwd: params.cwd, env };
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
    ...nodeArgs,
    piCliEntry,
    "--mode",
    "rpc",
    ...fragment.extraArgs,
    ...(opts.extraArgs ?? []),
  ];
  return { cmd, args, cwd: params.cwd, env };
}

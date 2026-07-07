/**
 * 桌面壳:standalone server 受监管拉起(spec pi-web-desktop task 2.3,Req 1.1/1.2/1.4/1.5/4.4/5.1/5.2)。
 *
 * 职责:选空闲回环端口 → 以「Electron 充当 Node」方式 spawn standalone server(进程组组长,
 * 供 task 2.4 的整组收尾触达 runner 孙进程)→ 复用注入的就绪探针等待可用 → 返回 url/端口
 * 或判别式启动错误(无端口/早退/超时),失败时先收尾已拉起的进程(不留孤儿)。
 *
 * 依赖注入(与 resolveServerEntry 同风格):`findFreePort`/`waitForReady` 由 main(task 3.1)
 * 传入 bin/pi-web.mjs 的真实实现,使本模块可脱离 electron 与真实 CLI 脚本做集成测试。
 * 进程终止(stop)在 task 2.4 硬化(SIGKILL 宽限 / Windows taskkill / 幂等 / 端口释放)。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";

/** 与 bin/pi-web.mjs 就绪探针一致的超时(仅用于错误上报的语义,不驱动探针本身)。 */
const READY_TIMEOUT_MS = 60_000;
/** stderr 尾部保留上限(字节),用于早退失败诊断。 */
const STDERR_TAIL_LIMIT = 4096;
/** 优雅信号(SIGTERM)后等待进程组退出的宽限期,超时升级为 SIGKILL(task 2.4,Req 6.3)。 */
const STOP_GRACE_MS = 3_000;
/** stop 的兜底硬超时:即便 SIGKILL 后进程仍未被回收也不无限等待。 */
const STOP_HARD_MS = STOP_GRACE_MS + 2_000;

export interface ServerStartResult {
  readonly url: string;
  readonly port: number;
}

export type ServerStartError =
  | { readonly kind: "no-free-port"; readonly triedFrom: number }
  | { readonly kind: "early-exit"; readonly code: number | null; readonly stderrTail: string }
  | { readonly kind: "ready-timeout"; readonly timeoutMs: number };

export type ServerStartOutcome =
  | { readonly ok: true; readonly value: ServerStartResult }
  | { readonly ok: false; readonly error: ServerStartError };

export interface SupervisorDeps {
  /** 从 startPort 起找空闲端口;都被占返回 undefined(复用 bin/pi-web.mjs findFreePort)。 */
  readonly findFreePort: (
    host: string,
    startPort: number,
    maxTries?: number,
  ) => Promise<number | undefined>;
  /** 轮询直至就绪;signal.aborted 为真(server 早退)时应尽快 reject(复用 bin/pi-web.mjs waitForReady)。 */
  readonly waitForReady: (
    host: string,
    port: number,
    signal?: { readonly aborted: boolean },
  ) => Promise<void>;
}

export interface ServerStartOptions {
  readonly serverJs: string;
  readonly host: string;
  readonly startPort: number;
  /** 传给 server 子进程的基础环境(main 经 CLI buildEnv 组装,含 source/cwd 等)。 */
  readonly baseEnv: NodeJS.ProcessEnv;
}

export class ServerSupervisor {
  #child: ChildProcess | undefined;
  #port: number | undefined;
  readonly #deps: SupervisorDeps;

  constructor(deps: SupervisorDeps) {
    this.#deps = deps;
  }

  /** 当前受监管 server 的端口(就绪后有效),便于外部(退出收尾/诊断)读取。 */
  get port(): number | undefined {
    return this.#port;
  }

  /**
   * 选端口 → spawn(Electron-as-Node)→ 等就绪。失败返回判别式错误,且已收尾其 spawn 的进程。
   * 关键:server 与其派生的 runner 子进程用 `PI_WEB_NODE_BIN`=Electron 二进制(经 baseEnv 透传),
   * 使干净无 Node 机器可用(Req 4.4);仅回环 + 随机端口(Req 5.1/5.2)。
   */
  async start(opts: ServerStartOptions): Promise<ServerStartOutcome> {
    const port = await this.#deps.findFreePort(opts.host, opts.startPort, 20);
    if (port === undefined) {
      return { ok: false, error: { kind: "no-free-port", triedFrom: opts.startPort } };
    }
    this.#port = port;

    // server 子进程环境:base(含 source/cwd)+ 实际选中端口 + 回环主机 + 注入 Node 二进制与运行标记。
    // ELECTRON_RUN_AS_NODE 只进**子进程** env(主进程保持 GUI);经 baseEnv 透传链继续下达 runner。
    const env: NodeJS.ProcessEnv = {
      ...opts.baseEnv,
      PORT: String(port),
      HOSTNAME: opts.host,
      PI_WEB_NODE_BIN: process.execPath,
      ELECTRON_RUN_AS_NODE: "1",
    };

    const child = spawn(process.execPath, [opts.serverJs], {
      cwd: dirname(opts.serverJs),
      env,
      detached: true, // 成进程组组长:task 2.4 以负 pid 整组收尾,触达 runner 孙进程
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;

    let exited = false;
    let exitCode: number | null = null;
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
    });
    // 排空 stdout,避免管道缓冲填满阻塞子进程。
    child.stdout?.resume();
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
    });
    // spawn 失败(如 ENOENT)按早退处理。
    child.on("error", (err) => {
      exited = true;
      stderrTail = (stderrTail + `\n[spawn error] ${err.message}`).slice(-STDERR_TAIL_LIMIT);
    });

    try {
      await this.#deps.waitForReady(opts.host, port, {
        get aborted() {
          return exited;
        },
      });
    } catch {
      // 关键:先捕获「探针失败时 server 是否已自行退出」,再 stop 收尾。
      // 否则 stop() 杀掉仍存活的 server 会把 exited 置真 → 把 ready-timeout 误判成 early-exit。
      const exitedBeforeCleanup = exited;
      await this.stop();
      if (exitedBeforeCleanup) {
        return { ok: false, error: { kind: "early-exit", code: exitCode, stderrTail } };
      }
      return { ok: false, error: { kind: "ready-timeout", timeoutMs: READY_TIMEOUT_MS } };
    }

    return { ok: true, value: { url: `http://${displayHost(opts.host)}:${port}`, port } };
  }

  /**
   * 收尾受监管 server 进程**树**(task 2.4,Req 6.1/6.2/6.3/6.4)。幂等:多次调用安全。
   * - POSIX:对 detached 组长发**负 pid** SIGTERM(触达 runner 孙进程),宽限期后升级 SIGKILL。
   * - Windows:无 POSIX 信号 → `taskkill /PID <pid> /T /F`(/T 树 /F 强制)。
   * - 端口随进程退出释放(Req 6.4);不留孤儿(Req 6.2)。
   */
  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#port = undefined;
    if (child === undefined || child.pid === undefined) return;
    // 已自行退出 → 无需再杀(幂等/避免 await 永挂)。
    if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
    const pid = child.pid;

    if (process.platform === "win32") {
      await taskkillTree(pid);
      return;
    }

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    killGroup(child, "SIGTERM");
    const sigkill = setTimeout(() => killGroup(child, "SIGKILL"), STOP_GRACE_MS);
    try {
      await Promise.race([exited, delay(STOP_HARD_MS)]);
    } finally {
      clearTimeout(sigkill);
    }
  }
}

/** 对 detached 组长发**负 pid** 信号(整组);不可达时退回直杀直属子。 */
function killGroup(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 已退出/不可达 → 忽略。
    }
  }
}

/** Windows 进程树强制终止。 */
function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const tk = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    tk.on("exit", () => resolve());
    tk.on("error", () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 通配/未指定主机映射为可导航回环地址。 */
function displayHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

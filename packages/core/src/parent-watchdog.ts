/**
 * 父进程守望 —— 壳死则 server 自尽(spec: desktop-exit-orphan)。
 *
 * ## 为什么需要它
 *
 * 桌面壳退出时本应经 `RunEvent::ExitRequested → supervisor.stop()` 收尾 server 进程组。
 * 实测(2026-07-28)该路径**在 macOS 的 Apple Event 退出下根本不触发**:壳进程消失,
 * server 仍存活且 PPID=1,继续占着端口。
 *
 * 更要命的是,那条路径**天生**覆盖不了壳被 `SIGKILL` 的情形 —— 那时壳没有任何机会执行收尾。
 * 而 server 被刻意置为独立进程组组长(为了能整组杀 runner 孙进程),这同时也意味着
 * 它**不会**随父进程一起被内核回收。两件事叠加,孤儿几乎是必然。
 *
 * 后果不只是占端口:调试时打到的可能是上一次残留的实例,其内存里还留着旧登录态 ——
 * 已经据此误判过一次「登录状态还在」,直到查进程树才发现壳早已不存在。
 *
 * ## 判据:轮询而非 `process.ppid`
 *
 * 不能只看 `process.ppid === 1`:在容器与某些 init 下,合法启动时 ppid 也可能是 1。
 * 故由壳显式告知自己的 pid,server 定期用**信号 0**(只做存在性与权限检查,不真发信号)
 * 探测它是否还在。
 *
 * ## 只在桌面壳下启用
 *
 * `pnpm dev:server`、npm CLI、云端容器都不设 {@link SHELL_PID_ENV},守望器直接不启动 ——
 * 那些形态下「父进程没了」是正常的(nohup、systemd、docker),自尽反而是错的。
 */
import { createLogger } from "@blksails/pi-web-logger";

const logger = createLogger({ namespace: "server:parent-watchdog" });

/** 桌面壳自己的 pid,由 `build_child_env` 下发。 */
export const SHELL_PID_ENV = "PI_WEB_SHELL_PID";

/** 探测间隔。2s:壳退出后端口最多多占这么久,而空转开销可忽略。 */
export const WATCHDOG_INTERVAL_MS = 2_000;

export interface ParentWatchdogOptions {
  readonly env: NodeJS.ProcessEnv;
  /** 存在性探测(测试注入);缺省用信号 0。 */
  readonly isAlive?: (pid: number) => boolean;
  /** 壳消失时的动作(测试注入);缺省优雅退出本进程。 */
  readonly onParentGone?: () => void;
  readonly intervalMs?: number;
}

function defaultIsAlive(pid: number): boolean {
  try {
    // 信号 0:不投递信号,只检查目标是否存在且有权限。
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = 进程存在但不属于本用户 → 仍算活着(不该因权限问题自尽)。
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * 启动守望。
 *
 * @returns 停止函数;未启用(无 env / 值非法)时返回 `undefined`,调用方据此可知是否生效。
 */
export function startParentWatchdog(
  opts: ParentWatchdogOptions,
): (() => void) | undefined {
  const raw = opts.env[SHELL_PID_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const pid = Number(raw);
  // 非法值一律不启用 —— 宁可不守望,也不能因为解析出个 NaN 就把自己杀了。
  if (!Number.isInteger(pid) || pid <= 1) {
    logger.warn("parent watchdog disabled: invalid shell pid");
    return undefined;
  }

  const isAlive = opts.isAlive ?? defaultIsAlive;
  const onGone =
    opts.onParentGone ??
    (() => {
      logger.warn("desktop shell exited; shutting down to avoid orphaning");
      // 退出码 0:这是**预期内**的收尾,不是崩溃。用非零会让壳的早退诊断误报。
      process.exit(0);
    });

  const timer = setInterval(() => {
    if (!isAlive(pid)) {
      clearInterval(timer);
      onGone();
    }
  }, opts.intervalMs ?? WATCHDOG_INTERVAL_MS);
  // 守望器不该让事件循环因它而无法退出。
  timer.unref?.();
  return () => clearInterval(timer);
}

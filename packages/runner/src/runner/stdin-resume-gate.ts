/**
 * stdin-resume-gate — stdin 流动恢复判据与就绪帧发射(spec runner-ready-frame,C2)。
 *
 * ## 它在解决什么
 *
 * frame-channel 在 `runRpcMode` 之前挂 stdin 读取器并立即 `pause()`(frame-router.ts,
 * Req 1.2):早到的输入行从此**缓冲**而非被单方面消费丢失。但显式 pause 是**粘性**的 ——
 * pi 的 `attachJsonlLineReader` 只 `on("data")` 不 `resume()`(实测,research I1 第三行:
 * 无人 resume = 双向死锁)。所以 resume 的义务落在 runner 自己身上,本模块承担之。
 *
 * ## 判据(research I2 端到端实证)
 *
 * 安装时记 `baseline = listenerCount("data")`(此刻 frame-channel 与可能存在的
 * attachment-catalog 读取器已挂完)。此后再有 `"data"` 监听器加入的,只能是 pi
 * `runRpcMode` 末尾的读取器 —— 经 EventEmitter 标准 `newListener` 事件捕获。
 * ⚠ `newListener` 在监听器**加入之前**触发(Node 文档语义),故 `setImmediate` 一拍后
 * 核对 `listenerCount > baseline` 再动作。
 *
 * 命中 → `resume()` + `sendReady()`(发 `runner_ready` 帧,服务端收帧即 ready)。
 * 发帧无需等 pi 处理任何行:early 行已在缓冲区,resume 后自然送达全部读取器。
 *
 * ## 兜底(Req 1.4:可诊断失败,绝不静默死锁)
 *
 * pi 未来若改读取器实现(不再挂 `"data"`),判据永不命中 —— `fallbackMs`(默认 10s)
 * 超时后**强制** resume + sendReady + stderr 一行诊断。会话退化为「兜底延迟」,不是死锁。
 *
 * 竞态收敛:判据与兜底只执行**先到者**(`settled` 单向翻转),后到者无副作用。
 * 两个句柄均 `unref`(不钉进程);`dispose()` 幂等,并入 runner 统一释放清单。
 */
import type { GateReadableLike, NewListenerListener, WritableLike } from "./frame-channel/stream-views.js";

/** 兜底超时默认值(毫秒):判据失效时强制恢复流动的上限等待。 */
const DEFAULT_FALLBACK_MS = 10_000;

export interface StdinResumeGateDeps {
  /** 被治理的输入流(生产为 `process.stdin`;单测注入 EventEmitter 假流)。 */
  readonly stdin: GateReadableLike;
  /** 发送 `runner_ready` 帧(经 frame-channel 统一 fd1 writer)。 */
  readonly sendReady: () => void;
  /** 兜底路径诊断出口(默认 `process.stderr`)。 */
  readonly stderr?: WritableLike;
  /** 兜底超时(毫秒),默认 {@link DEFAULT_FALLBACK_MS}。 */
  readonly fallbackMs?: number;
}

export interface StdinResumeGate {
  /** 卸载 newListener 监听与兜底定时器(幂等)。已触发过 resume 的不撤销 resume。 */
  cleanup(): void;
}

/**
 * 装配 stdin 恢复门。在 runner `startRunner` 内、各桥(含 frame-channel 与可选的
 * attachment-catalog 读取器)全部挂载完成之后、`runRpcMode(runtime)` 之前调用 ——
 * baseline 的正确性依赖这个时点(之后新增的 data 监听器只会是 pi 的读取器)。
 */
export function installStdinResumeGate(deps: StdinResumeGateDeps): StdinResumeGate {
  const stderr = deps.stderr ?? process.stderr;
  const fallbackMs = deps.fallbackMs ?? DEFAULT_FALLBACK_MS;
  const { stdin, sendReady } = deps;

  const baseline = stdin.listenerCount("data");

  // 竞态收敛:判据、兜底、dispose 三方只认先到者。
  let settled = false;

  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let onNewListener: NewListenerListener | undefined;

  const cleanupHooks = (): void => {
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    if (onNewListener !== undefined) {
      stdin.off?.("newListener", onNewListener);
      onNewListener = undefined;
    }
  };

  const fire = (viaFallback: boolean): void => {
    if (settled) return;
    settled = true;
    cleanupHooks();
    if (viaFallback) {
      // Req 1.4:判据失效走到这里 —— 必须留下可诊断的痕迹,且仍恢复流动(退化非死锁)。
      stderr.write(
        `runner: stdin-resume-gate fallback fired after ${fallbackMs}ms ` +
          `(no new "data" listener observed; resuming stdin anyway)\n`,
      );
    }
    try {
      stdin.resume();
    } catch (err) {
      stderr.write(`runner: stdin-resume-gate resume error: ${String(err)}\n`);
    }
    try {
      sendReady();
    } catch (err) {
      stderr.write(`runner: stdin-resume-gate sendReady error: ${String(err)}\n`);
    }
  };

  onNewListener = (event: string): void => {
    if (event !== "data" || settled) return;
    // newListener 在监听器加入**之前**触发 → 等一拍再核对计数(research I2)。
    setImmediate(() => {
      if (settled) return;
      if (stdin.listenerCount("data") > baseline) fire(false);
    });
  };
  stdin.on("newListener", onNewListener);

  const timer = setTimeout(() => fire(true), fallbackMs);
  if (typeof timer.unref === "function") timer.unref();
  fallbackTimer = timer;

  return {
    cleanup(): void {
      if (settled) return;
      settled = true;
      cleanupHooks();
    },
  };
}

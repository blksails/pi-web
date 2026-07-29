/**
 * stop-turn — 「停止本轮」的决策逻辑(spec tool-abort-terminal-state)。
 *
 * 从 `PiChat.onStop` 提取为纯函数,便于独立测试:它的正确性关乎「点了停止 UI 会不会收尾」,
 * 而在 PiChat 内联时只能靠渲染整个聊天组件来验证,过于脆弱。
 *
 * ★ 核心约束:**abort 成功时不要本地停止**。本地停止(AI SDK `useChat().stop()`)会当场切断
 * SSE 流,导致后端在 abort 之后推送的「工具已取消」终态帧收不到,工具卡永久停在 Running。
 * 真机对照(2026-07-29):走本地 stop 的路径卡片一直转到 1:31;绕过它直接打 abort 端点,卡片
 * 立即 Completed、计时器定格 16.5s、显示「已取消」。后端一直是对的,错的是前端过早断流。
 *
 * 所以让终态由**后端帧驱动**,本地停止降级为三种兜底:无 abort 能力 / abort 抛错 / abort 成功
 * 但超时仍无终态帧。
 */

/** 等待后端终态帧的兜底时限;超时未收到即本地停止,避免界面无限停在运行态。 */
export const STOP_TERMINAL_FRAME_TIMEOUT_MS = 5000;

export interface RunStopTurnDeps {
  /** 会话级终止(`controls.abort`);缺省表示会话控制不可用。 */
  readonly abortTurn?: () => Promise<unknown>;
  /** 本地停止(切断前端流)。仅作兜底。 */
  readonly localStop: () => void;
  /** 兜底时限;缺省 {@link STOP_TERMINAL_FRAME_TIMEOUT_MS}。 */
  readonly timeoutMs?: number;
  /** 定时器注入(测试用)。 */
  readonly setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeoutImpl?: (handle: unknown) => void;
}

/** `runStopTurn` 的产出:用于取消挂起的兜底定时器(组件卸载时调用)。 */
export interface StopTurnHandle {
  /** 取消尚未触发的兜底定时器。幂等。 */
  readonly cancelFallback: () => void;
}

/**
 * 执行一次「停止本轮」。
 *
 * - 无 `abortTurn` → 直接本地停止(与引入本特性前行为一致)
 * - `abortTurn` 成功 → **不**本地停止,等终态帧;仅在超时后兜底
 * - `abortTurn` 失败 → 立即本地停止
 */
export function runStopTurn(deps: RunStopTurnDeps): StopTurnHandle {
  const {
    abortTurn,
    localStop,
    timeoutMs = STOP_TERMINAL_FRAME_TIMEOUT_MS,
    setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutImpl = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = deps;

  let handle: unknown;
  let cancelled = false;
  const cancelFallback = (): void => {
    cancelled = true;
    if (handle !== undefined) {
      clearTimeoutImpl(handle);
      handle = undefined;
    }
  };

  if (abortTurn === undefined) {
    localStop();
    return { cancelFallback };
  }

  void abortTurn().then(
    () => {
      // abort 已受理:正常情况下终态帧随即到达并驱动 UI 收尾,此处不动流。
      if (cancelled) return;
      handle = setTimeoutImpl(() => {
        handle = undefined;
        if (!cancelled) localStop();
      }, timeoutMs);
    },
    () => {
      if (!cancelled) localStop();
    },
  );
  return { cancelFallback };
}

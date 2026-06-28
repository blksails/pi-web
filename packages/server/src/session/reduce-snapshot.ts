/**
 * session-snapshot-authority — 会话快照纯归约(Functional Core)。
 *
 * `reduceSnapshot(prev, event, now)` 把单个 pi `AgentEvent` 归约为新的权威 `SessionSnapshot`。
 * 无 I/O、无副作用、不读全局时钟(`now` 由调用方注入,保证相同输入恒等输出,Req 7.1)。
 *
 * busy 语义(Req 2.x):
 *   - `agent_start` → 轮次开始:busy=true,turn.startedAt=now。
 *   - `agent_end`   → 轮次结束(覆盖正常/中止/错误,末态在 messages.stopReason):busy=false,清 turn。
 *   - 其余事件      → 不影响 busy/turn。
 * 扩展命令(registerCommand 本地执行)**不发 agent_start** → busy 永不置 true → 无永久卡死。
 *
 * 无变更时返回 `prev` 同一引用,便于调用方做「变更才广播」的判定。
 */
import type { AgentEvent, SessionSnapshot } from "@blksails/pi-web-protocol";

/** 权威快照初值:就绪态 initializing、未忙。 */
export const INITIAL_SNAPSHOT: SessionSnapshot = {
  lifecycle: "initializing",
  busy: false,
};

export function reduceSnapshot(
  prev: SessionSnapshot,
  event: AgentEvent,
  now: number,
): SessionSnapshot {
  switch (event.type) {
    case "agent_start":
      // 轮次开始:置忙并记录起始时刻。
      return { ...prev, busy: true, turn: { startedAt: now } };
    case "agent_end": {
      // 轮次结束:置闲并清轮次信息。无变更则返回原引用。
      if (!prev.busy && prev.turn === undefined) return prev;
      const { turn: _drop, ...rest } = prev;
      return { ...rest, busy: false };
    }
    default:
      // 其余事件不影响快照(busy/turn 由轮次边界决定)。
      return prev;
  }
}

/**
 * session-snapshot-authority — 粘性帧注册表(StickyFrameRegistry)。
 *
 * 把「晚订阅者收敛到最新 last-value」从 PiSession.subscribe() 里硬编码的两帧(logs+lifecycle)
 * 泛化为一张按键的 last-value 表:任一「权威状态」的最新帧写入对应键,新订阅者订阅时
 * 一次性重放全部键的当前帧。新增一种可重放状态只需注册键(Req 4.2),无需改订阅核心流程。
 *
 * 仅承载 **last-value** 语义的粘性态(如 session-status / session-state)。logs 是 ring-buffer
 * (历史批量)语义,不同于 last-value,仍由 PiSession 单独回放,不并入本表。
 */
import type { SseFrame } from "@blksails/pi-web-protocol";

export class StickyFrameRegistry {
  /** 键 → 该键最新一帧。插入序即重放序。 */
  private readonly last = new Map<string, SseFrame>();

  /** 写入/覆盖某键的最新帧(同键多次写入仅留最新,Req 4.4)。 */
  set(key: string, frame: SseFrame): void {
    this.last.set(key, frame);
  }

  /** 读取某键当前帧(测试/诊断用)。 */
  get(key: string): SseFrame | undefined {
    return this.last.get(key);
  }

  /** 当前注册的键(测试/诊断用)。 */
  keys(): readonly string[] {
    return [...this.last.keys()];
  }

  /** 向新订阅者按插入序重放全部键的当前帧(Req 4.1）。 */
  replayInto(emit: (frame: SseFrame) => void): void {
    for (const frame of this.last.values()) emit(frame);
  }
}

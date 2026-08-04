/**
 * trailing-throttle — 尾沿节流器。
 *
 * 自 `PiSession.emitAttachmentEventThrottled` 提出(H1 职责簇拆分)。原实现是三个私有字段
 * (`lastEmitAt` / `timer` / `pendingPayload`)加一个方法散在 1600 行的会话类里,收尾时还要
 * 在 `cleanup` 里单独记得清那个 timer —— 忘了清就是「会话已收尾仍触发 emitter.emit」。
 *
 * 语义(与原实现逐字一致):
 *  - 距上次发出 ≥ 窗口 → **立即**发出(首次调用必然立即发出);
 *  - 否则挂起**最新**载荷,窗口到期后补发一次。窗口内的多次 push 只保留最后一条 ——
 *    调用方的语义是「通知有变化」而非「逐条事件」,合并无损(面板收到后是全量重拉)。
 *
 * ⚠ 合并即丢弃中间值。若某个使用场景需要「每条都送达」,**不要**改本类去兼容两种语义,
 *   那会让两个调用点互相牵制;另建一个队列型转发器。
 */

/** 尾沿节流器。`T` 是载荷类型。 */
export class TrailingThrottle<T> {
  private lastEmitAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: T | undefined;

  /**
   * @param windowMs 节流窗口(毫秒)。
   * @param emit     实际发出载荷。**同步**调用;抛错会冒泡到 `push` 或定时器回调。
   */
  constructor(
    private readonly windowMs: number,
    private readonly emit: (payload: T) => void,
  ) {}

  /** 送入一条载荷:或立即发出,或合并进挂起位等窗口到期。 */
  push(payload: T): void {
    const now = Date.now();
    if (this.lastEmitAt === undefined || now - this.lastEmitAt >= this.windowMs) {
      this.lastEmitAt = now;
      this.emit(payload);
      return;
    }
    this.pending = payload;
    if (this.timer === undefined) {
      const delay = this.windowMs - (now - this.lastEmitAt);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (this.pending !== undefined) {
          this.lastEmitAt = Date.now();
          this.emit(this.pending);
          this.pending = undefined;
        }
      }, delay);
    }
  }

  /**
   * 释放:清定时器并丢弃挂起载荷。
   *
   * ★ **丢弃而非补发**是刻意的:调用方(会话收尾)已经在拆监听器,此时补发只会打到一个
   *   正在消失的 emitter 上。原实现在 `cleanup` 里就是这个语义,只是那时它是一段裸的
   *   `if (timer !== undefined) clearTimeout(timer)`。
   */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending = undefined;
  }
}

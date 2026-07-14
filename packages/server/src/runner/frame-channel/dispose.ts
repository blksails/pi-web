/**
 * frame-channel · 统一释放原语(Req 6.3)。
 *
 * 取代 runner 收尾里五段雷同的 try/catch:遍历接线 `cleanup()`,单个抛错 → 记诊断并继续释放
 * 其余,绝不因单点失败中断收尾。支持同步与异步 `cleanup`(异步拒绝以 `void p.catch` 收敛)。永不抛。
 */

/** 可释放接线的最小视图。 */
export interface Disposable {
  cleanup(): void | Promise<void>;
}

/**
 * 依次释放全部接线,吞错续跑。
 *
 * @param wirings 接线数组(允许 `null`/`undefined` 占位,跳过)。
 * @param log     诊断出口(默认 `process.stderr`)。
 */
export function disposeAll(
  wirings: readonly (Disposable | null | undefined)[],
  log: { write(s: string): unknown } = process.stderr,
): void {
  for (const w of wirings) {
    if (w === null || w === undefined) continue;
    try {
      const maybe = w.cleanup();
      void Promise.resolve(maybe).catch((err) => {
        log.write(`runner: dispose cleanup error: ${String(err)}\n`);
      });
    } catch (err) {
      log.write(`runner: dispose cleanup error: ${String(err)}\n`);
    }
  }
}

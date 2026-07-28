/**
 * 限并发批量映射(spec `upload-image-compression`,Req 5)。
 *
 * **为什么需要**:附件添加原本用无上限 `Promise.all`,一次拖入 20 张图会同时存在 20 份
 * 解码副本(单张 4000×3000 的位图约 48MB)。该隐患在压缩引入**之前就已存在**(20 份
 * base64 同时驻留),压缩只是让它更显著 —— 故这是独立的价值项,不是压缩的附属。
 *
 * 语义与 `Promise.all` 对齐:**保序**、**不吞错**;差别仅在同时在飞的任务数受限。
 */

/**
 * 以受限并发映射数组,结果顺序与输入严格一致。
 *
 * @param limit 同时在飞的最大任务数;`<= 0` 视为 1。
 * @throws 任一任务 reject 即整体 reject(与 `Promise.all` 一致,不吞错)。
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const out = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  let cursor = 0;

  // 每个 worker 自取下一个待处理下标 —— 天然负载均衡(慢任务不会拖住整批),
  // 且同时在飞的任务数恒等于 worker 数。
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await fn(items[index] as T, index);
      }
    }),
  );

  return out;
}

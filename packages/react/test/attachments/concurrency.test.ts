/**
 * 限并发批量映射 单元测试(spec `upload-image-compression`,任务 2.2)。
 *
 * 关注三件事:并发峰值受限(Req 5.1)、结果保序(Req 5.3)、错误不被吞(与 Promise.all 一致)。
 */
import { describe, it, expect } from "vitest";
import { mapWithLimit } from "../../src/attachments/concurrency.js";

/** 可手工放行的 deferred,用于精确观察并发峰值。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithLimit", () => {
  it("★同时在飞的任务数不超过上限(Req 5.1)", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;

    const out = await mapWithLimit(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3); // 并非串行 —— 确实并行到了上限
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it("★结果顺序与输入一致,即便完成顺序被打乱(Req 5.3)", async () => {
    const delays = [30, 1, 20, 2, 10];
    const out = await mapWithLimit(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `#${i}`;
    });
    expect(out).toEqual(["#0", "#1", "#2", "#3", "#4"]);
  });

  it("index 参数正确传入", async () => {
    const out = await mapWithLimit(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("任一任务失败 → 整体 reject(不吞错,与 Promise.all 一致)", async () => {
    const boom = new Error("task failed");
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw boom;
        return n;
      }),
    ).rejects.toBe(boom);
  });

  it("空数组 → 立即返回空,不调用 fn", async () => {
    let calls = 0;
    const out = await mapWithLimit([], 3, async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("上限非法(0 / 负数 / NaN)→ 退化为串行而非死锁", async () => {
    for (const limit of [0, -5, Number.NaN]) {
      const out = await mapWithLimit([1, 2, 3], limit, async (n) => n * 3);
      expect(out).toEqual([3, 6, 9]);
    }
  });

  it("上限大于元素数 → 不会创建多余 worker,结果正确", async () => {
    const gate = deferred<void>();
    let started = 0;
    const p = mapWithLimit([1, 2], 100, async (n) => {
      started++;
      await gate.promise;
      return n;
    });
    await Promise.resolve();
    expect(started).toBeLessThanOrEqual(2);
    gate.resolve();
    await expect(p).resolves.toEqual([1, 2]);
  });
});

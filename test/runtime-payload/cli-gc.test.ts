/**
 * CLI 侧运行时回收的健壮性（spec shared-runtime-payload 任务 4.2，Req 5.4/5.5）。
 *
 * GC 是**尽力而为**的：它在后端已拉起之后触发，任何失败都必须被吞掉。若它能把异常
 * 冒泡出去，一次回收失败就会拖垮一个本已正常服务的进程。
 */
import { describe, expect, it } from "vitest";
import { scheduleRuntimeGc } from "../../bin/pi-web.mjs";

/** 让 fire-and-forget 的微任务跑完。 */
const flush = () => new Promise((r) => setTimeout(r, 50));

describe("scheduleRuntimeGc", () => {
  it("无运行时信息时直接跳过（走仓库 dist/ 分支的场景）", async () => {
    expect(() => scheduleRuntimeGc(undefined)).not.toThrow();
    await flush();
  });

  it("解包器不存在时不抛出，也不产生未捕获拒绝", async () => {
    // 仓库检出但未 `pnpm build:dist` 时，payload/unpack.mjs 不存在 ⇒ loadUnpacker 抛错。
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() =>
        scheduleRuntimeGc({ runtimeRoot: "/nonexistent-runtime-root", runtimeDir: "0.0.0-000000000000" }),
      ).not.toThrow();
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("运行时根不存在时 gc 静默返回，不影响调用方", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      scheduleRuntimeGc({ runtimeRoot: "/definitely/not/here", runtimeDir: "9.9.9-aaaaaaaaaaaa" });
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

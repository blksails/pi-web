/**
 * CLI 侧运行时回收的健壮性（spec shared-runtime-payload 任务 4.2，Req 5.4/5.5）。
 *
 * GC 是**尽力而为**的：它在后端已拉起之后触发，任何失败都必须被吞掉。若它能把异常
 * 冒泡出去，一次回收失败就会拖垮一个本已正常服务的进程。
 *
 * ★ 「解包器缺失」这条分支必须被**强制**触发，不能依赖 `payload/` 恰好没被构建：
 *   标准流程是先 `pnpm build:dist` 再跑测试，那时 `payload/unpack.mjs` 是存在的，
 *   测试会静默退化成另一个用例的重复，看起来绿，实则什么也没验。故经注入接缝断言。
 */
import { describe, expect, it, vi } from "vitest";
import { scheduleRuntimeGc } from "../../bin/pi-web.mjs";

/** 让 fire-and-forget 的微任务跑完。 */
const flush = () => new Promise((r) => setTimeout(r, 60));

/** 捕获未捕获拒绝——GC 一旦泄漏异常，正在服务的 CLI 进程就会被拖垮。 */
async function expectNoUnhandledRejection(fn: () => void) {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    expect(fn).not.toThrow();
    await flush();
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

const RUNTIME = { runtimeRoot: "/nonexistent-runtime-root", runtimeDir: "9.9.9-aaaaaaaaaaaa" };

describe("scheduleRuntimeGc", () => {
  it("无运行时信息时直接跳过（走仓库 dist/ 分支的场景），不加载解包器", async () => {
    const load = vi.fn();
    scheduleRuntimeGc(undefined, load);
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it("解包器缺失（load 抛错）时不抛出，也不产生未捕获拒绝", async () => {
    const load = vi.fn(() => {
      throw new Error("Cannot find module 'payload/unpack.mjs'");
    });
    await expectNoUnhandledRejection(() => scheduleRuntimeGc(RUNTIME, load));
    expect(load).toHaveBeenCalledOnce(); // 证明确实走到了那条分支
  });

  it("gcRuntimeRoot 本身抛错时被吞掉", async () => {
    const gcRuntimeRoot = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    await expectNoUnhandledRejection(() => scheduleRuntimeGc(RUNTIME, () => ({ gcRuntimeRoot })));
    expect(gcRuntimeRoot).toHaveBeenCalledOnce();
  });

  it("正常路径：以 keepDir = 当前运行时目录调用 gcRuntimeRoot", async () => {
    const gcRuntimeRoot = vi.fn(async () => ({ removed: [], failed: [] }));
    scheduleRuntimeGc(RUNTIME, () => ({ gcRuntimeRoot }));
    await flush();
    expect(gcRuntimeRoot).toHaveBeenCalledWith(RUNTIME.runtimeRoot, RUNTIME.runtimeDir);
  });

  it("真实解包器 + 不存在的运行时根 → 静默返回空报告，不抛出", async () => {
    // 这条用真实的 loadUnpacker（默认参数），覆盖注入接缝之外的实际接线。
    await expectNoUnhandledRejection(() => scheduleRuntimeGc(RUNTIME));
  });
});

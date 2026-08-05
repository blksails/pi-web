/**
 * 几何链路的可判别性（spec desktop-pane-chrome-occlusion，任务 1.1）。
 *
 * ★ 判据选取的核心：本缺陷的每一环原本都「不报错、也不留痕」，四层 fail-soft 叠加起来
 *   等于零报错。所以断言不能只验「正常路径能跑通」——那在改动前就已经是绿的。
 *   每条用例都必须锁住一个**此前无法分辨的区别**：
 *     - 「没量到」与「量到 0」
 *     - 「命令报错」与「本来就不是 native」
 *     - 「上报送达」与「上报失败但被吞掉」
 *
 * ★ 模块级 `lastMetricsKey` 会跨用例保留，故各用例的槽几何取值互不相同，避免被去重跳过。
 */
import { describe, expect, it, vi } from "vitest";
import {
  ensureTauriContentWellMetrics,
  isTauriNativePaneLayout,
  measureContentWell,
  probeTauriNativePaneLayout,
  setTauriPaneLayoutMetrics,
} from "../src/adapters/tauri-runtime.js";

/** 造一个可控的 content-well。 */
function makeWell(
  rect: { left: number; top: number; width: number; height: number },
  connected = true,
): Element {
  return {
    isConnected: connected,
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  } as unknown as Element;
}

function makeTarget(invoke: (cmd: string) => Promise<unknown>): Window {
  return {
    innerHeight: 900,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
    __TAURI__: {
      core: { invoke: vi.fn(invoke) },
      window: { getCurrentWindow: () => ({}) },
    },
  } as unknown as Window;
}

describe("measureContentWell — 「没量到」与「量到 0」必须可分辨", () => {
  it("元素已摘除 → unavailable/detached，且不谎报 rect", () => {
    const outcome = measureContentWell(
      makeWell({ left: 0, top: 0, width: 400, height: 700 }, false),
      makeTarget(() => Promise.resolve()),
      240,
    );
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind !== "unavailable") throw new Error("unreachable");
    expect(outcome.reason).toBe("detached");
    // 元素已摘除时拿不到可信矩形，必须是 undefined 而非 0×0——后者会被读成「量到了 0」。
    expect(outcome.rect).toBeUndefined();
  });

  it("槽尺寸不足 → unavailable/too-small，并**带出实测数值**", () => {
    const outcome = measureContentWell(
      makeWell({ left: 10, top: 12, width: 30, height: 20 }),
      makeTarget(() => Promise.resolve()),
      240,
    );
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind !== "unavailable") throw new Error("unreachable");
    expect(outcome.reason).toBe("too-small");
    // ★ 只断言 reason 不够：一个「留了空痕」的实现同样能通过。被丢弃的数值本身
    //   才是真机上判别 C2（首帧未布局）的证据，必须逐字段锁住。
    expect(outcome.rect).toEqual({ width: 30, height: 20 });
  });

  it("正常槽 → measured，顶边取 rect.top（chrome 高度即由此而来）", () => {
    const outcome = measureContentWell(
      makeWell({ left: 500, top: 44, width: 380, height: 700 }),
      makeTarget(() => Promise.resolve()),
      240,
    );
    expect(outcome.kind).toBe("measured");
    if (outcome.kind !== "measured") throw new Error("unreachable");
    expect(outcome.metrics.topHeight).toBe(44);
    expect(outcome.metrics.leftWidth).toBe(500);
    expect(outcome.metrics.paneWidth).toBe(380);
    expect(outcome.metrics.bottomHeight).toBe(900 - (44 + 700));
  });
});

describe("probeTauriNativePaneLayout — 「命令报错」与「非 native」必须可分辨", () => {
  it("命令返回 true → native", async () => {
    const probe = await probeTauriNativePaneLayout(makeTarget(() => Promise.resolve(true)));
    expect(probe.kind).toBe("native");
  });

  it("命令返回 false → not-native", async () => {
    const probe = await probeTauriNativePaneLayout(makeTarget(() => Promise.resolve(false)));
    expect(probe.kind).toBe("not-native");
  });

  it("命令报错 → query-failed，并带出原因", async () => {
    const probe = await probeTauriNativePaneLayout(
      makeTarget(() => Promise.reject(new Error("PANE_RELAY_NOT_HOST"))),
    );
    expect(probe.kind).toBe("query-failed");
    if (probe.kind !== "query-failed") throw new Error("unreachable");
    expect(probe.reason).toContain("PANE_RELAY_NOT_HOST");
  });

  it("非 Tauri 宿主 → no-runtime（既不是故障也不是 not-native）", async () => {
    const probe = await probeTauriNativePaneLayout({} as unknown as Window);
    expect(probe.kind).toBe("no-runtime");
  });

  it("★ 三种「非 native」在探测结果上互不相同，而布尔形态一律为 false", async () => {
    // 这条是本组的判别核心。改动前 isTauriNativePaneLayout 把三者压成同一个 false，
    // 于是「几何上报整条没装」与「本来就是网页形态」无法区分——正是本缺陷查不出来的原因。
    const notNative = await probeTauriNativePaneLayout(makeTarget(() => Promise.resolve(false)));
    const failed = await probeTauriNativePaneLayout(
      makeTarget(() => Promise.reject(new Error("boom"))),
    );
    const noRuntime = await probeTauriNativePaneLayout({} as unknown as Window);
    const kinds = new Set([notNative.kind, failed.kind, noRuntime.kind]);
    expect(kinds.size).toBe(3);

    for (const target of [
      makeTarget(() => Promise.resolve(false)),
      makeTarget(() => Promise.reject(new Error("boom"))),
    ]) {
      expect(await isTauriNativePaneLayout(target)).toBe(false);
    }
  });
});

describe("setTauriPaneLayoutMetrics — 上报失败不得被吞掉", () => {
  it("送达 → delivered", async () => {
    const outcome = await setTauriPaneLayoutMetrics(
      { paneWidth: 361, minWidth: 240 },
      makeTarget(() => Promise.resolve()),
    );
    expect(outcome.kind).toBe("delivered");
  });

  it("布局侧拒绝 → failed 且带出原因，**且不抛逸**", async () => {
    // ★ 原实现没有 catch：拒绝会成为未处理的异步拒绝，既不报错也不改变流程。
    //   若谁把 catch 去掉，本用例会因 rejection 而红，而不是悄悄变回原样。
    const outcome = await setTauriPaneLayoutMetrics(
      { paneWidth: 362, minWidth: 240 },
      makeTarget(() => Promise.reject(new Error("PANE_LAYOUT_INVALID_METRICS"))),
    );
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toContain("PANE_LAYOUT_INVALID_METRICS");
  });
});

describe("ensureTauriContentWellMetrics — 调用方能判断布局侧是否已处于已知态", () => {
  it("量到并送达 → delivered", async () => {
    const outcome = await ensureTauriContentWellMetrics(
      makeWell({ left: 501, top: 46, width: 381, height: 701 }),
      { minWidth: 240, target: makeTarget(() => Promise.resolve()), force: true },
    );
    expect(outcome.kind).toBe("delivered");
  });

  it("★ 没量到 → not-measured（而非静默的「跳过」）", async () => {
    // 这条是任务 3.1「几何未送达则不放行 show」的前提：改动前本函数无论量没量到都返回
    // void，调用方无从判断，于是照样 show，pane 就停在布局侧的默认矩形上盖住 chrome。
    const outcome = await ensureTauriContentWellMetrics(
      makeWell({ left: 0, top: 0, width: 12, height: 12 }),
      { minWidth: 240, target: makeTarget(() => Promise.resolve()), force: true },
    );
    expect(outcome.kind).toBe("not-measured");
    if (outcome.kind !== "not-measured") throw new Error("unreachable");
    expect(outcome.reason).toBe("too-small");
  });

  it("★ 载荷要么带顶边、要么根本不发——绝不发一个「确定的 0」", async () => {
    // 布局侧把缺席的顶边解释为「未知」。若前端在量不到时补发 topHeight: 0，
    // 布局侧收到的就是一个确定值，可选化形同虚设，缺陷原样复活。
    const invoke = vi.fn(
      (_cmd: string, _args?: { readonly metrics?: Record<string, number> }) =>
        Promise.resolve(),
    );
    const target = {
      innerHeight: 900,
      requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 1; },
      cancelAnimationFrame: () => undefined,
      __TAURI__: { core: { invoke }, window: { getCurrentWindow: () => ({}) } },
    } as unknown as Window;

    // 量不到：一次 IPC 都不该发出。
    await ensureTauriContentWellMetrics(
      makeWell({ left: 0, top: 0, width: 10, height: 10 }),
      { minWidth: 240, target, force: true },
    );
    expect(invoke).not.toHaveBeenCalled();

    // 量得到：顶边必须如实带上。
    await ensureTauriContentWellMetrics(
      makeWell({ left: 504, top: 52, width: 384, height: 704 }),
      { minWidth: 240, target, force: true },
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[1]?.metrics?.topHeight).toBe(52);
  });

  it("量到但送达失败 → failed（不得报成 delivered）", async () => {
    const outcome = await ensureTauriContentWellMetrics(
      makeWell({ left: 503, top: 48, width: 383, height: 703 }),
      {
        minWidth: 240,
        target: makeTarget(() => Promise.reject(new Error("nope"))),
        force: true,
      },
    );
    expect(outcome.kind).toBe("failed");
  });
});

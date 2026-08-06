/**
 * 原生 pane 显示门控（spec desktop-pane-chrome-occlusion，任务 4.1 —— 补 3.1 的直接断言）。
 *
 * ★ 这条断言的来历值得记一笔：先前两次都没写成。
 *   第一版走 React 宿主，断言「几何未送达则 actions 不含 show」——**是重言式**：
 *   把门控整个删掉照样 17/17 绿，因为握手压根没走完，show 本就不会发生。
 *   第二版补齐握手，卡在「`pane_layout_is_native` 为真时内容 pane 在 jsdom 下不被创建」
 *   （relayListeners 已就绪、载体 ready 已发，`created` 仍为 0）。
 *
 *   所以这次改为把判定抽成纯函数再穷举。判据的有效性以「删掉任一条件都有用例变红」
 *   为准，下面每条都按这个标准挑过。
 */
import { describe, expect, it } from "vitest";
import {
  shouldShowNativePane,
  type NativeShowGateInput,
} from "../src/react/native-show-gate.js";

/** 全部条件都满足的基线；各用例只翻转一个字段，保证「是这一条起了作用」。 */
const ok: NativeShowGateInput = {
  chromeVisible: true,
  requiresGeometry: true,
  geometry: "delivered",
  isActiveInstance: true,
  isParked: false,
};

describe("shouldShowNativePane", () => {
  it("五个条件全满足 → 放行", () => {
    expect(shouldShowNativePane(ok)).toBe(true);
  });

  it("★ 需要几何但未送达 → 不放行（本 spec 唯一的行为变更）", () => {
    // 改动前：量不到几何也照样 show，pane 停在布局侧默认矩形（y=0、铺满全高）上，
    // 恰好盖住 tab 栏。删掉门控里的几何条件，本条即红。
    expect(shouldShowNativePane({ ...ok, geometry: "pending" })).toBe(false);
  });

  it("★ 不需要几何时，几何未送达不影响放行", () => {
    // 非原生布局下 Rust 不拥有 child 的 bounds，不存在「盖住 chrome 的槽」。
    // 少了这一条，回退形态与 jsdom 下会被白白挡住 show —— 既有用例
    // auto-selects-an-embedded-Tauri-WebView-carrier 正是靠这条才不红。
    expect(shouldShowNativePane({
      ...ok,
      requiresGeometry: false,
      geometry: "pending",
    })).toBe(true);
  });

  it("chrome 折叠 → 不放行（既有行为，不得回归）", () => {
    expect(shouldShowNativePane({ ...ok, chromeVisible: false })).toBe(false);
  });

  it("已不是活动实例 → 不放行（异步等待期间被切走）", () => {
    expect(shouldShowNativePane({ ...ok, isActiveInstance: false })).toBe(false);
  });

  it("已停靠 → 不放行", () => {
    expect(shouldShowNativePane({ ...ok, isParked: true })).toBe(false);
  });

  it("★ 每个条件都是必要的：逐个翻转，全部必须变成不放行", () => {
    // 穷举式的必要性检查。任一条件被从实现里删掉，这里就会有一项漏网。
    const flips: ReadonlyArray<readonly [string, Partial<NativeShowGateInput>]> = [
      ["chromeVisible", { chromeVisible: false }],
      ["geometry", { geometry: "pending" }],
      ["isActiveInstance", { isActiveInstance: false }],
      ["isParked", { isParked: true }],
    ];
    for (const [name, patch] of flips) {
      expect(shouldShowNativePane({ ...ok, ...patch }), `翻转 ${name} 后仍放行`)
        .toBe(false);
    }
  });

  it("chrome 折叠时即便几何已到也不放行（条件是与，不是或）", () => {
    // 只测「各自单独否决」挡不住把 && 写成 || 这种错法。
    expect(shouldShowNativePane({
      ...ok,
      chromeVisible: false,
      geometry: "delivered",
    })).toBe(false);
    expect(shouldShowNativePane({
      ...ok,
      chromeVisible: true,
      geometry: "pending",
      isActiveInstance: false,
    })).toBe(false);
  });
});

// @vitest-environment jsdom
/**
 * overlay 菜单落位的坐标空间（spec desktop-native-webview-chrome-dead，任务 3）。
 *
 * ★ 事故形态：macOS 原生 child WKWebView 里 window.screenX/screenY 与 Tauri
 *   inner_position 不在同一坐标空间（多显示器实测偏差数百 px）。前端用 screenX 拼
 *   「屏幕坐标」、Rust 再减 inner_position——差值直接把 overlay 菜单放到窗口外：
 *   点「+」事件到达按钮、菜单"打开"了，但用户看不到任何反应。
 *
 * 判据：给 target 塞一个**毒化的 screenX**（与 innerPosition 相差悬殊），断言
 * create 的矩形以 innerPosition 为原点。旧实现优先 screenX，本测试必红。
 */
import { describe, expect, it, vi } from "vitest";
import { createGlobalTauriPaneOverlay } from "../src/adapters/tauri-runtime.js";

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("createGlobalTauriPaneOverlay — 落位原点", () => {
  it("★ open 矩形以 Tauri innerPosition 为原点，绝不用毒化的 window.screenX", async () => {
    vi.stubGlobal("ResizeObserver", InertResizeObserver);
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const invoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return Promise.resolve();
    });
    const target = {
      // 毒化值：若实现读它，产出的 x 会带上 5000/3000 的量级，必被断言抓住。
      screenX: 5000,
      screenY: 3000,
      location: { href: "http://127.0.0.1:3000/" },
      // 不执行回调的 rAF：观察器路径与本判据无关，防同步递归。
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      performance: { now: () => 0 },
      __TAURI__: {
        core: { invoke },
        event: { listen: vi.fn(() => Promise.resolve(() => undefined)) },
        window: {
          getCurrentWindow: () => ({
            // 物理 px；scale=2 → 逻辑原点 (100, 50)。
            innerPosition: () => Promise.resolve({ x: 200, y: 100 }),
            scaleFactor: () => Promise.resolve(2),
          }),
        },
      },
    } as unknown as Window;

    const controller = createGlobalTauriPaneOverlay(target);
    expect(controller).toBeDefined();

    const cover = document.createElement("div");
    Object.defineProperty(cover, "getBoundingClientRect", {
      value: () => ({
        left: 30, top: 40, width: 300, height: 200,
        right: 330, bottom: 240, x: 30, y: 40, toJSON: () => ({}),
      }),
    });
    document.body.appendChild(cover);

    await controller!.open({
      title: "菜单",
      items: [{ id: "a", label: "A" }],
      cover,
    } as never);

    const creates = calls.filter((c) => c.cmd === "pane_webview_window_create");
    expect(creates.length).toBeGreaterThan(0);

    // 打开时的可见 create：origin(100,50) + rect(30,40) = (130,90)。
    const visibleCreate = creates.find((c) => c.args?.visible === true);
    expect(visibleCreate).toBeDefined();
    expect(visibleCreate!.args).toMatchObject({ x: 130, y: 90, width: 300, height: 200 });

    // 预热壳的屏外停放同理以 innerPosition 为原点：(100-200, 50-200)。
    const parkedCreate = creates.find((c) => c.args?.visible === false);
    if (parkedCreate !== undefined) {
      expect(parkedCreate.args).toMatchObject({ x: -100, y: -150 });
    }
    vi.unstubAllGlobals();
  });
});

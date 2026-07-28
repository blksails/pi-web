// @vitest-environment jsdom
/**
 * 「工作台该打开哪张图」的**跨 realm 出口**(`canvasFocusStore`;isolated-panes Wave 5)。
 *
 * ## 为什么必须有这个文件
 *
 * 「点聊天工具卡的图 → 进 Canvas 编辑」此前**两条车道都零测试覆盖**:
 * `packages/ui/test/canvas/canvas-workbench.test.tsx` 里的 `data-att-id` 断言测的是
 * 工作台**内部**的引用 chip,不是从聊天流来的 document 委托。
 *
 * 而 pane 化恰恰改动了这条路径:`CanvasPanel` 挂的 document 监听在 pane 形态下落进 iframe,
 * 收不到宿主的点击,于是该功能整个失效。修法是把「目标图」抽成可订阅 store,让两条车道
 * 共用同一出口:
 *
 *   槽形态:  document 监听(与聊天同 realm)──┐
 *                                          ├─→ canvasFocusStore → CanvasPanel
 *   pane 形态:宿主监听 → pane:signal ───────┘
 *
 * 本文件同时锁住两条入口 —— 少测任一条,分叉都会静默发生。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasPanel } from "../src/canvas-launcher.js";
import { canvasFocusStore, canvasOpenStore } from "../src/use-canvas-view.js";

const STATE_KEY = "surface:canvas";

function asset(id: string): GalleryAsset {
  return {
    attachmentId: id,
    displayUrl: `/att/${id}`,
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: "2026-07-02T10:00:00.000Z",
    origin: "tool-output",
  };
}

function fakeSurface(assets: GalleryAsset[]): WebExtSurfaceAccess {
  return {
    run: vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true })),
    getState: <T,>(k: string) => (k === STATE_KEY ? ({ assets } as T) : undefined),
    subscribe: () => () => undefined,
    hasCommand: () => true,
  };
}

/** 造一张与对话流工具卡同形的图(判定条件:`[data-pi-tool-images]` 内、带 `data-att-id`)。 */
function mountToolCardImage(attachmentId: string): HTMLImageElement {
  const card = document.createElement("div");
  card.setAttribute("data-pi-tool-images", "true");
  const img = document.createElement("img");
  img.setAttribute("data-att-id", attachmentId);
  card.appendChild(img);
  document.body.appendChild(card);
  return img;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  canvasOpenStore.set(true);
  canvasFocusStore.set(null);
});

afterEach(() => {
  cleanup();
  document.body.querySelectorAll("[data-pi-tool-images]").forEach((el) => el.remove());
});

describe("canvasFocusStore —— 工作台目标图的跨 realm 出口", () => {
  it("槽车道:点工具卡的图 → 经 store 展开该图的工作台", async () => {
    render(<CanvasPanel enabled surface={fakeSurface([asset("att_1"), asset("att_2")])} />);
    const img = mountToolCardImage("att_2");

    // 未点击前是画廊,不是工作台。
    expect(document.querySelector("[data-canvas-workbench]")).toBeNull();

    fireEvent.click(img);

    await waitFor(() =>
      expect(document.querySelector("[data-canvas-workbench]")).toBeTruthy(),
    );
  });

  it("pane 车道:直接写 store(宿主经 pane:signal 下发的落点)→ 同样展开工作台", async () => {
    render(<CanvasPanel enabled surface={fakeSurface([asset("att_1"), asset("att_2")])} />);
    expect(document.querySelector("[data-canvas-workbench]")).toBeNull();

    // pane 侧收到 `canvas:focus` 信号后做的就是这一句;它与上一条用例走的是同一出口。
    act(() => canvasFocusStore.set("att_2"));

    await waitFor(() =>
      expect(document.querySelector("[data-canvas-workbench]")).toBeTruthy(),
    );
  });

  it("★ 一次性意图:消费后 store 清空,关掉工作台不会被立刻拉回同一张图", async () => {
    render(<CanvasPanel enabled surface={fakeSurface([asset("att_1")])} />);
    act(() => canvasFocusStore.set("att_1"));
    await waitFor(() =>
      expect(document.querySelector("[data-canvas-workbench]")).toBeTruthy(),
    );

    // 若 store 不清空,「关闭」会立刻被同一个值再次触发 —— 表现为工作台关不掉。
    expect(canvasFocusStore.getSnapshot()).toBeNull();

    fireEvent.click(document.querySelector("[data-canvas-workbench-close]")!);
    await waitFor(() =>
      expect(document.querySelector("[data-canvas-workbench]")).toBeNull(),
    );
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  CanvasLauncher,
  CanvasPanel,
  isCanvasEnabled,
} from "../../src/canvas/canvas-launcher.js";
import { canvasOpenStore, canvasViewStore } from "../../src/canvas/use-canvas-view.js";

const STATE_KEY = "surface:canvas";
const PROBE = "surface:canvas";

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
    run: vi.fn(async (d, a) => ({ domain: d, action: a, ok: true })),
    getState: <T,>(k: string) => (k === STATE_KEY ? ({ assets } as T) : undefined),
    subscribe: () => () => undefined,
    hasCommand: (n: string) => n === PROBE,
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  canvasOpenStore.set(false);
  canvasViewStore.update(() => ({
    density: "overview",
    page: 0,
    group: "none",
    selected: [],
    chain: [],
  }));
});

describe("CanvasLauncher 门控", () => {
  it("enabled=false → 渲染 null", () => {
    const { container } = render(<CanvasLauncher enabled={false} />);
    expect(container.querySelector("[data-canvas-launcher]")).toBeNull();
  });

  it("enabled=true → 出现入口按钮,点击开合 canvasOpenStore", () => {
    render(<CanvasLauncher enabled />);
    const btn = document.querySelector("[data-canvas-launcher]");
    expect(btn).not.toBeNull();
    expect(canvasOpenStore.getSnapshot()).toBe(false);
    fireEvent.click(btn!);
    expect(canvasOpenStore.getSnapshot()).toBe(true);
    fireEvent.click(btn!);
    expect(canvasOpenStore.getSnapshot()).toBe(false);
  });

  it("isCanvasEnabled 读 env(=== '1' / 'true')", () => {
    const prev = process.env.NEXT_PUBLIC_PI_WEB_CANVAS;
    process.env.NEXT_PUBLIC_PI_WEB_CANVAS = "1";
    expect(isCanvasEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_PI_WEB_CANVAS = "true";
    expect(isCanvasEnabled()).toBe(true);
    delete process.env.NEXT_PUBLIC_PI_WEB_CANVAS;
    expect(isCanvasEnabled()).toBe(false);
    if (prev !== undefined) process.env.NEXT_PUBLIC_PI_WEB_CANVAS = prev;
  });
});

describe("CanvasPanel 门控 + 开合", () => {
  it("enabled=false → null", () => {
    const { container } = render(<CanvasPanel enabled={false} surface={fakeSurface([asset("a")])} />);
    expect(container.querySelector("[data-canvas-panel]")).toBeNull();
  });

  it("enabled + open=false → null;open=true → 画廊挂载", () => {
    const surface = fakeSurface([asset("a")]);
    const { rerender } = render(<CanvasPanel enabled surface={surface} />);
    expect(document.querySelector("[data-canvas-panel]")).toBeNull();
    canvasOpenStore.set(true);
    rerender(<CanvasPanel enabled surface={surface} />);
    expect(document.querySelector("[data-canvas-panel]")).not.toBeNull();
    expect(document.querySelector("[data-canvas-gallery]")).not.toBeNull();
  });

  it("open + 点格子 → 展开工作台;关闭回画廊", () => {
    const surface = fakeSurface([asset("cell_1")]);
    canvasOpenStore.set(true);
    render(<CanvasPanel enabled surface={surface} />);
    fireEvent.click(document.querySelector('[data-canvas-cell][data-att-id="cell_1"]')!);
    expect(document.querySelector("[data-canvas-workbench]")).not.toBeNull();
    fireEvent.click(document.querySelector("[data-canvas-workbench-close]")!);
    expect(document.querySelector("[data-canvas-gallery]")).not.toBeNull();
    expect(document.querySelector("[data-canvas-workbench]")).toBeNull();
  });

  it("点对话流工具卡生成图(data-att-id)→ 开面板并把工作台切到该 att", async () => {
    const surface = fakeSurface([asset("att_x")]);
    render(<CanvasPanel enabled surface={surface} />); // 初始关闭
    expect(document.querySelector("[data-canvas-panel]")).toBeNull();

    // 模拟对话流工具卡里的生成图(pi-tool-part 渲染,带通用 data-att-id)。
    const wrap = document.createElement("div");
    wrap.setAttribute("data-pi-tool-images", "");
    const img = document.createElement("img");
    img.setAttribute("data-att-id", "att_x");
    wrap.appendChild(img);
    document.body.appendChild(wrap);

    // 无 data-pi-tool-images 包裹的裸图不接管。
    const bare = document.createElement("img");
    bare.setAttribute("data-att-id", "att_x");
    document.body.appendChild(bare);
    fireEvent.click(bare);
    expect(canvasOpenStore.getSnapshot()).toBe(false);

    // 工具卡图 → 开面板 + 工作台切到 att_x。
    fireEvent.click(img);
    expect(canvasOpenStore.getSnapshot()).toBe(true);
    await waitFor(() =>
      expect(
        document.querySelector("[data-canvas-workbench]")?.getAttribute("data-att-id"),
      ).toBe("att_x"),
    );
    wrap.remove();
    bare.remove();
  });
});

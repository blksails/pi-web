import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasGallery } from "../../src/canvas/canvas-gallery.js";
import { canvasViewStore, canvasOpenStore } from "../../src/canvas/use-canvas-view.js";

const STATE_KEY = "surface:canvas";
const PROBE = "surface:canvas";

function asset(id: string, over: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    attachmentId: id,
    displayUrl: `/att/${id}`,
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: over.createdAt ?? "2026-07-02T10:00:00.000Z",
    origin: "tool-output",
    ...over,
  };
}

function fakeSurface(
  assets: GalleryAsset[],
  opts: { available?: boolean; run?: ReturnType<typeof vi.fn> } = {},
): WebExtSurfaceAccess {
  const available = opts.available ?? true;
  return {
    run: opts.run ?? vi.fn(async (domain, action) => ({ domain, action, ok: true })),
    getState: <T,>(key: string) => (key === STATE_KEY ? ({ assets } as T) : undefined),
    subscribe: () => () => undefined,
    hasCommand: (name: string) => available && name === PROBE,
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  canvasViewStore.update(() => ({
    density: "overview",
    page: 0,
    group: "none",
    selected: [],
    chain: [],
  }));
  canvasOpenStore.set(false);
});

describe("CanvasGallery", () => {
  it("available=true 渲染 9 宫格(overview 每页 9)", () => {
    const assets = Array.from({ length: 12 }, (_, i) => asset(`att_${i}`));
    render(<CanvasGallery surface={fakeSurface(assets)} />);
    expect(document.querySelector("[data-canvas-gallery]")?.getAttribute("data-canvas-available")).toBe("true");
    expect(document.querySelectorAll("[data-canvas-cell]").length).toBe(9);
  });

  it("密度切换改变 data-canvas-density(UI 本地态)", () => {
    render(<CanvasGallery surface={fakeSurface([asset("a")])} />);
    fireEvent.click(document.querySelector('[data-canvas-density-btn="focus"]')!);
    expect(document.querySelector("[data-canvas-gallery]")?.getAttribute("data-canvas-density")).toBe("focus");
  });

  it("分页翻页(12 资产 overview → 2 页,下一页 page=1)", () => {
    const assets = Array.from({ length: 12 }, (_, i) => asset(`att_${i}`));
    render(<CanvasGallery surface={fakeSurface(assets)} />);
    expect(document.querySelector("[data-canvas-page-indicator]")?.textContent).toBe("1 / 2");
    fireEvent.click(document.querySelector("[data-canvas-next]")!);
    expect(document.querySelector("[data-canvas-gallery]")?.getAttribute("data-canvas-page")).toBe("1");
    // 第 2 页剩 3 张。
    expect(document.querySelectorAll("[data-canvas-cell]").length).toBe(3);
  });

  it("分组切换(时间)派生分组区(UI 本地,不发命令)", () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
    const assets = [
      asset("a", { createdAt: "2026-07-01T10:00:00.000Z" }),
      asset("b", { createdAt: "2026-07-02T10:00:00.000Z" }),
    ];
    render(<CanvasGallery surface={fakeSurface(assets, { run })} />);
    fireEvent.click(document.querySelector('[data-canvas-group-btn="time"]')!);
    expect(document.querySelectorAll("[data-canvas-group]").length).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("轮末 idle 边沿(syncSignal 变化)→ run('sync')", () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
    const surface = fakeSurface([asset("a")], { run });
    const { rerender } = render(<CanvasGallery surface={surface} syncSignal={0} />);
    expect(run).not.toHaveBeenCalled(); // 首挂不触发
    rerender(<CanvasGallery surface={surface} syncSignal={1} />);
    expect(run).toHaveBeenCalledWith("canvas", "sync");
  });

  it("available=false → 退化只读(historyImages;A 档禁用;无 sync)", () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
    const surface = fakeSurface([], { available: false, run });
    render(
      <CanvasGallery
        surface={surface}
        historyImages={[asset("hist_1")]}
        syncSignal={1}
      />,
    );
    expect(document.querySelector("[data-canvas-gallery]")?.getAttribute("data-canvas-available")).toBe("false");
    expect(document.querySelector("[data-canvas-degraded]")).not.toBeNull();
    expect(document.querySelectorAll("[data-canvas-cell]").length).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("点格子 → onOpenAsset(attId)", () => {
    const onOpenAsset = vi.fn();
    render(<CanvasGallery surface={fakeSurface([asset("cell_1")])} onOpenAsset={onOpenAsset} />);
    fireEvent.click(document.querySelector('[data-canvas-cell][data-att-id="cell_1"]')!);
    expect(onOpenAsset).toHaveBeenCalledWith("cell_1");
  });

  it("livePreview:生成中状态区可播报(role=status/aria-live)+ 宿主转发图渲染", () => {
    const surface: WebExtSurfaceAccess = {
      run: vi.fn(async (d, a) => ({ domain: d, action: a, ok: true })),
      getState: <T,>(k: string) =>
        k === STATE_KEY ? ({ assets: [], livePreview: { stage: "partial" } } as T) : undefined,
      subscribe: () => () => undefined,
      hasCommand: (n: string) => n === PROBE,
    };
    render(<CanvasGallery surface={surface} livePreviewImage="data:image/png;base64,AA" />);
    const lp = document.querySelector("[data-canvas-live-preview]");
    expect(lp?.getAttribute("data-canvas-live-preview-stage")).toBe("partial");
    const status = lp?.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("生成中");
    // 宿主转发图优先渲染。
    expect(lp?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA");
  });
});

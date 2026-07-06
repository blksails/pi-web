/**
 * CanvasWorkbench 插件图层渲染 / Inspector / 拍平 / undo 接线(task 3.2,Req 1.2/1.3/1.4/1.5/1.6)。
 *
 * 覆盖(design「宿主中立注入与聚合 · 图层接线」+ 裁定 C):
 * - 渲染:kind 命中 registry.layers → 定位容器内渲染插件 Render(自定内容可见);无 kind
 *   图层照既有 img 渲染(1.5 零变);
 * - Inspector:选中插件图层且插件有 Inspector → FLOAT 浮层(data-canvas-inspector),
 *   update 回写 layer.data 并触发重渲(1.3);
 * - undo:Inspector 一次编辑进统一 undo 栈(builtin:layer-data op),撤销回滚 data(1.6);
 * - 拍平:合成路径按 kind 调插件 bake(1.4);无 kind 走既有 drawImage。
 *
 * 放置经工具 createLayer 声明(design「点击置层」seam):贴纸工具激活期舞台按下 → 装配层
 * 调 layers.add(..., {kind, data})。既有 workbench 测试零改动;本文件新增(design File
 * Structure「New Files」)。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  defineCanvasTool,
  defineCanvasLayer,
  type CanvasTool,
  type CanvasLayerPlugin,
} from "@blksails/pi-web-canvas-kit";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";
import type { CanvasLike, Ctx2DLike, UploadFn } from "../../src/canvas/client-image-ops.js";

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

function fakeSurface(): WebExtSurfaceAccess {
  return {
    run: vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true })),
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand: (name: string) => name === PROBE,
  };
}

/** jsdom 无真实 canvas → 注入 fake(拍平 flattenLayers + per-layer bake 画布共用)。 */
function fakeCanvasFactory(): () => CanvasLike {
  return () => {
    const ctx: Ctx2DLike = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
    };
    return {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,AAAA",
    };
  };
}

const upload = vi.fn(async () => ({
  attachment: { id: "att_new" },
  displayUrl: "/att/att_new",
})) as unknown as UploadFn;

/** 设 natural(jsdom img 不加载 → 手动量取门控图层渲染 gate)。 */
function loadNatural(w = 400, h = 300): void {
  const img = document.querySelector("[data-canvas-workbench-image]") as HTMLImageElement | null;
  if (img === null) return;
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  fireEvent.load(img);
}

interface StickerData {
  readonly emoji: string;
  readonly size: number;
}

/** 贴纸图层插件(Render 显 emoji;Inspector bump size;bake spy 记录拍平调用)。 */
function stickerLayer(bake: (...args: unknown[]) => void): CanvasLayerPlugin<StickerData> {
  return defineCanvasLayer<StickerData>({
    type: "sticker", // 命名空间后 = "acme:sticker"
    Render: ({ layer }) => {
      const d = layer.data as StickerData | undefined;
      return (
        <div data-test-sticker data-sticker-size={d?.size ?? 0}>
          {d?.emoji ?? ""}
        </div>
      );
    },
    bake: (ctx2d, layer, size) => bake(ctx2d, layer, size),
    Inspector: ({ layer, update }) => {
      const d = layer.data as StickerData | undefined;
      return (
        <button
          data-test-inspector-bump
          onClick={() => update({ emoji: d?.emoji ?? "⭐", size: (d?.size ?? 1) + 1 })}
        >
          放大
        </button>
      );
    },
  });
}

function stickerTool(): CanvasTool {
  return defineCanvasTool({
    id: "sticker-tool", // 命名空间后 = "acme:sticker-tool"
    label: "贴纸",
    icon: null,
    overlayInteractive: true,
    createLayer: { kind: "sticker", data: { emoji: "⭐", size: 1 } },
  });
}

function stickerPlugins(
  bake: (...args: unknown[]) => void,
): Parameters<typeof CanvasWorkbench>[0]["plugins"] {
  return [
    {
      namespace: "acme",
      bundles: [
        {
          id: "stickers",
          requires: ["acme:sticker"],
          tools: [stickerTool()],
          layers: [stickerLayer(bake)],
        },
      ],
    },
  ];
}

/** 渲染 + 激活贴纸工具 + 量 natural + 舞台按下放置一枚贴纸(自动选中)。 */
function placeSticker(bake: (...args: unknown[]) => void = vi.fn()) {
  const result = render(
    <CanvasWorkbench
      surface={fakeSurface()}
      asset={asset("att_src")}
      assets={[asset("att_src")]}
      onClose={() => undefined}
      upload={upload}
      baseUrl="/api"
      sessionId="s1"
      canvasFactory={fakeCanvasFactory()}
      plugins={stickerPlugins(bake)}
    />,
  );
  // 激活贴纸工具(命名空间前缀化 id)。
  fireEvent.click(document.querySelector('[data-canvas-tool="acme:sticker-tool"]')!);
  loadNatural();
  // 舞台按下 → 放置插件图层(createLayer 声明驱动)。
  fireEvent.pointerDown(document.querySelector("[data-canvas-stage]")!, { clientX: 10, clientY: 10 });
  return result;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CanvasWorkbench 插件图层渲染/Inspector/拍平/undo(task 3.2)", () => {
  it("1.2 渲染:kind 命中 → 定位容器内渲染插件 Render(自定内容可见)", async () => {
    placeSticker();
    await waitFor(() =>
      expect(document.querySelector("[data-test-sticker]")).not.toBeNull(),
    );
    // 插件 Render 内容(emoji)可见,且经 data 呈现初值 size=1。
    const sticker = document.querySelector("[data-test-sticker]")!;
    expect(sticker.textContent).toContain("⭐");
    expect(sticker.getAttribute("data-sticker-size")).toBe("1");
    // 定位容器仍是既有图层容器(data-canvas-layer),插件内容替换 img。
    const layerBox = sticker.closest("[data-canvas-layer]");
    expect(layerBox).not.toBeNull();
    expect(layerBox!.querySelector("img")).toBeNull(); // 插件图层不渲染 img
  });

  it("1.5 图像图层零变:无 kind 图层照既有 img 渲染(不误入插件分支)", async () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface()}
        asset={asset("att_src")}
        assets={[asset("att_src"), asset("att_ref1")]}
        onClose={() => undefined}
        upload={upload}
        baseUrl="/api"
        sessionId="s1"
        canvasFactory={fakeCanvasFactory()}
        imageLoader={async () => ({ source: {} as CanvasImageSource, width: 200, height: 100 })}
        plugins={stickerPlugins(vi.fn())}
      />,
    );
    loadNatural();
    // 经 ⊕ 加图像图层(无 kind)。
    fireEvent.click(document.querySelector('[data-canvas-layer-add][data-att-id="att_ref1"]')!);
    await waitFor(() => expect(document.querySelector("[data-canvas-layer-bar]")).not.toBeNull());
    // 图像图层容器内是 img,不是插件 Render。
    const layerBox = document.querySelector("[data-canvas-layer]")!;
    expect(layerBox.querySelector("img")).not.toBeNull();
    expect(layerBox.querySelector("[data-test-sticker]")).toBeNull();
  });

  it("1.3 Inspector:选中插件图层 → 浮层出现,update 回写 data 并重渲", async () => {
    placeSticker();
    // 放置即选中 → Inspector 浮层出现。
    await waitFor(() => expect(document.querySelector("[data-canvas-inspector]")).not.toBeNull());
    expect(document.querySelector("[data-test-inspector-bump]")).not.toBeNull();
    // 编辑:bump size 1 → 2,呈现更新。
    fireEvent.click(document.querySelector("[data-test-inspector-bump]")!);
    await waitFor(() =>
      expect(
        document.querySelector("[data-test-sticker]")!.getAttribute("data-sticker-size"),
      ).toBe("2"),
    );
  });

  it("1.6 undo:Inspector 一次编辑进 undo 栈,撤销回滚 data", async () => {
    placeSticker();
    await waitFor(() => expect(document.querySelector("[data-test-inspector-bump]")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-test-inspector-bump]")!);
    await waitFor(() =>
      expect(
        document.querySelector("[data-test-sticker]")!.getAttribute("data-sticker-size"),
      ).toBe("2"),
    );
    // 撤销(既有 undo 接缝:工具条 data-canvas-undo 按钮 → kernel.history.undo)。
    fireEvent.click(document.querySelector("[data-canvas-undo]")!);
    await waitFor(() =>
      expect(
        document.querySelector("[data-test-sticker]")!.getAttribute("data-sticker-size"),
      ).toBe("1"),
    );
  });

  it("1.4 拍平:合成路径按 kind 调插件 bake(烤入位图)", async () => {
    const bake = vi.fn();
    placeSticker(bake);
    await waitFor(() => expect(document.querySelector("[data-test-sticker]")).not.toBeNull());
    // 拍平 → 插件 bake 被调用(ctx2d/layer/size 三参)。
    fireEvent.click(document.querySelector("[data-canvas-layer-flatten]")!);
    await waitFor(() => expect(bake).toHaveBeenCalledTimes(1));
    const [ctx2d, layer, size] = bake.mock.calls[0]!;
    expect(ctx2d).toBeDefined();
    expect((layer as { kind?: string }).kind).toBe("acme:sticker");
    expect(size).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
    // 拍平产物仍经上传接缝落 att_(与既有拍平链路一致)。
    await waitFor(() => expect(upload).toHaveBeenCalled());
  });
});

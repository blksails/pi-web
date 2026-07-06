/**
 * CanvasWorkbench · capability 消费与退化(canvas-actions-m2 · task 3.3)。
 *
 * 覆盖 Req 4.2/4.3/4.4/4.6/4.7:
 *  a) 快照含 capabilities → 模型下拉选项 = 下发清单;尺寸 chips = 下发 sizes(同源消费,4.2)。
 *  b) 选中带 `sizes` 收窄的模型 → 尺寸选项收窄为交集(4.3);切到不支持已选 size 的模型 →
 *     ratioSize 复位为 ""(跟随原图),不静默发不支持组合。
 *  c) 快照无 capabilities → 选项 = DEFAULT_MODEL_OPTIONS / RATIO_OPTIONS(退化守恒,4.4)。
 *
 * 经 packages/ui 转发层深路径 import(既有 canvas-workbench.test.tsx harness 手法);
 * Radix Select/Popover 在 jsdom 下经 setup.ts polyfill + fireEvent.click 打开
 * (aigc-quick-settings.test.tsx 与 canvas-workbench.test.tsx 既证)。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";

const PROBE = "surface:canvas";

function asset(id: string, over: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    attachmentId: id,
    displayUrl: `/att/${id}`,
    mimeType: "image/png",
    name: `${id}.png`,
    createdAt: "2026-07-02T10:00:00.000Z",
    origin: "tool-output",
    ...over,
  };
}

/** getState 恒返回给定快照的 fakeSurface(capability 静态注入)。 */
function stateSurface(state: GalleryState | undefined): WebExtSurfaceAccess {
  return {
    run: vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true })),
    getState: (<T = unknown,>() => state as T | undefined) as WebExtSurfaceAccess["getState"],
    subscribe: () => () => undefined,
    hasCommand: (name: string) => name === PROBE,
  };
}

/** 打开模型下拉,取全部选项可见文本。 */
function openModelOptions(): string[] {
  fireEvent.click(document.querySelector("[data-canvas-model]")!);
  return Array.from(document.querySelectorAll("[role=option]")).map((o) => o.textContent ?? "");
}

/** 打开尺寸 Popover 后取全部比例 chip 的 data-canvas-ratio 值。 */
function openRatioLabels(): string[] {
  fireEvent.click(document.querySelector("[data-canvas-size-trigger]")!);
  return Array.from(document.querySelectorAll("[data-canvas-ratio]")).map(
    (o) => o.getAttribute("data-canvas-ratio") ?? "",
  );
}

beforeEach(() => cleanup());

describe("CanvasWorkbench · capability 消费", () => {
  it("a) 快照含 capabilities → 模型选项与尺寸 chips 取下发清单(4.2)", async () => {
    const state: GalleryState = {
      assets: [],
      capabilities: {
        models: [{ id: "model-a" }, { id: "model-b" }],
        sizes: [
          { label: "方形", size: "111x111" },
          { label: "横幅", size: "222x222" },
        ],
        actions: [],
      },
    };
    render(
      <CanvasWorkbench
        surface={stateSurface(state)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    // 模型下拉 = 下发清单(非内置 DEFAULT_MODEL_OPTIONS)。
    await waitFor(() => expect(openModelOptions()).toContain("model-a"));
    const models = openModelOptions();
    expect(models).toContain("model-a");
    expect(models).toContain("model-b");
    expect(models).not.toContain("gpt-image-2");
    // 尺寸 chips = 下发 sizes 的 label(非内置 RATIO_OPTIONS)。
    await waitFor(() => expect(openRatioLabels()).toContain("方形"));
    const ratios = openRatioLabels();
    expect(ratios).toEqual(["方形", "横幅"]);
    expect(ratios).not.toContain("16:9");
  });

  it("b) 选中带 sizes 的模型 → 尺寸收窄;切到不支持已选 size 的模型 → ratioSize 复位(4.3)", async () => {
    const state: GalleryState = {
      assets: [],
      capabilities: {
        models: [
          { id: "wan-x", sizes: ["1024x1024", "1280x720", "720x1280"] },
          { id: "gpt-x", sizes: ["1024x1024", "1536x1024", "1024x1536"] },
        ],
        // 全局三档 = 现 RATIO_OPTIONS 守恒。
        sizes: [
          { label: "1:1", size: "1024x1024" },
          { label: "16:9", size: "1280x720" },
          { label: "9:16", size: "720x1280" },
        ],
        actions: [],
      },
    };
    render(
      <CanvasWorkbench
        surface={stateSurface(state)}
        asset={asset("att_src")}
        assets={[
          asset("att_src"),
          asset("att_wan", { genParams: { model: "wan-x" } }),
          asset("att_gpt", { genParams: { model: "gpt-x" } }),
        ]}
        onClose={() => undefined}
      />,
    );
    // 选 wan-x(经版本条复用参数,设 model)→ 三档全在支持集,尺寸不收窄。
    fireEvent.click(document.querySelector('[data-canvas-version-item][data-att-id="att_wan"]')!);
    await waitFor(() => expect(openRatioLabels()).toEqual(["1:1", "16:9", "9:16"]));
    // 选 16:9(1280x720)。
    fireEvent.click(document.querySelector('[data-canvas-ratio="16:9"]')!);
    await waitFor(() =>
      expect(document.querySelector("[data-canvas-size-trigger]")!.textContent).toContain("16:9"),
    );
    // 切 gpt-x:不支持 1280x720 → 尺寸收窄为仅 1:1,且已选 ratioSize 复位「跟随原图」。
    fireEvent.click(document.querySelector('[data-canvas-version-item][data-att-id="att_gpt"]')!);
    await waitFor(() =>
      expect(document.querySelector("[data-canvas-size-trigger]")!.textContent).toContain(
        "跟随原图",
      ),
    );
    expect(document.querySelector("[data-canvas-size-trigger]")!.textContent).not.toContain("16:9");
    // 收窄:仅 1:1 chip(16:9/9:16 落 gpt-x 支持集外)。
    const narrowed = openRatioLabels();
    expect(narrowed).toEqual(["1:1"]);
  });

  it("c) 快照无 capabilities → 退回 DEFAULT_MODEL_OPTIONS / RATIO_OPTIONS(4.4 守恒)", async () => {
    render(
      <CanvasWorkbench
        surface={stateSurface({ assets: [] })}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => expect(openModelOptions()).toContain("gpt-image-2"));
    expect(openModelOptions()).toContain("gpt-image-2");
    await waitFor(() => expect(openRatioLabels()).toContain("16:9"));
    expect(openRatioLabels()).toEqual(["1:1", "16:9", "9:16"]);
  });
});

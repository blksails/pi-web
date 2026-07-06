/**
 * CanvasWorkbench 插件工具禁用态(task 3.1,Req 3.3/4.2;裁定 B)。
 *
 * 覆盖(design「宿主中立注入与聚合」+ 「裁定书 B」):
 * - 缺依赖插件捆:其工具仍进工具轨但**置灰**(disabled)+ title 含缺失依赖原因
 *   (registry.disabledPluginToolReason → resolveToolRailTitle 显缺失项);其动作不参与;
 * - 依赖齐备插件捆:工具正常注册且**可点**(不置灰、title 无「已禁用」);
 * - CanvasWorkbench 直传 plugins prop(CanvasPanel→workbench 聚合链的下游锚)。
 *
 * 既有 workbench 测试零改动;本文件新增(design File Structure「New Files」)。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { defineCanvasTool, type CanvasTool } from "@blksails/pi-web-canvas-kit";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";

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

/** surface 可用(available)+ 上传接缝 → maskToolsDisabled=false,隔离出插件禁用态本身。 */
function fakeSurface(): WebExtSurfaceAccess {
  return {
    run: vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true })),
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand: (name: string) => name === PROBE,
  };
}

const upload = vi.fn(async () => ({
  attachment: { id: "att_new" },
  displayUrl: "/att/att_new",
})) as unknown as import("@blksails/pi-web-canvas-kit").UploadFn;

const stickerTool = (id: string): CanvasTool =>
  defineCanvasTool({ id, label: "贴纸", icon: null, overlayInteractive: true });

function renderWithPlugins(plugins: Parameters<typeof CanvasWorkbench>[0]["plugins"]) {
  return render(
    <CanvasWorkbench
      surface={fakeSurface()}
      asset={asset("att_src")}
      assets={[asset("att_src")]}
      onClose={() => undefined}
      upload={upload}
      baseUrl=""
      sessionId="s1"
      plugins={plugins}
    />,
  );
}

beforeEach(() => cleanup());

describe("CanvasWorkbench 插件工具禁用态(缺依赖 → 置灰 + tooltip 缺失项)", () => {
  it("3.3 缺依赖捆:工具进轨但 disabled 且 title 含「缺少依赖」缺失项", () => {
    renderWithPlugins([
      {
        namespace: "acme",
        bundles: [
          {
            id: "stickers",
            requires: ["acme:missing-layer"], // 未注册的图层类型 → 整捆缺依赖
            tools: [stickerTool("sticker-tool")],
          },
        ],
      },
    ]);
    // 命名空间前缀化后工具 id = "acme:sticker-tool"(toolAnchor 不剥非 builtin: 前缀)。
    const btn = document.querySelector('[data-canvas-tool="acme:sticker-tool"]');
    expect(btn).not.toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    const title = btn!.getAttribute("title") ?? "";
    expect(title).toContain("已禁用");
    expect(title).toContain("缺少依赖");
    expect(title).toContain("acme:missing-layer"); // 显具体缺失项
  });

  it("4.2 依赖齐备捆:工具正常注册且可点(不置灰、title 无「已禁用」)", () => {
    renderWithPlugins([
      {
        namespace: "acme",
        bundles: [
          {
            id: "shapes",
            requires: ["stroke"], // 内置 op kind,依赖齐备
            tools: [stickerTool("shape-tool")],
          },
        ],
      },
    ]);
    const btn = document.querySelector('[data-canvas-tool="acme:shape-tool"]');
    expect(btn).not.toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn!.getAttribute("title") ?? "").not.toContain("已禁用");
  });

  it("4.3 无 plugins:工具轨仅内置工具(插件工具零影响不出现)", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface()}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        upload={upload}
      />,
    );
    expect(document.querySelector('[data-canvas-tool="acme:sticker-tool"]')).toBeNull();
    // 内置工具仍在(基线不破)。
    expect(document.querySelector('[data-canvas-tool="move"]')).not.toBeNull();
  });
});

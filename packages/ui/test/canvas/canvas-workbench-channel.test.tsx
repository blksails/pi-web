import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";
import type { CanvasLike, Ctx2DLike, UploadFn } from "../../src/canvas/client-image-ops.js";

// 三态呈现(Task 4.3 / Req 8.4–8.6):按 bridge.opChannel 三种注入组合断言
// data-canvas-op-channel 锚点 + 降级横幅。opChannel 探测次序:
//   prompt      ⇐ conversation / onSubmitPrompt 在场
//   command     ⇐ 无对话通道 but surface 探针(hasCommand("surface:canvas"))真
//   unavailable ⇐ 皆无
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

function fakeSurface(available: boolean, run: ReturnType<typeof vi.fn>): WebExtSurfaceAccess {
  return {
    run,
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand: (name: string) => available && name === PROBE,
  };
}

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

const fakeUpload: UploadFn = async () => ({
  attachment: { id: "att_new" },
  displayUrl: "/att/att_new",
});

beforeEach(() => cleanup());

describe("CanvasWorkbench 降级三态呈现(opChannel)", () => {
  it("prompt 态(conversation 在场):op-channel=prompt,无降级横幅", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, vi.fn(async () => ({ ok: true })))}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        conversation={{ submitUserMessage: vi.fn() }}
      />,
    );
    expect(
      document.querySelector("[data-canvas-workbench]")!.getAttribute("data-canvas-op-channel"),
    ).toBe("prompt");
    // prompt 态无新提示:两类降级横幅均不出现。
    expect(document.querySelector("[data-canvas-degrade]")).toBeNull();
  });

  it("prompt 态(onSubmitPrompt 别名):op-channel=prompt,无降级横幅", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, vi.fn(async () => ({ ok: true })))}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        onSubmitPrompt={() => undefined}
      />,
    );
    expect(
      document.querySelector("[data-canvas-workbench]")!.getAttribute("data-canvas-op-channel"),
    ).toBe("prompt");
    expect(document.querySelector("[data-canvas-degrade]")).toBeNull();
  });

  it("command 态(surface 探针真、无对话通道):op-channel=command + 「不进入对话/LLM 不在环」降级横幅", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, vi.fn(async () => ({ ok: true })))}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    expect(
      document.querySelector("[data-canvas-workbench]")!.getAttribute("data-canvas-op-channel"),
    ).toBe("command");
    const banner = document.querySelector('[data-canvas-degrade="command"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent ?? "").toContain("不进入对话");
    expect(banner!.textContent ?? "").toContain("LLM 不在环");
    // unavailable 横幅不应同时出现(三态互斥)。
    expect(document.querySelector('[data-canvas-degrade="unavailable"]')).toBeNull();
  });

  it("command 态:控制面动作(旋转 → register)照常经 surface.run(降级横幅不阻断控制面)", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    const upload = vi.fn(fakeUpload);
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        upload={upload}
        baseUrl="/api"
        sessionId="s1"
        canvasFactory={fakeCanvasFactory()}
      />,
    );
    // 生成按钮在 command 态保持可用(Req 8.3:现有 command 态旁路生成零改动;
    // 降级仅呈现层,不移除控制面功能)。
    expect(
      (document.querySelector("[data-canvas-generate]") as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(document.querySelector("[data-canvas-b-rotate]")!);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("canvas", "register", {
        attachmentId: "att_new",
        derivedFrom: "att_src",
        genParams: { op: "rotate", degrees: 90 },
      }),
    );
  });

  it("unavailable 态(无 surface 探针、无对话通道):op-channel=unavailable + 「surface 不可用」横幅", () => {
    render(
      <CanvasWorkbench
        surface={fakeSurface(false, vi.fn(async () => ({ ok: true })))}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    expect(
      document.querySelector("[data-canvas-workbench]")!.getAttribute("data-canvas-op-channel"),
    ).toBe("unavailable");
    const banner = document.querySelector('[data-canvas-degrade="unavailable"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent ?? "").toContain("surface 不可用");
    expect(document.querySelector('[data-canvas-degrade="command"]')).toBeNull();
  });
});

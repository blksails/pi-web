import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasWorkbench } from "../../src/canvas/canvas-workbench.js";
import type { CanvasLike, Ctx2DLike, UploadFn } from "../../src/canvas/client-image-ops.js";

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

/** jsdom 无真实 canvas → 注入 fake。 */
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

describe("CanvasWorkbench", () => {
  it("A 档:点编辑发对形 SurfaceCommandPayload(仅 att_ 引用 + 文本)", async () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(document.querySelector("[data-canvas-prompt]")!, {
      target: { value: "make blue" },
    });
    fireEvent.click(document.querySelector('[data-canvas-action="edit"]')!);
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith("canvas", "edit", { image: "att_src", prompt: "make blue" });
  });

  it("B 档:旋转产 att_ 后调 register(derivedFrom=源)", async () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
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

  it("available=false:A 档禁用;B 档产 att_ 但不 register(仅本地)", async () => {
    const run = vi.fn(async (d, a) => ({ domain: d, action: a, ok: true }));
    const upload = vi.fn(fakeUpload);
    render(
      <CanvasWorkbench
        surface={fakeSurface(false, run)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        upload={upload}
        baseUrl="/api"
        sessionId="s1"
        canvasFactory={fakeCanvasFactory()}
      />,
    );
    expect((document.querySelector('[data-canvas-action="edit"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-canvas-b-rotate]")!);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(run).not.toHaveBeenCalled();
  });

  it("关闭 → onClose;带入对话 → onBringToConversation(att_id)", () => {
    const onClose = vi.fn();
    const onBring = vi.fn();
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, vi.fn(async () => ({ domain: "canvas", action: "x", ok: true })))}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={onClose}
        onBringToConversation={onBring}
      />,
    );
    fireEvent.click(document.querySelector("[data-canvas-workbench-close]")!);
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(document.querySelector("[data-canvas-bring-to-conversation]")!);
    expect(onBring).toHaveBeenCalledWith("att_src");
  });
});

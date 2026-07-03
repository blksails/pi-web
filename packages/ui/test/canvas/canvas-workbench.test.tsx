import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  CanvasWorkbench,
  buildToolPrompt,
  composeInpaintBack,
  decideGenerate,
} from "../../src/canvas/canvas-workbench.js";
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

  it("decideGenerate:决策矩阵(掩码＞引用＞变体＞仅比例 reframe＞edit;size/model 随附)", () => {
    const base = { imageId: "att_x", prompt: "p", model: "", variants: 1, size: "", referenceIds: [] as string[], hasMask: false };
    expect(decideGenerate({ ...base })).toEqual({ action: "edit", args: { image: "att_x", prompt: "p" } });
    // 扩图最优先(改变画布本身;size 抛弃交给输入画布)。
    expect(
      decideGenerate({ ...base, hasExpand: true, hasMask: true, size: "1024x1024" }),
    ).toEqual({ action: "outpaint", args: { image: "att_x", prompt: "p" } });
    // 掩码次优先(即使有引用/变体)。
    expect(
      decideGenerate({ ...base, hasMask: true, referenceIds: ["att_r"], variants: 3 }).action,
    ).toBe("inpaint");
    // 引用 → reference(变体数并入 n)。
    expect(decideGenerate({ ...base, referenceIds: ["att_r"], variants: 2 })).toEqual({
      action: "reference",
      args: { image: "att_x", prompt: "p", reference_images: ["att_r"], n: 2 },
    });
    // 变体 ≥2 → variants。
    expect(decideGenerate({ ...base, variants: 3 })).toEqual({
      action: "variants",
      args: { image: "att_x", prompt: "p", n: 3 },
    });
    // 仅比例(空 prompt)→ reframe;有 prompt → edit 携 size。
    expect(decideGenerate({ ...base, prompt: "", size: "1536x1024" }).action).toBe("reframe");
    expect(decideGenerate({ ...base, size: "1536x1024" })).toEqual({
      action: "edit",
      args: { image: "att_x", prompt: "p", size: "1536x1024" },
    });
    // model 随附。
    expect(decideGenerate({ ...base, model: "gpt-image-2" }).args.model).toBe("gpt-image-2");
  });

  it("@引用:选中资产成芯片 → 生成发 reference(reference_images);消费后清空", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src"), asset("att_ref1"), asset("att_ref2")]}
        onClose={() => undefined}
      />,
    );
    // @ 按钮开引用选择器 → 选 att_ref2。
    fireEvent.click(document.querySelector("[data-canvas-ref-trigger]")!);
    await waitFor(() =>
      expect(document.querySelector('[data-canvas-ref-option][data-att-id="att_ref2"]')).toBeTruthy(),
    );
    fireEvent.click(document.querySelector('[data-canvas-ref-option][data-att-id="att_ref2"]')!);
    // 芯片出现;生成按钮切 reference。
    expect(document.querySelector('[data-canvas-ref-chip][data-att-id="att_ref2"]')).toBeTruthy();
    const gen = document.querySelector("[data-canvas-generate]")! as HTMLButtonElement;
    expect(gen.getAttribute("data-canvas-action")).toBe("reference");
    fireEvent.change(document.querySelector("[data-canvas-prompt]")!, {
      target: { value: "融合风格" },
    });
    fireEvent.click(gen);
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("canvas", "reference", {
        image: "att_src",
        prompt: "融合风格",
        reference_images: ["att_ref2"],
      }),
    );
    // 消费后芯片清空,按钮回 edit。
    await waitFor(() =>
      expect(document.querySelector("[data-canvas-ref-chip]")).toBeNull(),
    );
    expect(gen.getAttribute("data-canvas-action")).toBe("edit");
  });

  it("参数簇:变体 stepper ≥2 → variants(n);比例+空 prompt → reframe(size)", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
      />,
    );
    const gen = document.querySelector("[data-canvas-generate]")! as HTMLButtonElement;
    // 变体 ×3。
    fireEvent.click(document.querySelector("[data-canvas-variants-inc]")!);
    fireEvent.click(document.querySelector("[data-canvas-variants-inc]")!);
    expect(document.querySelector("[data-canvas-variants-n]")!.textContent).toBe("×3");
    expect(gen.getAttribute("data-canvas-action")).toBe("variants");
    fireEvent.click(gen);
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("canvas", "variants", {
        image: "att_src",
        prompt: "",
        n: 3,
      }),
    );
    // 回 ×1,开尺寸 Popover 选 3:2,空 prompt → reframe。
    fireEvent.click(document.querySelector("[data-canvas-variants-dec]")!);
    fireEvent.click(document.querySelector("[data-canvas-variants-dec]")!);
    fireEvent.click(document.querySelector("[data-canvas-size-trigger]")!);
    await waitFor(() => expect(document.querySelector('[data-canvas-ratio="3:2"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-canvas-ratio="3:2"]')!);
    expect(gen.getAttribute("data-canvas-action")).toBe("reframe");
    fireEvent.click(gen);
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("canvas", "reframe", {
        image: "att_src",
        prompt: "",
        size: "1536x1024",
      }),
    );
  });

  it("buildToolPrompt:决策 → image_edit 指令文本(att 引用/mask/refs/参数行)", () => {
    const inpaint = buildToolPrompt(
      { action: "inpaint", args: { image: "att_x", prompt: "换蓝天", size: "1536x1024" } },
      { maskId: "att_mask" },
    );
    expect(inpaint).toContain("image_edit");
    expect(inpaint).toContain("- image: att_x");
    expect(inpaint).toContain("- mask: att_mask");
    expect(inpaint).toContain("- prompt: 换蓝天");
    expect(inpaint).toContain("- size: 1536x1024");
    const ref = buildToolPrompt({
      action: "reference",
      args: { image: "att_x", prompt: "融合", reference_images: ["att_a", "att_b"], n: 2 },
    });
    expect(ref).toContain("reference_images: att_a, att_b");
    expect(ref).toContain("- n: 2");
    // reframe 空 prompt → 自动补比例重构指令。
    const reframe = buildToolPrompt({
      action: "reframe",
      args: { image: "att_x", prompt: "", size: "1024x1536" },
    });
    expect(reframe).toContain("仅按目标尺寸重构比例");
  });

  it("onSubmitPrompt 提供时:生成走对话流(不发 surface 命令);缺失时回退直连", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    const sent: string[] = [];
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src")]}
        onClose={() => undefined}
        onSubmitPrompt={(t) => sent.push(t)}
      />,
    );
    fireEvent.change(document.querySelector("[data-canvas-prompt]")!, {
      target: { value: "整体调亮" },
    });
    fireEvent.click(document.querySelector("[data-canvas-generate]")!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain("image_edit");
    expect(sent[0]).toContain("- image: att_src");
    expect(sent[0]).toContain("- prompt: 整体调亮");
    // 生成类不再走 surface 命令。
    expect(run).not.toHaveBeenCalled();
  });

  it("图层:⊕ 加层 → 浮条出现 → 拍平 → 上传 + register(op:flatten,derivedFrom=底图)→ 清层", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    const upload = vi.fn(fakeUpload);
    render(
      <CanvasWorkbench
        surface={fakeSurface(true, run)}
        asset={asset("att_src")}
        assets={[asset("att_src"), asset("att_ref1")]}
        onClose={() => undefined}
        upload={upload}
        baseUrl="/api"
        sessionId="s1"
        canvasFactory={fakeCanvasFactory()}
        imageLoader={async () => ({
          source: {} as CanvasImageSource,
          width: 200,
          height: 100,
        })}
      />,
    );
    // ⊕ 加层(att_ref1;当前工作图无 ⊕)。
    expect(document.querySelector('[data-canvas-layer-add][data-att-id="att_src"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-canvas-layer-add][data-att-id="att_ref1"]')!);
    await waitFor(() => expect(document.querySelector("[data-canvas-layer-bar]")).toBeTruthy());
    // 拍平 → 合成上传(1 次)+ register 血缘 → 浮条消失(层清空)。
    fireEvent.click(document.querySelector("[data-canvas-layer-flatten]")!);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("canvas", "register", {
        attachmentId: "att_new",
        derivedFrom: "att_src",
        genParams: { op: "flatten", layers: ["att_ref1"] },
      }),
    );
    await waitFor(() => expect(document.querySelector("[data-canvas-layer-bar]")).toBeNull());
  });

  it("composeInpaintBack:模型结果回流 → 掩码回贴合成 → 上传 → register(op:inpaint-composite)", async () => {
    // 快照:base + inpaint 模型结果(derivedFrom=base,非 composite);knownIds 只含 base。
    const snap: GalleryState = {
      assets: [
        asset("att_patch", { derivedFrom: "att_src", genParams: { op: "inpaint" } }),
        asset("att_src"),
      ],
    };
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    const surface: WebExtSurfaceAccess = {
      run,
      getState: <T,>() => snap as T,
      subscribe: () => () => undefined,
      hasCommand: () => true,
    };
    const upload = vi.fn(fakeUpload);
    const loaded: string[] = [];
    await composeInpaintBack({
      surface,
      baseId: "att_src",
      baseDisplayUrl: "/att/att_src",
      baseName: "att_src.png",
      strokes: [{ mode: "paint", size: 20, points: [{ x: 10, y: 10 }] }],
      prompt: "replace sky",
      knownIds: new Set(["att_src"]),
      upload,
      uploadBaseUrl: "/api",
      sessionId: "s1",
      canvasFactory: fakeCanvasFactory(),
      imageLoader: async (url) => {
        loaded.push(url);
        return { source: {} as CanvasImageSource, width: 128, height: 64 };
      },
    });
    // base + patch 都被加载;合成图经 upload 落 att_new;register 携 composite 血缘。
    expect(loaded).toEqual(["/att/att_src", "/att/att_patch"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("canvas", "register", {
      attachmentId: "att_new",
      derivedFrom: "att_src",
      genParams: { op: "inpaint-composite", prompt: "replace sky", from: "att_patch" },
    });
  });

  it("composeInpaintBack:超时无模型结果 → 放弃(不上传不 register)", async () => {
    const run = vi.fn(async (d: string, a: string) => ({ domain: d, action: a, ok: true }));
    const surface: WebExtSurfaceAccess = {
      run,
      getState: <T,>() => ({ assets: [asset("att_src")] }) as T,
      subscribe: () => () => undefined,
      hasCommand: () => true,
    };
    const upload = vi.fn(fakeUpload);
    await composeInpaintBack({
      surface,
      baseId: "att_src",
      baseDisplayUrl: "/att/att_src",
      baseName: "att_src.png",
      strokes: [{ mode: "paint", size: 20, points: [{ x: 10, y: 10 }] }],
      prompt: "x",
      knownIds: new Set(["att_src"]),
      upload,
      uploadBaseUrl: "/api",
      sessionId: "s1",
      canvasFactory: fakeCanvasFactory(),
      imageLoader: async () => ({ source: {} as CanvasImageSource, width: 8, height: 8 }),
      timeoutMs: 30,
    });
    expect(upload).not.toHaveBeenCalled();
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

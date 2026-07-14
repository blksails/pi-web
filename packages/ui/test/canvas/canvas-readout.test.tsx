/**
 * 组件级:Canvas 提示词栏「解读」入口(spec canvas-vision-readout)。
 *
 * 经 `onSubmitPrompt` 注入 prompt 通道(与 `canvas-workbench-channel.test.tsx` 同范式),
 * 断言点击解读后发出的**围栏文本**。
 *
 * 三条护栏:
 *  ① 解读走 `image_vision`,绝不落到 `image_edit`(1.1/1.2/2.1)。
 *  ② **不吞噬生成输入**:已添加参考图时点击解读,文本不含 `reference_images`,
 *     且参考图 chip **点击后仍在**(证明未调用 `consumeSent`;4.3/4.4)。
 *  ③ 模型偏好:选中 → 文本含 `model: provider/id`;未选中 → 无 `model:` 行(3.3/3.4)。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
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

function fakeSurface(): WebExtSurfaceAccess {
  return {
    run: vi.fn(async () => ({ ok: true })),
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand: (name: string) => name === PROBE,
  } as unknown as WebExtSurfaceAccess;
}

const VISION_MODELS = [
  { value: "apiservices/gpt-5.4", label: "GPT-5.4", provider: "apiservices" },
  { value: "apiservices/gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "apiservices" },
];

interface RenderOpts {
  readonly onSubmitPrompt: (text: string) => void;
  readonly visionModelOptions?: readonly { value: string; label: string; provider: string }[];
  readonly assets?: readonly GalleryAsset[];
}

function renderWorkbench(o: RenderOpts) {
  const assets = o.assets ?? [asset("att_src")];
  return render(
    <CanvasWorkbench
      surface={fakeSurface()}
      asset={assets[0]!}
      assets={assets}
      onClose={() => undefined}
      onSubmitPrompt={o.onSubmitPrompt}
      {...(o.visionModelOptions !== undefined
        ? { visionModelOptions: o.visionModelOptions }
        : {})}
    />,
  );
}

const readoutBtn = (): HTMLElement =>
  document.querySelector("[data-canvas-readout]") as HTMLElement;
const promptBox = (): HTMLTextAreaElement =>
  document.querySelector("[data-canvas-prompt]") as HTMLTextAreaElement;

beforeEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom 无 localStorage 时忽略 */
  }
});

describe("解读按钮 — 基本行为(1.1 / 1.2 / 2.1)", () => {
  it("提示词栏渲染出解读按钮,且 prompt 通道下可用", () => {
    renderWorkbench({ onSubmitPrompt: vi.fn() });
    expect(readoutBtn()).toBeTruthy();
    expect(readoutBtn().hasAttribute("disabled")).toBe(false);
  });

  it("★ 点击解读 → 经对话通道发出 image_vision 载荷,绝不落到 image_edit", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt });

    fireEvent.change(promptBox(), { target: { value: "这只猫戴的什么帽子？" } });
    fireEvent.click(readoutBtn());

    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    const text = onSubmitPrompt.mock.calls[0]![0] as string;

    expect(text).toContain("tool: image_vision");
    expect(text).not.toContain("image_edit");
    expect(text).toContain("image: att_src");
    expect(text).toContain("question: 这只猫戴的什么帽子？");
  });

  it("输入框为空 → 使用默认提问(1.3)", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt });

    fireEvent.click(readoutBtn());

    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    const text = onSubmitPrompt.mock.calls[0]![0] as string;
    expect(text).toMatch(/^question: .+$/m);
    expect(text).toContain("描述这张图片的内容。");
  });

  it("发出后**保留**输入框文字(与生成按钮既有行为一致;1.4)", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt });

    fireEvent.change(promptBox(), { target: { value: "几只猫？" } });
    fireEvent.click(readoutBtn());

    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    expect(promptBox().value).toBe("几只猫？");
  });
});

describe("★ 解读不吞噬生成输入(4.3 / 4.4)", () => {
  it("已添加参考图时解读:文本不含 reference_images,且参考图 chip 仍在", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({
      onSubmitPrompt,
      assets: [asset("att_src"), asset("att_ref2")],
    });

    // 经 @ 引用选择器添加一张参考图。
    fireEvent.click(document.querySelector("[data-canvas-ref-trigger]")!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-canvas-ref-option][data-att-id="att_ref2"]'),
      ).toBeTruthy(),
    );
    fireEvent.click(document.querySelector('[data-canvas-ref-option][data-att-id="att_ref2"]')!);
    await waitFor(() =>
      expect(document.querySelector('[data-canvas-ref-chip][data-att-id="att_ref2"]')).toBeTruthy(),
    );

    fireEvent.click(readoutBtn());
    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));

    const text = onSubmitPrompt.mock.calls[0]![0] as string;
    // 解读只看当前工作图 —— 参考图不进载荷。
    expect(text).not.toContain("reference_images");
    expect(text).not.toContain("att_ref2");
    expect(text).toContain("image: att_src");

    // 关键:参考图**没有被消费**,仍在栏里供后续生成使用(证明未调用 consumeSent)。
    expect(document.querySelector('[data-canvas-ref-chip][data-att-id="att_ref2"]')).toBeTruthy();
  });
});

describe("视觉模型偏好(3.2 / 3.3 / 3.4 / 3.5 / 5.4)", () => {
  it("未选模型 → 载荷不含 model 行(交由工具弹层;3.4)", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt, visionModelOptions: VISION_MODELS });

    fireEvent.click(readoutBtn());
    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));

    expect(onSubmitPrompt.mock.calls[0]![0] as string).not.toMatch(/^model:/m);
  });

  it("选择器渲染出注入的清单项(3.1)", () => {
    renderWorkbench({ onSubmitPrompt: vi.fn(), visionModelOptions: VISION_MODELS });
    expect(document.querySelector("[data-canvas-vision-model]")).toBeTruthy();
  });

  it("清单为空 → 选择器仍在,且解读按钮**未被禁用**(3.5 / 5.4)", () => {
    renderWorkbench({ onSubmitPrompt: vi.fn(), visionModelOptions: [] });

    expect(document.querySelector("[data-canvas-vision-model]")).toBeTruthy();
    expect(readoutBtn().hasAttribute("disabled")).toBe(false);
  });

  it("★ 偏好经 localStorage 恢复 → 载荷带 `model: provider/id`(3.2 / 3.3)", async () => {
    window.localStorage.setItem("pi-web.vision.model", "apiservices/gpt-5.4");

    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt, visionModelOptions: VISION_MODELS });

    fireEvent.click(readoutBtn());
    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));

    const text = onSubmitPrompt.mock.calls[0]![0] as string;
    // ⚠ 格式必须是 provider/id(工具 model 参数),不是裸 id。
    expect(text).toContain("model: apiservices/gpt-5.4");
    expect(text).not.toMatch(/^model: gpt-5\.4$/m);
  });
});

describe("★ 偏好写入路径(3.2 —— reviewer 首轮指出只测了读)", () => {
  it("经 UI 选中视觉模型 → localStorage 被写入,且后续解读载荷带该 model", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt, visionModelOptions: VISION_MODELS });

    expect(window.localStorage.getItem("pi-web.vision.model")).toBeNull();

    // 打开视觉模型下拉并选中一项(Radix Select:trigger → [role=option])。
    fireEvent.click(document.querySelector("[data-canvas-vision-model]")!);
    await waitFor(() =>
      expect(document.querySelectorAll("[role=option]").length).toBeGreaterThan(0),
    );
    const opt = Array.from(document.querySelectorAll("[role=option]")).find((o) =>
      (o.textContent ?? "").includes("GPT-5.4 Mini"),
    );
    expect(opt).toBeTruthy();
    fireEvent.click(opt!);

    // ① 偏好落盘。
    await waitFor(() =>
      expect(window.localStorage.getItem("pi-web.vision.model")).toBe("apiservices/gpt-5.4-mini"),
    );

    // ② 后续解读载荷带上它(provider/id 格式)。
    fireEvent.click(readoutBtn());
    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    expect(onSubmitPrompt.mock.calls[0]![0] as string).toContain("model: apiservices/gpt-5.4-mini");
  });

  it("选回「每次询问」→ 偏好被清除,载荷不再带 model", async () => {
    window.localStorage.setItem("pi-web.vision.model", "apiservices/gpt-5.4");
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt, visionModelOptions: VISION_MODELS });

    fireEvent.click(document.querySelector("[data-canvas-vision-model]")!);
    await waitFor(() =>
      expect(document.querySelectorAll("[role=option]").length).toBeGreaterThan(0),
    );
    const ask = Array.from(document.querySelectorAll("[role=option]")).find((o) =>
      (o.textContent ?? "").includes("每次询问"),
    );
    expect(ask).toBeTruthy();
    fireEvent.click(ask!);

    await waitFor(() => expect(window.localStorage.getItem("pi-web.vision.model")).toBeNull());

    fireEvent.click(readoutBtn());
    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    expect(onSubmitPrompt.mock.calls[0]![0] as string).not.toMatch(/^model:/m);
  });
});

describe("生成路径未被触碰(4.1 回归)", () => {
  it("点击生成按钮仍发出 image_edit 载荷", async () => {
    const onSubmitPrompt = vi.fn();
    renderWorkbench({ onSubmitPrompt });

    fireEvent.change(promptBox(), { target: { value: "调亮一点" } });
    fireEvent.click(document.querySelector("[data-canvas-generate]")!);

    await waitFor(() => expect(onSubmitPrompt).toHaveBeenCalledTimes(1));
    const text = onSubmitPrompt.mock.calls[0]![0] as string;
    expect(text).toContain("tool: image_edit");
    expect(text).not.toContain("image_vision");
  });
});

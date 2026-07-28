import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import type { WebExtension } from "@blksails/pi-web-kit";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession } from "../fixtures/mock-session.js";

// jsdom 的 PointerEvent 不继承 MouseEvent 的 clientX(经 fireEvent 传入即丢失);
// 以继承 MouseEvent 的替身垫平,使 clientX 可靠进入合成事件。
class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, props: PointerEventInit = {}) {
    super(type, props);
    this.pointerId = props.pointerId ?? 0;
  }
}
globalThis.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

/**
 * panelRight 连续拖拽宽度。
 * 设计: docs/superpowers/specs/2026-07-16-panelright-resizable-width-design.md
 *
 * panelWidth !== undefined → 外壳 rAF 跟手，内容拖毕重排并回传受控宽度；
 * 否则沿用 panelRatio 离散档(零回归)。
 */

const panelExt: WebExtension = {
  manifestId: "resize-test",
  slots: { panelRight: <div data-testid="panel" /> },
};

function aside(): HTMLElement {
  const el = document.querySelector("[data-pi-chat-aside]");
  if (el === null) throw new Error("aside 未渲染");
  return el as HTMLElement;
}

let animationFrame: FrameRequestCallback | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  animationFrame = undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrame = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    animationFrame = undefined;
  });
});

describe("panelRight 连续宽度(全受控)", () => {
  it("传 panelWidth(number) → aside 宽度为对应 px 且渲染拖拽分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth={480} />);
    expect(aside().style.width).toBe("480px");
    expect(aside().style.maxWidth).toBe("70%");
    expect(aside().className).toContain("border-l");
    expect(document.querySelector("[data-pi-panel-resizer]")).not.toBeNull();
  });

  it("传 panelWidth(string) → 原样入 style.width", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth="40vw" />);
    expect(aside().style.width).toBe("40vw");
  });

  it("连续模式隐藏离散档段控切换器", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth={480} />);
    expect(document.querySelector("[data-pi-panel-ratio-switch]")).toBeNull();
  });

  it("拖动时仅逐帧预览外壳；内容宽度不变，拖毕方回传", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={480}
        onPanelWidthChange={onChange}
        minPanelWidth={240}
        maxPanelWidth={800}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    // 容器右缘固定 1000;clientX=600 → 期望宽 = 1000-600 = 400(在 [240,800] 内)。
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      right: 1000,
      left: 0,
      width: 1000,
      top: 0,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 600 });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      (document.querySelector("[data-pi-panel-content]") as HTMLElement).style.width,
    ).toBe("480px");
    act(() => animationFrame?.(0));
    expect(aside().style.width).toBe("400px");
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 600 });
    expect(onChange).toHaveBeenCalledWith(400);
    expect(
      (document.querySelector("[data-pi-panel-content]") as HTMLElement).style.width,
    ).toBe("100%");
  });

  it("拖拽越界 → 取配置上限与容器 70% 较小值", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={480}
        onPanelWidthChange={onChange}
        minPanelWidth={240}
        maxPanelWidth={800}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      right: 1000, left: 0, width: 1000, top: 0, bottom: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // clientX=100 → 原始宽 900；配置 max 800，容器 70%=700 → 钳制 700。
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 100 });
    expect(onChange).toHaveBeenCalledWith(700);
  });

  it("窄容器中 70% 保护线优先于配置下限", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={320}
        onPanelWidthChange={onChange}
        minPanelWidth={320}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      right: 400, left: 0, width: 400, top: 0, bottom: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 80 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 0 });
    expect(onChange).toHaveBeenCalledWith(280);
  });

  it("不传 panelWidth → 沿用离散档(零回归):aside 走百分比宽、切换器仍在、无分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} />);
    expect(aside().style.width).toBe("33.333%"); // 默认 2:1
    expect(document.querySelector("[data-pi-panel-ratio-switch]")).not.toBeNull();
    expect(document.querySelector("[data-pi-panel-resizer]")).toBeNull();
  });
});

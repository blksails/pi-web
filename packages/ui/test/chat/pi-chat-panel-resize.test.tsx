import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
 * panelRight 连续拖拽宽度(全受控)。
 * 设计: docs/superpowers/specs/2026-07-16-panelright-resizable-width-design.md
 *
 * panelWidth !== undefined → 连续模式(宿主受控 style.width + 内置拖拽分隔条,
 * 离散档段控切换器隐藏);否则沿用 panelRatio 离散档(零回归)。
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

beforeEach(() => vi.clearAllMocks());

describe("panelRight 连续宽度(全受控)", () => {
  it("传 panelWidth(number) → aside 宽度为对应 px 且渲染拖拽分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth={480} />);
    expect(aside().style.width).toBe("480px");
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

  it("拖拽分隔条 → onPanelWidthChange 回传 clamp 后宽度", () => {
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
    expect(onChange).toHaveBeenCalledWith(400);
  });

  it("拖拽越界 → 钳制到 max", () => {
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
    // clientX=100 → 原始宽 900 > max 800 → 钳制 800。
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 100 });
    expect(onChange).toHaveBeenCalledWith(800);
  });

  it("不传 panelWidth → 沿用离散档(零回归):aside 走百分比宽、切换器仍在、无分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} />);
    expect(aside().style.width).toBe("33.333%"); // 默认 2:1
    expect(document.querySelector("[data-pi-panel-ratio-switch]")).not.toBeNull();
    expect(document.querySelector("[data-pi-panel-resizer]")).toBeNull();
  });
});

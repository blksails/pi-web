import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import type { WebExtension } from "@blksails/pi-web-kit";
import { definePanes } from "@blksails/pi-web-panes-kit";
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
 * panelWidth !== undefined → Pane 外壳 rAF 跟手，对话列冻结，空闲帧方重排回传；
 * 否则沿用 panelRatio 离散档(零回归)。
 */

const panelExt: WebExtension = {
  manifestId: "resize-test",
  // ★ 改用 pane 声明键(spec panes-only-right-panel 任务 5.3):右侧面板槽已废弃。
  // 本文件测的是**面板宽度控制与拖拽**,只需面板出现、不关心其内容 —— 换个让它出现的
  // 途径,保护面完全不变。
  panes: definePanes({
    id: "resize-test",
    initialPaneIds: ["p"],
    panes: [{
      id: "p",
      title: "P",
      document: { kind: "inline", srcDoc: "<!doctype html><p>p</p>" },
      capabilities: {},
    }],
  }),
};

function aside(): HTMLElement {
  const el = document.querySelector("[data-pi-chat-aside]");
  if (el === null) throw new Error("aside 未渲染");
  return el as HTMLElement;
}

let animationFrame: FrameRequestCallback | undefined;
let idleFrame: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  animationFrame = undefined;
  idleFrame = undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrame = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    animationFrame = undefined;
  });
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: vi.fn((callback: () => void) => {
      idleFrame = callback;
      return 2;
    }),
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    value: vi.fn(() => {
      idleFrame = undefined;
    }),
  });
});

describe("panelRight 连续宽度(全受控)", () => {
  it("传 panelWidth(number) → aside 宽度为对应 px 且渲染拖拽分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth={480} />);
    expect(aside().style.width).toBe("480px");
    expect(aside().style.maxWidth).toBe("");
    expect(
      (document.querySelector("[data-pi-chat-conversation-column]") as HTMLElement).style.minWidth,
    ).toBe("480px");
    expect(aside().className).toContain("border-l");
    expect(document.querySelector("[data-pi-panel-resizer]")).not.toBeNull();
  });

  it("传 panelWidth(string) → 原样入 style.width", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth="40vw" />);
    expect(aside().style.width).toBe("40vw");
  });

  it("wide chat keeps pane width unconstrained by a ratio", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={480}
        onPanelWidthChange={onChange}
        maxPanelWidth={800}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      right: 2000, left: 0, width: 2000, top: 0, bottom: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 1520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 100 });
    act(() => idleFrame?.());
    expect(onChange).toHaveBeenCalledWith(1520);
  });

  it("连续模式隐藏离散档段控切换器", () => {
    render(<PiChat session={mockSession()} extension={panelExt} panelWidth={480} />);
    expect(document.querySelector("[data-pi-panel-ratio-switch]")).toBeNull();
  });

  it("拖动时 Pane 逐帧跟手、对话列冻结；空闲帧方回传并重排", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={480}
        onPanelWidthChange={onChange}
        minPanelWidth={240}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    // 容器右缘固定 1000;clientX=600 → 期望宽 = 1000-600 = 400(在 [240,800] 内)。
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    const conversation = document.querySelector(
      "[data-pi-chat-conversation-column]",
    ) as HTMLElement;
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
    vi.spyOn(conversation, "getBoundingClientRect").mockReturnValue({
      right: 520, left: 0, width: 520, top: 0, bottom: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 600 });
    expect(conversation.style.width).toBe("520px");
    expect(aside().style.position).toBe("absolute");
    expect(onChange).not.toHaveBeenCalled();
    expect(
      (document.querySelector("[data-pi-panel-content]") as HTMLElement).style.width,
    ).toBe("100%");
    act(() => animationFrame?.(0));
    expect(aside().style.width).toBe("400px");
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 600 });
    expect(onChange).not.toHaveBeenCalled();
    act(() => idleFrame?.());
    expect(onChange).toHaveBeenCalledWith(400);
    expect(aside().style.width).toBe("400px");
    expect(conversation.style.width).toBe("");
    expect(aside().style.position).toBe("");
  });

  it("点击最大宽度分隔线不提交宽度", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={700}
        onPanelWidthChange={onChange}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 300 });
    expect(aside().style.position).toBe("");
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 300 });
    expect(onChange).not.toHaveBeenCalled();
    expect(aside().style.width).toBe("700px");
    expect(aside().style.position).toBe("");
  });

  it("拖拽越界 → 取配置上限、容器 70%、会话列下限让位后的较小值", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={480}
        onPanelWidthChange={onChange}
        minPanelWidth={240}
      />,
    );
    const resizer = document.querySelector("[data-pi-panel-resizer]") as HTMLElement;
    const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      right: 1000, left: 0, width: 1000, top: 0, bottom: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // clientX=100 → 原始宽 900；配置 max 800，容器 70%=700 → 再留会话列下限 480
    // (无左栏，roomForPanel=1000−0−480) → 520。
    fireEvent.pointerDown(resizer, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 100 });
    act(() => idleFrame?.());
    expect(onChange).toHaveBeenCalledWith(520);
  });

  it("窄容器中 70% 保护线优先于配置下限", () => {
    const onChange = vi.fn();
    render(
      <PiChat
        session={mockSession()}
        extension={panelExt}
        panelWidth={240}
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
    act(() => idleFrame?.());
    expect(onChange).toHaveBeenCalledWith(320);
  });

  it("不传 panelWidth → 沿用离散档(零回归):aside 走百分比宽、切换器仍在、无分隔条", () => {
    render(<PiChat session={mockSession()} extension={panelExt} />);
    expect(aside().style.width).toBe("33.333%"); // 默认 2:1
    expect(document.querySelector("[data-pi-panel-ratio-switch]")).not.toBeNull();
    expect(document.querySelector("[data-pi-panel-resizer]")).toBeNull();
  });

  it("容器收窄钳制只做临时视觉压缩、不写回宿主；恢复后回到受控宽度", () => {
    const onChange = vi.fn();
    const roCallbacks: ResizeObserverCallback[] = [];
    class MockRO implements ResizeObserver {
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        roCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("ResizeObserver", MockRO);
    try {
      render(
        <PiChat
          session={mockSession()}
          extension={panelExt}
          panelWidth={480}
          onPanelWidthChange={onChange}
          minPanelWidth={240}
        />,
      );
      const tree = document.querySelector("[data-pi-chat-pro]") as HTMLElement;
      const fireWidth = (width: number): void => {
        vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
          right: width, left: 0, width, top: 0, bottom: 0, height: 0, x: 0, y: 0,
          toJSON: () => ({}),
        } as DOMRect);
        act(() => {
          for (const cb of roCallbacks) cb([], MockRO.prototype as ResizeObserver);
        });
        act(() => animationFrame?.(0));
      };
      // 窄容器(600):availableMax=420 → max=240 < 480 → 临时压到 240,不写回宿主。
      fireWidth(600);
      expect(aside().style.width).toBe("240px");
      expect(onChange).not.toHaveBeenCalled();
      // 容器恢复(1000):max=520 ≥ 480 → 解除压缩,回到受控 480,仍不写回。
      fireWidth(1000);
      expect(aside().style.width).toBe("480px");
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

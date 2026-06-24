import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { mockSession, mockControls } from "../fixtures/mock-session.js";
import type { WebExtension } from "@blksails/web-kit";

/**
 * PiChat 接入 WebExtension(任务 5.2):
 * - Tier1 区域插槽(panelRight/headerCenter)渲染在 chat 内指定位置;
 * - Tier2 渲染器并入 registry(extId 命名空间);
 * - 无 extension 时行为不变(向后兼容)。
 */
describe("PiChat × WebExtension", () => {
  it("渲染扩展声明的 panelRight 与 headerCenter 到指定区域", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: {
        panelRight: <div data-testid="ext-panel">领域面板</div>,
        headerCenter: <div data-testid="ext-header">标题</div>,
      },
    };
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} extension={ext} />,
    );
    expect(screen.getByTestId("ext-panel")).toHaveTextContent("领域面板");
    expect(screen.getByTestId("ext-header")).toHaveTextContent("标题");
    expect(container.querySelector("[data-pi-ext-panel-right]")).not.toBeNull();
  });

  it("扩展 Tier2 渲染器并入提供的 registry(extId 命名空间)", () => {
    const reg = createRendererRegistry();
    function CardRenderer(): null {
      return null;
    }
    const ext: WebExtension = {
      manifestId: "acme",
      renderers: { dataParts: { "data-card": CardRenderer } },
    };
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        registry={reg}
        extension={ext}
      />,
    );
    expect(reg.resolveDataPartRenderer("data-card")).toBe(CardRenderer);
  });

  it("无 extension 时不渲染扩展区域(向后兼容)", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} />,
    );
    expect(container.querySelector("[data-pi-ext-panel-right]")).toBeNull();
    expect(container.querySelector("[data-pi-ext-header]")).toBeNull();
  });

  it("panelRight 比例:初始 3:7 + 运行时切换 居中/2:1/3:7", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { panelRight: <div data-testid="ext-panel">领域面板</div> },
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    const aside = container.querySelector("[data-pi-chat-aside]");
    const sw = container.querySelector("[data-pi-panel-ratio-switch]");
    // 初始 3:7:aside 宽度 70%,切换器反映当前档位。
    expect(aside?.getAttribute("data-pi-panel-ratio")).toBe("3:7");
    expect((aside as HTMLElement).style.width).toBe("70%");
    expect(sw?.getAttribute("data-pi-panel-ratio-switch")).toBe("3:7");

    // 切到 2:1:宽度 33.333%。
    fireEvent.click(screen.getByText("2:1"));
    const aside21 = container.querySelector("[data-pi-chat-aside]") as HTMLElement;
    expect(aside21.getAttribute("data-pi-panel-ratio")).toBe("2:1");
    expect(aside21.style.width).toBe("33.333%");

    // 切到 居中:收起 aside(panelRight 不渲染),但切换器仍在场可切回。
    fireEvent.click(screen.getByText("居中"));
    expect(container.querySelector("[data-pi-chat-aside]")).toBeNull();
    expect(container.querySelector("[data-pi-ext-panel-right]")).toBeNull();
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).not.toBeNull();

    // 从 居中 切回 3:7:panelRight 重新挂载。
    fireEvent.click(screen.getByText("3:7"));
    expect(screen.getByTestId("ext-panel")).toBeInTheDocument();
  });

  it("无 panelRight 时不渲染比例切换器", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { headerCenter: <div data-testid="ext-header">标题</div> },
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).toBeNull();
  });
});

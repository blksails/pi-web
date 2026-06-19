import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { mockSession, mockControls } from "../fixtures/mock-session.js";
import type { WebExtension } from "@pi-web/web-kit";

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
});

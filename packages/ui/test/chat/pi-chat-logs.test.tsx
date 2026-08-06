import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockControls, mockSession } from "../fixtures/mock-session.js";

describe("PiChat isolated logs pane", () => {
  it("declares logs without auto-opening a React region", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} showLogs logsPanelVisible />,
    );
    expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
    expect(container.querySelector('iframe[title="日志"]')).toBeNull();
    // 无打开实例时 host content-well 空态入口（tabs chrome 在 child 文档内）。
    expect(screen.getByRole("button", { name: "打开一个 Pane" })).toBeInTheDocument();
  });

  it("opens logs only on demand and uses an HTML Guest iframe", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} showLogs logsPanelVisible />,
    );
    await user.click(screen.getByRole("button", { name: "打开一个 Pane" }));
    await user.click(screen.getByRole("button", { name: /日志/ }));
    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="日志"]');
    expect(iframe).not.toBeNull();
    // inline srcDoc + PanesHost 默认 chrome 包装（tabs 条），不再依赖 public/pane-logs.html。
    expect(iframe?.hasAttribute("srcdoc")).toBe(true);
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("data-pi-pane-chrome");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("data-pi-logs-region");
    expect(container.querySelector("[data-pane-carrier=host-view]")).toBeNull();
  });

  it("does not declare the logs pane when either visibility gate is closed", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} showLogs logsPanelVisible={false} />,
    );
    expect(container.querySelector("[data-panes-host]")).toBeNull();
  });
});

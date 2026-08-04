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
    expect(screen.getByRole("button", { name: "新开 Pane" })).toBeInTheDocument();
  });

  it("opens logs only on demand and uses an HTML Guest iframe", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} showLogs logsPanelVisible />,
    );
    await user.click(screen.getByRole("button", { name: "新开 Pane" }));
    await user.click(screen.getByRole("button", { name: /日志/ }));
    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="日志"]');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toMatch(/^data:text\/html/);
    expect(container.querySelector("[data-pane-carrier=host-view]")).toBeNull();
  });

  it("does not declare the logs pane when either visibility gate is closed", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} showLogs logsPanelVisible={false} />,
    );
    expect(container.querySelector("[data-panes-host]")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockControls, mockSession } from "../fixtures/mock-session.js";

describe("PiChat logs slot isolation", () => {
  it("does not render a logs contribution into the host tree", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        showLogs
        logsPanelVisible
        extension={{
          manifestId: "logs-slot-test",
          slots: { logs: <div data-testid="ext-logs-slot">host contribution</div> },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "新开 Pane" }));
    await user.click(screen.getByRole("button", { name: /日志/ }));
    expect(container.querySelector("[data-testid=ext-logs-slot]")).toBeNull();
    expect(container.querySelector('iframe[title="日志"]')).not.toBeNull();
  });
});

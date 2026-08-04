import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockControls, mockSession } from "../fixtures/mock-session.js";

describe("PiChat logs position compatibility", () => {
  it.each(["bottom", "right", "drawer", "top"] as const)(
    "%s no longer mounts a host React log panel",
    (position) => {
      const { container } = render(
        <PiChat
          session={mockSession()}
          controls={mockControls()}
          showLogs
          logsPanelVisible
          logsPanelPosition={position}
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
      expect(container.querySelector('iframe[title="日志"]')).toBeNull();
    },
  );
});

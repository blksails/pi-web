import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { SessionSnapshot } from "@blksails/pi-web-protocol";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession, mockControls, MockTransport } from "../fixtures/mock-session.js";

/**
 * message-queue-ui:PiChat 忙时按意图排队(Enter→steer / Alt+Enter→followUp)、队列可视化、取回回填。
 */

const BUSY_SESSION = {
  lifecycle: "ready",
  busy: true,
} as unknown as SessionSnapshot;

function makeSession() {
  const transport = new MockTransport([{ type: "start", messageId: "m1" }, { type: "finish" }]);
  return mockSession({
    transport: transport as unknown as ReturnType<typeof mockSession>["transport"],
  });
}

function textbox() {
  return screen.getByRole("textbox", { name: /消息输入|message/i });
}

describe("PiChat message queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("忙时 Enter → controls.steer 携带文本(不发常规 prompt)", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ busy: true, session: BUSY_SESSION });
    render(<PiChat session={makeSession()} controls={controls} />);
    await user.type(textbox(), "keep going");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(controls.steer).toHaveBeenCalledWith({ message: "keep going" }),
    );
    expect(controls.followUp).not.toHaveBeenCalled();
    // 成功后清空输入
    await waitFor(() => expect(textbox()).toHaveValue(""));
  });

  it("忙时 Alt+Enter → controls.followUp", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ busy: true, session: BUSY_SESSION });
    render(<PiChat session={makeSession()} controls={controls} />);
    await user.type(textbox(), "afterwards");
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await waitFor(() =>
      expect(controls.followUp).toHaveBeenCalledWith({ message: "afterwards" }),
    );
    expect(controls.steer).not.toHaveBeenCalled();
  });

  it("空闲时 Enter → 常规发送(不排队)", async () => {
    const user = userEvent.setup();
    const controls = mockControls({ busy: false, session: undefined });
    render(<PiChat session={makeSession()} controls={controls} />);
    await user.type(textbox(), "hello");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(textbox()).toHaveValue(""));
    expect(controls.steer).not.toHaveBeenCalled();
    expect(controls.followUp).not.toHaveBeenCalled();
  });

  it("队列非空时渲染面板与 pending 计数", () => {
    const controls = mockControls({
      queue: { steering: ["a"], followUp: ["b"] },
    });
    const { container } = render(
      <PiChat session={makeSession()} controls={controls} />,
    );
    expect(
      container.querySelector("[data-pi-queue-count]")?.getAttribute(
        "data-pi-queue-count",
      ),
    ).toBe("2");
  });

  it("队列非空时 Esc → clearQueue 回填编辑器并按顺序连接", async () => {
    const user = userEvent.setup();
    const controls = mockControls({
      queue: { steering: ["draft one"], followUp: ["draft two"] },
    });
    (controls.clearQueue as ReturnType<typeof vi.fn>).mockResolvedValue({
      steering: ["draft one"],
      followUp: ["draft two"],
    });
    render(<PiChat session={makeSession()} controls={controls} />);
    const box = textbox();
    box.focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(controls.clearQueue).toHaveBeenCalled());
    await waitFor(() =>
      expect(box).toHaveValue("draft one\ndraft two"),
    );
  });
});

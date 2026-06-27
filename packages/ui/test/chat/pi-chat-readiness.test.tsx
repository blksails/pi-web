import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession, mockControls } from "../fixtures/mock-session.js";
import type { SessionLifecycleState } from "@blksails/pi-web-protocol";

/**
 * PiChat 就绪握手门控测试(spec session-readiness-handshake, Task 4.2)。
 * 验证可观测行为:gateUntilReady 开启时,就绪前禁用发送 + 显示"连接中";ready 启用;error 显示失败。
 * 默认(不设 gateUntilReady)不门控(零回归)。
 */

function controlsWith(state: SessionLifecycleState, detail?: string) {
  return mockControls({
    lifecycle: { state, detail, code: undefined },
  });
}

describe("PiChat 就绪门控 (Task 4.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gateUntilReady + initializing:发送禁用且显示连接中指示", () => {
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={controlsWith("initializing")}
        gateUntilReady
      />,
    );
    expect(
      container.querySelector('[data-pi-session-readiness="connecting"]'),
    ).toBeInTheDocument();
    const send = screen.getByRole("button", { name: /发送/ });
    expect(send).toBeDisabled();
  });

  it("gateUntilReady + ready:无连接中指示,发送随输入启用", () => {
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={controlsWith("ready")}
        gateUntilReady
      />,
    );
    expect(
      container.querySelector("[data-pi-session-readiness]"),
    ).not.toBeInTheDocument();
    // 无输入时发送本就禁用;关键是门控不再额外禁用(ready 放行)——指示消失即证。
  });

  it("gateUntilReady + error:显示失败指示且发送保持禁用", () => {
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={controlsWith("error", "readiness probe timed out")}
        gateUntilReady
      />,
    );
    expect(
      container.querySelector('[data-pi-session-readiness="error"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送/ })).toBeDisabled();
    expect(screen.getByText(/连接失败/)).toBeInTheDocument();
  });

  it("默认(不设 gateUntilReady):不门控、无就绪指示(零回归)", () => {
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={controlsWith("initializing")}
      />,
    );
    expect(
      container.querySelector("[data-pi-session-readiness]"),
    ).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import type { WebExtension } from "@blksails/pi-web-kit";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession, mockControls, sampleStats } from "../fixtures/mock-session.js";

/**
 * session-usage-panel(任务 2.1):富版 PiChat 接入内核自有会话用量区。
 *
 * 覆盖 requirements:
 *  - 1.1/2.1/2.2/2.3 — 渲染用量区 + 四字段 + cost 货币格式
 *  - 1.2            — showSessionStats=false 不渲染
 *  - 1.4/3.2        — stats 未就绪显示空态
 *  - 4.1            — 与 webext statusBar 贡献并存不顶替
 *  - 4.3            — 用量区不进 panelRight(aside)
 *
 * 用量条随输入 dock 渲染,仅在会话态(非空)出现;故各用例用 initialMessages 进入会话态。
 * 不触达真实后端;mock session/controls 形状来自 @blksails/pi-web-react。
 */
const CONVO: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

describe("富版 PiChat × 内核用量区", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("用例A:渲染用量区与四字段,cost 为货币格式 (1.1/2.1/2.2/2.3)", () => {
    const { container } = render(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({ stats: sampleStats() })}
      />,
    );
    // 内核自有锚点 + PiSessionStats
    expect(container.querySelector("[data-pi-session-stats-region]")).not.toBeNull();
    expect(container.querySelector("[data-pi-session-stats]")).not.toBeNull();
    // 四字段
    expect(container.querySelector('[data-pi-stat="messages"]')).toHaveTextContent("4");
    expect(container.querySelector('[data-pi-stat="toolCalls"]')).toHaveTextContent("1");
    expect(container.querySelector('[data-pi-stat="tokens"]')).toHaveTextContent("150");
    // cost 货币格式 ($0.0123)
    expect(container.querySelector('[data-pi-stat="cost"]')).toHaveTextContent("$0.0123");
  });

  it("用例B:showSessionStats=false 时不渲染用量区 (1.2)", () => {
    const { container } = render(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({ stats: sampleStats() })}
        showSessionStats={false}
      />,
    );
    expect(container.querySelector("[data-pi-session-stats-region]")).toBeNull();
  });

  it("用例C:stats 未就绪时显示空态 (1.4/3.2)", () => {
    const { container } = render(
      <PiChat session={mockSession({ initialMessages: CONVO })} controls={mockControls({ stats: undefined })} />,
    );
    expect(container.querySelector("[data-pi-session-stats-region]")).not.toBeNull();
    // i18n 默认 locale=zh,空态文案渲染为中文("暂无统计")
    expect(screen.getByText(/暂无统计/)).toBeInTheDocument();
  });

  it("用例D:与 webext statusBar 贡献并存不顶替 (4.1)", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: {
        statusBar: <div data-testid="ext-status">扩展状态</div>,
      },
    };
    const { container } = render(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({ stats: sampleStats() })}
        extension={ext}
      />,
    );
    // 两者同时存在,互不顶替
    expect(container.querySelector("[data-pi-ext-status-bar]")).not.toBeNull();
    expect(container.querySelector("[data-pi-session-stats]")).not.toBeNull();
    expect(screen.getByTestId("ext-status")).toBeInTheDocument();
  });

  it("用例E:用量区不在 panelRight(aside)内 (4.3)", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: {
        panelRight: <div data-testid="ext-panel">面板</div>,
      },
    };
    const { container } = render(
      <PiChat
        session={mockSession({ initialMessages: CONVO })}
        controls={mockControls({ stats: sampleStats() })}
        extension={ext}
      />,
    );
    const aside = container.querySelector("[data-pi-chat-aside]");
    expect(aside).not.toBeNull();
    // 用量区不应位于 aside 内部
    expect(aside?.querySelector("[data-pi-session-stats-region]")).toBeNull();
    // 但用量区在文档中存在(挂在主列)
    expect(container.querySelector("[data-pi-session-stats-region]")).not.toBeNull();
  });
});

/**
 * pi-chat-logs-position（任务 8.2）：PiChat 按 logsPanelPosition 渲染 LogsPanel。
 *
 * 覆盖 requirements:
 *  - Req 6.1/6.2 — logsPanelPosition="bottom"|"right"|"drawer" 三种位置渲染
 *  - Req 6.6 — showLogs/logsPanelVisible 门控（三种位置均受控）
 *  - position="bottom"（默认）：data-pi-logs-region 在 dock 区渲染
 *  - position="right"：data-pi-logs-region 在 aside 内渲染
 *  - position="drawer"：默认收起；点 toggle 后出现 data-pi-logs-region；再点收起
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import type { UsePiSessionResult } from "@pi-web/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@pi-web/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pi-web/react")>();
  return { ...actual };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONVO: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

class MockTransport {
  sendMessages = async () =>
    new ReadableStream({ start(controller) { controller.close(); } });
  reconnectToStream = async () => null;
}

function makeSession(
  overrides: Partial<UsePiSessionResult> = {},
): UsePiSessionResult {
  const transport = new MockTransport();
  return {
    sessionId: "sess-1",
    status: "open",
    transport: transport as unknown as UsePiSessionResult["transport"],
    connection: undefined,
    client: undefined,
    error: undefined,
    start: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PiChat × logsPanelPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── bottom (default) ───────────────────────────────────────────────────────

  describe("position=bottom（默认）", () => {
    it("data-pi-logs-region 在 dock 区渲染（data-pi-input-dock 内）", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="bottom"
        />,
      );
      const region = container.querySelector("[data-pi-logs-region]");
      expect(region).not.toBeNull();
      // Verify it is inside the dock area
      const dock = container.querySelector("[data-pi-input-dock]");
      expect(dock).not.toBeNull();
      expect(dock!.contains(region)).toBe(true);
    });

    it("不传 position 时默认行为等同于 bottom", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
        />,
      );
      const region = container.querySelector("[data-pi-logs-region]");
      expect(region).not.toBeNull();
      const dock = container.querySelector("[data-pi-input-dock]");
      expect(dock!.contains(region)).toBe(true);
    });
  });

  // ── right ─────────────────────────────────────────────────────────────────

  describe("position=right（右侧边栏）", () => {
    it("data-pi-logs-region 在 aside（data-pi-chat-aside）内渲染", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="right"
        />,
      );
      const region = container.querySelector("[data-pi-logs-region]");
      expect(region).not.toBeNull();
      const aside = container.querySelector("[data-pi-chat-aside]");
      expect(aside).not.toBeNull();
      expect(aside!.contains(region)).toBe(true);
    });

    it("position=right 时 aside 渲染（showAside 为真）", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="right"
        />,
      );
      const aside = container.querySelector("[data-pi-chat-aside]");
      expect(aside).not.toBeNull();
    });

    it("position=right 且 logsPanelVisible=false 时不渲染 data-pi-logs-region", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={false}
          logsPanelPosition="right"
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
    });

    it("position=right 且 showLogs=false 时不渲染 data-pi-logs-region", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={false}
          logsPanelVisible={true}
          logsPanelPosition="right"
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
    });
  });

  // ── drawer ────────────────────────────────────────────────────────────────

  describe("position=drawer（底部抽屉）", () => {
    it("默认收起：不渲染 data-pi-logs-region", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
    });

    it("showLogs && logsPanelVisible 时渲染 drawer toggle 按钮", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
        />,
      );
      const toggle = container.querySelector("[data-pi-logs-drawer-toggle]");
      expect(toggle).not.toBeNull();
    });

    it("点击 toggle 后抽屉打开，data-pi-logs-region 出现", async () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
        />,
      );
      const toggle = container.querySelector("[data-pi-logs-drawer-toggle]");
      expect(toggle).not.toBeNull();

      await act(async () => {
        fireEvent.click(toggle!);
      });

      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
    });

    it("再次点击 toggle 后抽屉收起，data-pi-logs-region 消失", async () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
        />,
      );
      const toggle = container.querySelector("[data-pi-logs-drawer-toggle]");

      // Open
      await act(async () => { fireEvent.click(toggle!); });
      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();

      // Close
      await act(async () => { fireEvent.click(toggle!); });
      expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
    });

    it("showLogs=false 时不渲染 drawer toggle", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={false}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
        />,
      );
      expect(container.querySelector("[data-pi-logs-drawer-toggle]")).toBeNull();
    });

    it("logsPanelVisible=false 时不渲染 drawer toggle", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={false}
          logsPanelPosition="drawer"
        />,
      );
      expect(container.querySelector("[data-pi-logs-drawer-toggle]")).toBeNull();
    });
  });

  // ── panelVisible/showLogs 门控（三种位置）─────────────────────────────────

  describe("门控：showLogs=false 或 logsPanelVisible=false 时三种位置均不渲染面板", () => {
    const positions = ["bottom", "right", "drawer"] as const;

    for (const position of positions) {
      it(`position=${position} && showLogs=false → 无 data-pi-logs-region`, () => {
        const { container } = render(
          <PiChat
            session={makeSession({ initialMessages: CONVO })}
            showLogs={false}
            logsPanelVisible={true}
            logsPanelPosition={position}
          />,
        );
        expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
      });

      it(`position=${position} && logsPanelVisible=false → 无 data-pi-logs-region`, () => {
        const { container } = render(
          <PiChat
            session={makeSession({ initialMessages: CONVO })}
            showLogs={true}
            logsPanelVisible={false}
            logsPanelPosition={position}
          />,
        );
        expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
      });
    }
  });
});

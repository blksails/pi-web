/**
 * pi-chat-logs-slot（任务 8.3）：PiChat 接通 logs webext slot，
 * 与内核 LogsPanel 并存渲染。
 *
 * 覆盖 requirements:
 *  - Req 5.1 — logs slot 贡献与内核面板并存（不替换）
 *  - 三种位置（bottom/right/drawer 各自容器内）均渲染 logs slot
 *  - drawer 收起时不渲染 slot；drawer 展开时 slot 出现
 *  - 无 slots.logs 时不渲染 slot 容器，不报错
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import type { UsePiSessionResult } from "@blksails/pi-web-react";
import type { WebExtension } from "@blksails/pi-web-kit";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@blksails/pi-web-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blksails/pi-web-react")>();
  return { ...actual };
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

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

/** webext with a logs slot contribution */
function makeExtWithLogsSlot(): WebExtension {
  return {
    manifestId: "test-ext",
    slots: {
      logs: (
        <div data-testid="ext-logs-slot">webext logs slot content</div>
      ),
    },
  };
}

/** webext without logs slot */
function makeExtWithoutLogsSlot(): WebExtension {
  return {
    manifestId: "test-ext",
    slots: {
      headerCenter: <span>header</span>,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PiChat × logs webext slot（任务 8.3）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── position=bottom ────────────────────────────────────────────────────────

  describe("position=bottom（默认）", () => {
    it("slots.logs 内容与内核 data-pi-logs-region 并存（同容器或紧邻）", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="bottom"
          extension={ext}
        />,
      );
      // 内核面板仍在
      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
      // webext slot 内容也在
      expect(container.querySelector("[data-testid='ext-logs-slot']")).not.toBeNull();
    });

    it("无 slots.logs 时只有内核 data-pi-logs-region，不报错", () => {
      const ext = makeExtWithoutLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="bottom"
          extension={ext}
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });

    it("showLogs=false 时 logs slot 不渲染", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={false}
          logsPanelVisible={true}
          logsPanelPosition="bottom"
          extension={ext}
        />,
      );
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });

    it("logsPanelVisible=false 时 logs slot 不渲染", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={false}
          logsPanelPosition="bottom"
          extension={ext}
        />,
      );
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });
  });

  // ── position=right ─────────────────────────────────────────────────────────

  describe("position=right（右侧边栏）", () => {
    it("slots.logs 内容与内核 data-pi-logs-region 在 aside 内并存", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="right"
          extension={ext}
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
      expect(container.querySelector("[data-testid='ext-logs-slot']")).not.toBeNull();
    });

    it("logsPanelVisible=false 时 logs slot 不渲染（position=right）", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={false}
          logsPanelPosition="right"
          extension={ext}
        />,
      );
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });
  });

  // ── position=drawer ────────────────────────────────────────────────────────

  describe("position=drawer（底部抽屉）", () => {
    it("drawer 收起时 logs slot 不渲染", () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
          extension={ext}
        />,
      );
      // drawer is collapsed by default
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });

    it("drawer 展开后 logs slot 出现（与内核 LogsPanel 并存）", async () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
          extension={ext}
        />,
      );
      const toggle = container.querySelector("[data-pi-logs-drawer-toggle]");
      expect(toggle).not.toBeNull();

      await act(async () => {
        fireEvent.click(toggle!);
      });

      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
      expect(container.querySelector("[data-testid='ext-logs-slot']")).not.toBeNull();
    });

    it("drawer 关闭后 logs slot 消失", async () => {
      const ext = makeExtWithLogsSlot();
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="drawer"
          extension={ext}
        />,
      );
      const toggle = container.querySelector("[data-pi-logs-drawer-toggle]");

      // open
      await act(async () => { fireEvent.click(toggle!); });
      expect(container.querySelector("[data-testid='ext-logs-slot']")).not.toBeNull();

      // close
      await act(async () => { fireEvent.click(toggle!); });
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });
  });

  // ── no extension ───────────────────────────────────────────────────────────

  describe("无 extension 时行为不变", () => {
    it("无 extension 时内核面板正常，无 slot 容器", () => {
      const { container } = render(
        <PiChat
          session={makeSession({ initialMessages: CONVO })}
          showLogs={true}
          logsPanelVisible={true}
          logsPanelPosition="bottom"
        />,
      );
      expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
      expect(container.querySelector("[data-testid='ext-logs-slot']")).toBeNull();
    });
  });
});

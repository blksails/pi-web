/**
 * pi-chat-logs（任务 3.4）：PiChat 日志面板挂载与实时链路闭合测试。
 *
 * 覆盖 requirements:
 *  - Req 6.6 — showLogs=true && logsPanelVisible=true 时渲染 data-pi-logs-region
 *  - Req 6.6 — logsPanelVisible=false 时不渲染面板
 *  - Req 3.2→3.4 — onLogsFrame 接线后，模拟 control:logs 帧 → 面板出现对应日志行
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import type { UsePiSessionResult } from "@blksails/pi-web-react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock @blksails/pi-web-react so we can capture onLogsFrame callbacks.
let capturedOnLogsFrame: ((entries: import("@blksails/pi-web-logger").LogEntry[]) => void) | undefined;

vi.mock("@blksails/pi-web-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blksails/pi-web-react")>();
  return {
    ...actual,
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONVO: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

function makeControlStore() {
  capturedOnLogsFrame = undefined;
  return {
    onLogsFrame: vi.fn((cb: (entries: import("@blksails/pi-web-logger").LogEntry[]) => void) => {
      capturedOnLogsFrame = cb;
      return () => { capturedOnLogsFrame = undefined; };
    }),
    onUiRpcResponse: vi.fn(() => () => {}),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => ({
      queue: { steering: [], followUp: [] },
      stats: undefined,
      error: null,
      extensionUiQueue: [],
      ambient: {
        notifications: [],
        statuses: {},
        widgets: {},
        title: undefined,
        editorText: undefined,
      },
    })),
  };
}

function mockConnection(controlStore: ReturnType<typeof makeControlStore>) {
  return {
    controlStore,
    openControlOnlyStream: vi.fn(() => () => {}),
  };
}

// Minimal MockTransport implementing ChatTransport interface.
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

describe("PiChat × LogsPanel 挂载", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnLogsFrame = undefined;
  });

  it("showLogs=true && logsPanelVisible=true 时渲染 data-pi-logs-region", () => {
    const { container } = render(
      <PiChat
        session={makeSession({ initialMessages: CONVO })}
        showLogs={true}
        logsPanelVisible={true}
      />,
    );
    expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
  });

  it("showLogs=false 时不渲染 data-pi-logs-region", () => {
    const { container } = render(
      <PiChat
        session={makeSession({ initialMessages: CONVO })}
        showLogs={false}
      />,
    );
    expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
  });

  it("logsPanelVisible=false 时不渲染面板（即使 showLogs=true）（Req 6.6）", () => {
    const { container } = render(
      <PiChat
        session={makeSession({ initialMessages: CONVO })}
        showLogs={true}
        logsPanelVisible={false}
      />,
    );
    expect(container.querySelector("[data-pi-logs-region]")).toBeNull();
  });

  it("control:logs 帧 → 面板出现对应日志行（实时链路 3.2→面板）", async () => {
    const controlStore = makeControlStore();
    const connection = mockConnection(controlStore);

    render(
      <PiChat
        session={makeSession({
          initialMessages: CONVO,
          connection: connection as unknown as UsePiSessionResult["connection"],
        })}
        showLogs={true}
        logsPanelVisible={true}
      />,
    );

    // After mount, onLogsFrame should have been registered.
    expect(controlStore.onLogsFrame).toHaveBeenCalled();
    expect(capturedOnLogsFrame).toBeDefined();

    // Simulate a control:logs frame with one log entry.
    const entry: import("@blksails/pi-web-logger").LogEntry = {
      id: "log-1",
      ts: Date.now(),
      level: "info",
      ns: "agent:test",
      msg: "hello from agent",
    };

    await act(async () => {
      capturedOnLogsFrame!([entry]);
    });

    // The log message should appear in the panel.
    expect(screen.getByText("hello from agent")).toBeInTheDocument();
  });
});

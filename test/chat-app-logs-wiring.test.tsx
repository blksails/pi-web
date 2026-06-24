/**
 * chat-app × showLogs 接线测试（任务 5.4）。
 *
 * 断言 ChatApp 向 PiChat 传入 showLogs=true，以及 logsPanelVisible 由
 * logging 配置的 outputs.panelVisible 控制（Req 6.6）。
 *
 * Requirements: 5.1, 6.6
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, act } from "@testing-library/react";

// Spy captures props forwarded to <PiChat>.
const piChatSpy = vi.fn<(props: Record<string, unknown>) => void>();

vi.mock("@pi-web/ui", () => ({
  PiChat: (props: Record<string, unknown>): React.JSX.Element => {
    piChatSpy(props);
    return <div data-test-pi-chat />;
  },
  PiChatBasic: (): React.JSX.Element => <div data-test-pi-chat-basic />,
}));

const fakeSession = {
  sessionId: "sess-logs-test",
  transport: { kind: "fake" },
  connection: { kind: "fake-connection" },
  status: "open",
  error: undefined,
  client: { kind: "fake-client" },
};

vi.mock("@pi-web/react", () => ({
  PiProvider: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <>{children}</>
  ),
  usePiSession: () => fakeSession,
  usePiControls: () => ({ kind: "controls" }),
  useExtensionUI: () => ({ kind: "extension-ui" }),
}));

// Helper to stub /api/config/logging fetch response.
function stubLoggingConfig(config: {
  outputs?: { panelVisible?: boolean; panelPosition?: string };
} | null): void {
  if (config === null) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
  } else {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ values: config }),
      }),
    );
  }
}

// Import after mocks are set up.
import { ChatApp } from "@/components/chat-app";

afterEach(() => {
  cleanup();
  piChatSpy.mockClear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Render ChatApp and advance to the active session state. */
async function startSession(): Promise<void> {
  render(
    <ChatApp
      defaultSource="./examples/logging-demo-agent"
      defaultModel="stub-model"
      defaultCwd="/tmp"
    />,
  );
  const submit = document.querySelector("[data-agent-source-submit]");
  expect(submit).not.toBeNull();
  await act(async () => {
    fireEvent.click(submit as Element);
  });
}

describe("ChatApp × showLogs wiring（Req 6.6）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PiChat 收到 showLogs=true（日志面板常开）", async () => {
    stubLoggingConfig({ outputs: { panelVisible: true } });
    await startSession();
    expect(piChatSpy).toHaveBeenCalled();
    const props = piChatSpy.mock.calls[0]?.[0];
    expect(props?.showLogs).toBe(true);
  });

  it("panelVisible=true 时 PiChat 收到 logsPanelVisible=true", async () => {
    stubLoggingConfig({ outputs: { panelVisible: true } });
    await startSession();
    // Wait for async config fetch to update state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelVisible).toBe(true);
  });

  it("panelVisible=false 时 PiChat 收到 logsPanelVisible=false（Req 6.6）", async () => {
    stubLoggingConfig({ outputs: { panelVisible: false } });
    await startSession();
    // Wait for async config fetch to update panelVisible state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelVisible).toBe(false);
  });

  it("配置加载失败时默认 logsPanelVisible=true（安全兜底）", async () => {
    stubLoggingConfig(null);
    await startSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    // Falls back to true (safe default).
    expect(lastProps?.logsPanelVisible).toBe(true);
  });
});

describe("ChatApp × logsPanelPosition wiring（Req 6.1/6.2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("panelPosition 未配置时 PiChat 收到 logsPanelPosition=bottom（默认值）", async () => {
    stubLoggingConfig({ outputs: {} });
    await startSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelPosition).toBe("bottom");
  });

  it("panelPosition=right 时 PiChat 收到 logsPanelPosition=right", async () => {
    stubLoggingConfig({ outputs: { panelPosition: "right" } });
    await startSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelPosition).toBe("right");
  });

  it("panelPosition=drawer 时 PiChat 收到 logsPanelPosition=drawer", async () => {
    stubLoggingConfig({ outputs: { panelPosition: "drawer" } });
    await startSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelPosition).toBe("drawer");
  });

  it("配置加载失败时默认 logsPanelPosition=bottom（安全兜底）", async () => {
    stubLoggingConfig(null);
    await startSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const lastProps = piChatSpy.mock.calls[piChatSpy.mock.calls.length - 1]?.[0];
    expect(lastProps?.logsPanelPosition).toBe("bottom");
  });
});

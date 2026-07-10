/**
 * chat-app assembly: the session-active branch renders the default rich chat UI
 * <PiChat> (formerly <PiChat>, now the convergent default), while preserving
 * the same session/controls/extensionUI wiring driven by the @blksails/pi-web-react hooks
 * (Req 7.4). The ~/.pi/agent config + session-assembly chain is unchanged; only
 * the chat UI component name is updated to the converged default.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

// Capture the props passed to whichever chat component chat-app renders so we
// can assert the default rich <PiChat> is used and that wiring is forwarded.
const piChatSpy = vi.fn<(props: Record<string, unknown>) => void>();
const piChatBasicSpy = vi.fn<(props: Record<string, unknown>) => void>();

vi.mock("@blksails/pi-web-ui", async () => ({
  // AgentSourcePicker 已从应用层 components/ 搬进 ui 包,于是也落进了这个 mock 的替换面。
  // 本文件的 startSession 依赖 picker 的真实交互契约(填输入 → 点 [data-agent-source-submit]),
  // 故必须用真实组件而非 stub。直接加载源文件、绕开包 exports:picker 内部引的是相对路径
  // (`../ui/dialog.js` / `../i18n/index.js`),不会再回到这个被 mock 的模块。
  AgentSourcePicker: (await import("../packages/ui/src/chat/agent-source-picker.js"))
    .AgentSourcePicker,
  PiChat: (props: Record<string, unknown>): React.JSX.Element => {
    piChatSpy(props);
    // 无 head 设计后,全局控件(设置/日志开关/语言/主题 + rail 关闭态的新建会话/切换源)
    // 下沉到侧栏账户区,经 slots.sidebar 注入。忠实渲染该槽,测试才能触达这些控件。
    const slots = props.slots as { sidebar?: React.ReactNode } | undefined;
    return <div data-test-pi-chat>{slots?.sidebar}</div>;
  },
  PiChatBasic: (props: Record<string, unknown>): React.JSX.Element => {
    piChatBasicSpy(props);
    return <div data-test-pi-chat-basic />;
  },
  SessionListPanel: (): React.JSX.Element => <div data-test-session-list />,
  // 免门控(source 声明驱动):chat-app 经 resolveSlot 探测 launcherRail 贡献;测试 source 无
  // webext 声明 → undefined(走 rail 关闭分支,与生产语义一致)。
  resolveSlot: (): undefined => undefined,
  SlotHost: (): null => null,
  LauncherRail: (): React.JSX.Element => <div data-test-launcher-rail />,
  useI18n: () => (key: string) => key,
  useLocale: () => ({ locale: "zh", setLocale: () => {} }),
}));

// aigc-canvas 等 examples:webext-registry 静态载入 .pi/web,canvas 组件已直连 canvas-ui import。
vi.mock("@blksails/pi-web-canvas-ui", () => ({
  CanvasLauncher: (): null => null,
  CanvasPanel: (): null => null,
  AigcQuickSettings: (): null => null,
}));

// Drive the assembly straight into the session-active branch: a session with a
// defined transport, plus the controls/extensionUI side-channels.
const fakeSession = {
  sessionId: "sess-123",
  transport: { kind: "fake" },
  connection: { kind: "fake-connection" },
  status: "open",
  error: undefined,
  client: { kind: "fake-client" },
};
const fakeControls = { kind: "controls" };
const fakeExtensionUI = { kind: "extension-ui" };

vi.mock("@blksails/pi-web-react", () => ({
  PiProvider: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <>{children}</>
  ),
  usePiSession: () => fakeSession,
  usePiControls: () => fakeControls,
  useExtensionUI: () => fakeExtensionUI,
  createPiClient: () => ({
    listSessions: vi.fn(),
    // session-list-item-actions:chat-app 挂载时拉取会话收藏 + 管理回调。
    listSessionFavorites: vi.fn(async () => ({ sessionIds: [] })),
    setSessionFavorites: vi.fn(async () => ({ sessionIds: [] })),
    deleteSessionHistory: vi.fn(async () => ({ ok: true })),
    renameSession: vi.fn(async (id: string, name: string) => ({
      sessionId: id,
      name,
    })),
  }),
  // 统一命令层:chat-app 构造自有 ui-rpc 总线 + 命令执行(mock 为惰性接缝)。
  createUiRpcBus: () => ({ request: vi.fn(), dispose: vi.fn() }),
  executeHostCommand: vi.fn(async () => ({ ok: true })),
}));

import { ChatApp } from "@/components/chat-app";

afterEach(() => {
  cleanup();
  piChatSpy.mockClear();
  piChatBasicSpy.mockClear();
});

describe("ChatApp (session-active) renders the default rich chat UI", () => {
  function startSession(): void {
    render(
      <ChatApp
        defaultSource="./examples/hello-agent"
        defaultModel="stub-model"
        defaultCwd="/tmp"
      />,
    );
    const submit = document.querySelector("[data-agent-source-submit]");
    expect(submit).not.toBeNull();
    fireEvent.click(submit as Element);
  }

  it("renders the default <PiChat> (not the minimal <PiChatBasic>) once a session is active", () => {
    startSession();
    expect(document.querySelector("[data-test-pi-chat]")).not.toBeNull();
    expect(document.querySelector("[data-test-pi-chat-basic]")).toBeNull();
    expect(piChatSpy).toHaveBeenCalled();
    expect(piChatBasicSpy).not.toHaveBeenCalled();
  });

  it("forwards the same session/controls/extensionUI wiring to <PiChat>", () => {
    startSession();
    expect(piChatSpy).toHaveBeenCalled();
    const props = piChatSpy.mock.calls[0]?.[0];
    expect(props).toBeDefined();
    expect(props?.session).toBe(fakeSession);
    expect(props?.controls).toBe(fakeControls);
    expect(props?.extensionUI).toBe(fakeExtensionUI);
  });

  // new-by-agent-source(任务 2.1)
  it("点击「切换源」退回 agent 源选择器 (2.1/2.2)", () => {
    startSession();
    expect(document.querySelector("[data-session-active]")).not.toBeNull();
    const switchBtn = document.querySelector("[data-switch-source]");
    expect(switchBtn).not.toBeNull();
    fireEvent.click(switchBtn as Element);
    // 退回选择器:picker 出现、会话态消失。
    expect(document.querySelector("[data-agent-source-picker]")).not.toBeNull();
    expect(document.querySelector("[data-session-active]")).toBeNull();
  });

  it("点击 New session 同源新建:仍停留会话(不回选择器)且 SessionView 重挂 (1.1)", () => {
    startSession();
    const callsBefore = piChatSpy.mock.calls.length;
    const newBtn = document.querySelector("[data-new-session]");
    expect(newBtn).not.toBeNull();
    fireEvent.click(newBtn as Element);
    // 不回选择器:仍是会话态,picker 不出现。
    expect(document.querySelector("[data-agent-source-picker]")).toBeNull();
    expect(document.querySelector("[data-session-active]")).not.toBeNull();
    // key 变化使 SessionView 重挂 → PiChat 再次渲染(调用次数增加),佐证同源新建触发新会话装配。
    expect(piChatSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

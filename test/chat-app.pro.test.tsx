/**
 * chat-app assembly: the session-active branch renders the rich chat UI
 * (<PiChatPro>) rather than the basic <PiChat>, while preserving the same
 * session/controls/extensionUI wiring driven by the @pi-web/react hooks
 * (Req 11.3). The ~/.pi/agent config + session-assembly chain is unchanged;
 * only the chat UI component is swapped.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

// Capture the props passed to whichever chat component chat-app renders so we
// can assert the rich variant is used and that wiring is forwarded intact.
const piChatProSpy =
  vi.fn<(props: Record<string, unknown>) => void>();
const piChatSpy = vi.fn<(props: Record<string, unknown>) => void>();

vi.mock("@pi-web/ui", () => ({
  PiChat: (props: Record<string, unknown>): React.JSX.Element => {
    piChatSpy(props);
    return <div data-test-pi-chat />;
  },
  PiChatPro: (props: Record<string, unknown>): React.JSX.Element => {
    piChatProSpy(props);
    return <div data-test-pi-chat-pro />;
  },
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

vi.mock("@pi-web/react", () => ({
  PiProvider: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <>{children}</>
  ),
  usePiSession: () => fakeSession,
  usePiControls: () => fakeControls,
  useExtensionUI: () => fakeExtensionUI,
}));

import { ChatApp } from "@/components/chat-app";

afterEach(() => {
  cleanup();
  piChatProSpy.mockClear();
  piChatSpy.mockClear();
});

describe("ChatApp (session-active) renders the rich chat UI", () => {
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

  it("renders <PiChatPro> (not <PiChat>) once a session is active", () => {
    startSession();
    expect(document.querySelector("[data-test-pi-chat-pro]")).not.toBeNull();
    expect(document.querySelector("[data-test-pi-chat]")).toBeNull();
    expect(piChatProSpy).toHaveBeenCalled();
    expect(piChatSpy).not.toHaveBeenCalled();
  });

  it("forwards the same session/controls/extensionUI wiring to <PiChatPro>", () => {
    startSession();
    expect(piChatProSpy).toHaveBeenCalled();
    const props = piChatProSpy.mock.calls[0]?.[0];
    expect(props).toBeDefined();
    expect(props?.session).toBe(fakeSession);
    expect(props?.controls).toBe(fakeControls);
    expect(props?.extensionUI).toBe(fakeExtensionUI);
  });
});

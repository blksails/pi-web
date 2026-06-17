/**
 * e2e(mock server)— 完整 hook 驱动链路:usePiSession 建会话 + useChat({transport})
 * 驱动一轮 prompt,经 in-memory mock SSE 服务器逐字接收流式回复直至 finish。
 *
 * 注:真实 http-api + stub agent 的 e2e 归 app-shell;本包以 in-memory fetch + SSE
 * ReadableStream 驱动同一公开链路(usePiSession → transport → useChat)。
 *
 * 实现说明:AI SDK useChat 在构造时一次性捕获 transport,故消费方应在 transport 就绪后
 * 再挂载 useChat。这里用一个仅当 session.transport 就绪才渲染的子组件体现该集成约定。
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { usePiSession } from "../../src/hooks/use-pi-session.js";
import { useExtensionUI } from "../../src/hooks/use-extension-ui.js";
import { PiTransport } from "../../src/transport/pi-transport.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import type { PiClient } from "../../src/client/pi-client.js";
import {
  chunkFrameText,
  controlFrameText,
  makeSseResponse,
  makeJsonResponse,
} from "../fixtures/sse-samples.js";
import type { UIMessage } from "ai";

function textOf(message: { parts: { type: string }[] }): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** in-memory mock server: /sessions, /messages, /stream, /ui-response. */
function makeServer(sse: string): {
  fetch: typeof fetch;
  uiResponses: unknown[];
} {
  const uiResponses: unknown[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/sessions") && init?.method === "POST")
      return makeJsonResponse({ sessionId: "e2e-1" });
    if (url.endsWith("/messages") && init?.method === "POST")
      return makeJsonResponse({ ok: true });
    if (url.endsWith("/ui-response")) {
      uiResponses.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return makeJsonResponse({ ok: true });
    }
    if (url.endsWith("/stream")) return makeSseResponse(sse, { chunkSize: 6 });
    return makeJsonResponse({ ok: true });
  }) as unknown as typeof fetch;
  return { fetch: f, uiResponses };
}

interface Captured {
  messages: UIMessage[];
  sendMessage?: (msg: { text: string }) => Promise<void>;
  ext?: ReturnType<typeof useExtensionUI>;
}

/** 仅当 transport 就绪才挂载的聊天子组件(体现集成约定)。 */
function ChatChild(props: {
  transport: PiTransport;
  sessionId: string | undefined;
  connection: PiSessionConnection | undefined;
  client: PiClient | undefined;
  capture: Captured;
}): ReactNode {
  const chat = useChat({ transport: props.transport });
  const ext = useExtensionUI({
    sessionId: props.sessionId,
    connection: props.connection,
    ...(props.client !== undefined ? { client: props.client } : {}),
  });
  props.capture.messages = chat.messages;
  props.capture.sendMessage = chat.sendMessage;
  props.capture.ext = ext;
  return null;
}

function Harness(props: {
  fetch: typeof fetch;
  capture: Captured;
}): ReactNode {
  const session = usePiSession({
    baseUrl: "http://api.test",
    fetch: props.fetch,
    create: { source: "claude" },
  });
  if (session.transport === undefined) return null;
  return createElement(ChatChild, {
    transport: session.transport,
    sessionId: session.sessionId,
    connection: session.connection,
    client: session.client,
    capture: props.capture,
  });
}

describe("e2e (mock server): full prompt → streamed reply", () => {
  it("drives a prompt through usePiSession + useChat to a finished reply", async () => {
    const sse =
      chunkFrameText({ type: "start", messageId: "a1" }, "e0") +
      chunkFrameText({ type: "text-start", id: "t1" }, "e1") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "pi " }, "e2") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "says " }, "e3") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "hi" }, "e4") +
      chunkFrameText({ type: "text-end", id: "t1" }, "e5") +
      chunkFrameText({ type: "finish" }, "e6");
    const { fetch } = makeServer(sse);
    const capture: Captured = { messages: [] };

    render(createElement(Harness, { fetch, capture }));

    await waitFor(() => expect(capture.sendMessage).toBeDefined());
    await act(async () => {
      await capture.sendMessage?.({ text: "hello pi" });
    });

    await waitFor(() => {
      const assistant = capture.messages.find((m) => m.role === "assistant");
      expect(assistant && textOf(assistant)).toBe("pi says hi");
    });
  });

  it("surfaces an extension UI request via useExtensionUI and confirms respond", async () => {
    const sse =
      controlFrameText(
        {
          control: "extension-ui",
          request: {
            type: "extension_ui_request",
            id: "ext-1",
            method: "confirm",
            title: "Proceed?",
            message: "run command",
          },
        },
        "x0",
      ) +
      chunkFrameText({ type: "text-start", id: "t1" }, "x1") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "done" }, "x2") +
      chunkFrameText({ type: "text-end", id: "t1" }, "x3") +
      chunkFrameText({ type: "finish" }, "x4");
    const { fetch, uiResponses } = makeServer(sse);
    const capture: Captured = { messages: [] };

    render(createElement(Harness, { fetch, capture }));

    await waitFor(() => expect(capture.sendMessage).toBeDefined());
    await act(async () => {
      await capture.sendMessage?.({ text: "go" });
    });

    // extension UI request bubbles up through the bypass queue
    await waitFor(() => expect(capture.ext?.queue).toHaveLength(1));
    expect(capture.ext?.current?.id).toBe("ext-1");

    // chat reply unaffected by the control frame
    await waitFor(() => {
      const assistant = capture.messages.find((m) => m.role === "assistant");
      expect(assistant && textOf(assistant)).toBe("done");
    });

    // respond via /ui-response → dequeues
    await act(async () => {
      await capture.ext?.respond("ext-1", {
        type: "extension_ui_response",
        id: "ext-1",
        confirmed: true,
      });
    });
    await waitFor(() => expect(capture.ext?.queue).toHaveLength(0));
    expect(uiResponses).toEqual([
      { type: "extension_ui_response", id: "ext-1", confirmed: true },
    ]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import { PiTransport } from "../../src/transport/pi-transport.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  chunkFrameText,
  controlFrameText,
  makeSseResponse,
  makeJsonResponse,
} from "../fixtures/sse-samples.js";

/**
 * In-memory mock server: POST /messages acks, GET /stream returns an SSE
 * ReadableStream of encoded protocol frames (mixing uiMessageChunk + control).
 */
function mockServer(sse: string): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/messages") && init?.method === "POST")
      return makeJsonResponse({ ok: true });
    if (url.endsWith("/stream")) return makeSseResponse(sse, { chunkSize: 8 });
    return makeJsonResponse({ ok: true });
  }) as unknown as typeof fetch;
}

function textOf(message: { parts: { type: string }[] }): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

describe("useChat({ transport: PiTransport }) integration", () => {
  it("streams assistant text from SSE frames until finish", async () => {
    const sse =
      chunkFrameText({ type: "start", messageId: "a1" }, "e0") +
      chunkFrameText({ type: "text-start", id: "t1" }, "e1") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "Hello" }, "e2") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: ", world" }, "e3") +
      chunkFrameText({ type: "text-end", id: "t1" }, "e4") +
      chunkFrameText({ type: "finish" }, "e5");

    const fetch = mockServer(sse);
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });

    const { result } = renderHook(() => useChat({ transport }));

    await act(async () => {
      await result.current.sendMessage({ text: "hi there" });
    });

    await waitFor(() => {
      const assistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(assistant && textOf(assistant)).toBe("Hello, world");
    });

    // user message present, exactly one assistant message
    const roles = result.current.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles.filter((r) => r === "assistant")).toHaveLength(1);
  });

  it("does not leak control frames into chat messages", async () => {
    const sse =
      controlFrameText(
        { control: "queue", steering: ["q"], followUp: [] },
        "c0",
      ) +
      controlFrameText({ control: "stats", stats: { n: 1 } }, "c1") +
      chunkFrameText({ type: "text-start", id: "t1" }, "c2") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "ok" }, "c3") +
      chunkFrameText({ type: "text-end", id: "t1" }, "c4") +
      chunkFrameText({ type: "finish" }, "c5");

    const fetch = mockServer(sse);
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });

    const { result } = renderHook(() => useChat({ transport }));
    await act(async () => {
      await result.current.sendMessage({ text: "go" });
    });

    await waitFor(() => {
      const assistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(assistant && textOf(assistant)).toBe("ok");
    });

    // assistant message should only contain a text part — no data/queue/stats parts
    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    const partTypes = (assistant?.parts ?? []).map((p) => p.type);
    expect(partTypes.some((t) => t.startsWith("data-"))).toBe(false);
    // control bypass landed in the store instead
    expect(connection.controlStore.getSnapshot().queue.steering).toEqual(["q"]);
    expect(connection.controlStore.getSnapshot().stats).toEqual({ n: 1 });
  });
});

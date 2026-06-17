import { describe, it, expect, vi } from "vitest";
import { PiTransport } from "../../src/transport/pi-transport.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  textStreamFrames,
  makeSseResponse,
  makeJsonResponse,
} from "../fixtures/sse-samples.js";
import type { UIMessage, UIMessageChunk } from "ai";

async function drain(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const reader = stream.getReader();
  const out: UIMessageChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

function userMessage(text: string): UIMessage {
  return {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

interface Routed {
  postedMessages: { url: string; body: unknown; headers: Headers }[];
  streamRequests: { url: string; headers: Headers }[];
}

function routerFetch(sseText: string): {
  fetch: typeof fetch;
  routed: Routed;
} {
  const routed: Routed = { postedMessages: [], streamRequests: [] };
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/messages") && init?.method === "POST") {
      routed.postedMessages.push({
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers,
      });
      return makeJsonResponse({ ok: true });
    }
    if (url.endsWith("/stream")) {
      routed.streamRequests.push({ url, headers });
      return makeSseResponse(sseText);
    }
    return makeJsonResponse({ ok: true });
  });
  return { fetch: f as unknown as typeof fetch, routed };
}

function build(sseText: string) {
  const { fetch, routed } = routerFetch(sseText);
  const client = createPiClient("http://api.test", fetch);
  const connection = new PiSessionConnection({
    baseUrl: "http://api.test",
    sessionId: "s1",
    fetchImpl: fetch,
  });
  const transport = new PiTransport({ sessionId: "s1", client, connection });
  return { transport, connection, routed };
}

describe("PiTransport.sendMessages", () => {
  it("POSTs the prompt to /messages and returns the SSE chunk stream", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("Hi")],
      abortSignal: undefined,
    });
    expect(routed.postedMessages).toHaveLength(1);
    expect(routed.postedMessages[0]?.body).toEqual({ message: "Hi" });
    expect(routed.streamRequests).toHaveLength(1);

    const chunks = await drain(stream);
    const deltas = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => ("delta" in c ? c.delta : ""));
    expect(deltas.join("")).toBe("Hi");
    expect(chunks.at(-1)?.type).toBe("finish");
  });

  it("forwards custom headers to the stream subscription", async () => {
    const { transport, routed } = build(textStreamFrames("x"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("x")],
      abortSignal: undefined,
      headers: { authorization: "Bearer t0ken" },
    });
    expect(routed.streamRequests[0]?.headers.get("authorization")).toBe(
      "Bearer t0ken",
    );
  });

  it("aborts the stream when abortSignal fires", async () => {
    // 永不结束的 SSE,用 abort 收束
    const hangFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/messages")) return makeJsonResponse({ ok: true });
        // /stream — 永不结束
        const stream = new ReadableStream<Uint8Array>({
          start() {
            /* hang */
          },
        });
        void init;
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    ) as unknown as typeof fetch;
    const client = createPiClient("http://api.test", hangFetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: hangFetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });
    const ac = new AbortController();
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("hang")],
      abortSignal: ac.signal,
    });
    const reader = stream.getReader();
    const readPromise = reader.read();
    ac.abort();
    const { done } = await readPromise;
    expect(done).toBe(true);
    expect(connection.isSubscribed).toBe(false);
  });
});

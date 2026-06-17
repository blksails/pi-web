import { describe, it, expect, vi } from "vitest";
import { PiTransport } from "../../src/transport/pi-transport.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  chunkFrameText,
  textStreamFrames,
  makeSseResponse,
  makeJsonResponse,
} from "../fixtures/sse-samples.js";
import type { UIMessageChunk } from "ai";

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

describe("PiTransport.reconnectToStream", () => {
  it("resends Last-Event-ID and resumes the remaining frames", async () => {
    const lastIdSeen: (string | null)[] = [];
    let streamCall = 0;
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/state")) return makeJsonResponse({ state: {} });
      if (url.endsWith("/stream")) {
        lastIdSeen.push(headers.get("Last-Event-ID"));
        streamCall += 1;
        if (streamCall === 1) {
          // 首次:前两帧后"断开"(流自然结束,无 finish)
          return makeSseResponse(
            chunkFrameText({ type: "text-delta", id: "t1", delta: "A" }, "e1") +
              chunkFrameText(
                { type: "text-delta", id: "t1", delta: "B" },
                "e2",
              ),
          );
        }
        // 重连:续推剩余帧 + finish
        return makeSseResponse(
          chunkFrameText({ type: "text-delta", id: "t1", delta: "C" }, "e3") +
            chunkFrameText({ type: "finish" }, "e4"),
        );
      }
      return makeJsonResponse({ ok: true });
    });
    const fetch = f as unknown as typeof globalThis.fetch;
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });

    const first = await drain(connection.openChunkStream());
    expect(first.map((c) => ("delta" in c ? c.delta : c.type))).toEqual([
      "A",
      "B",
    ]);
    expect(connection.lastEventId).toBe("e2");
    expect(connection.isEnded()).toBe(false);

    const resumed = await transport.reconnectToStream({ chatId: "s1" });
    expect(resumed).not.toBeNull();
    const tail = await drain(resumed as ReadableStream<UIMessageChunk>);
    expect(tail.map((c) => ("delta" in c ? c.delta : c.type))).toEqual([
      "C",
      "finish",
    ]);
    // 第二次 /stream 携带 Last-Event-ID = e2
    expect(lastIdSeen[1]).toBe("e2");
  });

  it("returns null without hanging when the session has ended", async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/stream")) return makeSseResponse(textStreamFrames("hi"));
      return makeJsonResponse({ state: {} });
    });
    const fetch = f as unknown as typeof globalThis.fetch;
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });

    await drain(connection.openChunkStream());
    expect(connection.isEnded()).toBe(true);
    const res = await transport.reconnectToStream({ chatId: "s1" });
    expect(res).toBeNull();
  });

  it("returns null when the session does not exist (state 404)", async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/state")) return makeJsonResponse({ error: "gone" }, 404);
      return makeJsonResponse({ ok: true });
    });
    const fetch = f as unknown as typeof globalThis.fetch;
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });
    const res = await transport.reconnectToStream({ chatId: "s1" });
    expect(res).toBeNull();
  });
});

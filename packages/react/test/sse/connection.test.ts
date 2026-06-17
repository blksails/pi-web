import { describe, it, expect, vi } from "vitest";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  chunkFrameText,
  controlFrameText,
  makeSseResponse,
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

function sseFetch(text: string, chunkSize?: number): typeof fetch {
  return vi.fn(async () =>
    makeSseResponse(text, chunkSize === undefined ? {} : { chunkSize }),
  ) as unknown as typeof fetch;
}

describe("PiSessionConnection single-subscription routing", () => {
  it("routes uiMessageChunk frames into the chunk stream and closes on finish", async () => {
    const text =
      chunkFrameText({ type: "start", messageId: "m1" }, "e0") +
      chunkFrameText({ type: "text-start", id: "t1" }, "e1") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "He" }, "e2") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "llo" }, "e3") +
      chunkFrameText({ type: "text-end", id: "t1" }, "e4") +
      chunkFrameText({ type: "finish" }, "e5");

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text),
    });
    const chunks = await drain(conn.openChunkStream());
    expect(chunks.map((c) => c.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(conn.isEnded()).toBe(true);
    expect(conn.lastEventId).toBe("e5");
  });

  it("routes control frames to ControlStore, not the chunk stream", async () => {
    const text =
      controlFrameText(
        { control: "queue", steering: ["s"], followUp: ["f"] },
        "c0",
      ) +
      controlFrameText({ control: "stats", stats: { x: 1 } }, "c1") +
      chunkFrameText({ type: "text-delta", id: "t1", delta: "hi" }, "c2") +
      chunkFrameText({ type: "finish" }, "c3");

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text),
    });
    const chunks = await drain(conn.openChunkStream());
    // 只有 uiMessageChunk 进流
    expect(chunks.map((c) => c.type)).toEqual(["text-delta", "finish"]);
    const snap = conn.controlStore.getSnapshot();
    expect(snap.queue).toEqual({ steering: ["s"], followUp: ["f"] });
    expect(snap.stats).toEqual({ x: 1 });
  });

  it("handles half frames split across byte chunks", async () => {
    const text =
      chunkFrameText({ type: "text-delta", id: "t1", delta: "abc" }, "e1") +
      chunkFrameText({ type: "finish" }, "e2");
    // 强制 byte 切分(每 5 字节一片),触发半帧跨 chunk
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text, 5),
    });
    const chunks = await drain(conn.openChunkStream());
    expect(chunks.map((c) => c.type)).toEqual(["text-delta", "finish"]);
    const delta = chunks.find((c) => c.type === "text-delta");
    expect(delta && "delta" in delta ? delta.delta : undefined).toBe("abc");
  });

  it("reports parse errors without polluting the chunk stream", async () => {
    const onError = vi.fn();
    const text =
      "data: not-json\n\n" +
      'data: {"kind":"bogus"}\n\n' +
      chunkFrameText({ type: "finish" }, "e1");
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text),
      onError,
    });
    const chunks = await drain(conn.openChunkStream());
    expect(chunks.map((c) => c.type)).toEqual(["finish"]);
    expect(onError).toHaveBeenCalled();
  });

  it("close() aborts the underlying reader (single subscription)", async () => {
    let aborted = false;
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      // 永不结束的流(模拟长连接)
      const stream = new ReadableStream<Uint8Array>({
        start() {
          /* 不 enqueue,也不 close */
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: f,
    });
    const stream = conn.openChunkStream();
    // 触发 start/pump
    const reader = stream.getReader();
    void reader.read();
    await Promise.resolve();
    conn.close();
    await Promise.resolve();
    expect(aborted).toBe(true);
    expect(conn.isSubscribed).toBe(false);
  });
});

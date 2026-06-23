/**
 * Task 4.2 — PiSessionConnection 默认 onError 改走 @pi-web/logger (core:sse)。
 *
 * TDD 行为断言：
 * 1. 默认（无注入 onError）：解析/网络错误经 logger（core:sse）产出，
 *    不再直接调用 console.error。
 * 2. 可注入 onError 覆盖仍生效（向后兼容）。
 * 3. 既有行为不变（解析错误不污染 chunk 流、chunk 路由等）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LogEntry, Sink } from "@pi-web/logger";
import { configureLogger } from "@pi-web/logger";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  chunkFrameText,
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

function sseFetch(text: string): typeof fetch {
  return vi.fn(async () =>
    makeSseResponse(text),
  ) as unknown as typeof fetch;
}

function makeSink(): { sink: Sink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const sink: Sink = (entry) => entries.push(entry);
  return { sink, entries };
}

beforeEach(() => {
  configureLogger({ enabled: true, level: "debug" });
});

afterEach(() => {
  configureLogger({ enabled: true, level: "debug", namespaces: {} });
});

describe("PiSessionConnection 默认 onError → logger(core:sse)", () => {
  it("无注入 onError 时，解析错误经 logger(core:sse) error 产出，不走 console.error", async () => {
    const { sink, entries } = makeSink();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const text =
      "data: not-json\n\n" +
      chunkFrameText({ type: "finish" }, "e1");

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text),
      loggerSink: sink,
    });

    const chunks = await drain(conn.openChunkStream());
    expect(chunks.map((c) => c.type)).toEqual(["finish"]);

    // logger(core:sse) 应产出 error entry
    const errorEntries = entries.filter(
      (e) => e.level === "error" && e.ns === "core:sse",
    );
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);

    // console.error 不应被 connection 默认路径直接调用
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("可注入 onError 覆盖仍生效（向后兼容）", async () => {
    const onError = vi.fn();
    const text =
      "data: not-json\n\n" +
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

  it("解析错误不污染 chunk 流（既有行为）", async () => {
    const { sink } = makeSink();
    const text =
      "data: not-json\n\n" +
      'data: {"kind":"bogus"}\n\n' +
      chunkFrameText({ type: "finish" }, "e1");

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: sseFetch(text),
      loggerSink: sink,
    });

    const chunks = await drain(conn.openChunkStream());
    expect(chunks.map((c) => c.type)).toEqual(["finish"]);
  });

  it("HTTP 错误响应经 logger(core:sse) 产出", async () => {
    const { sink, entries } = makeSink();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const f = vi.fn(async () =>
      new Response(null, { status: 503, headers: { "content-type": "text/event-stream" } }),
    ) as unknown as typeof fetch;

    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: f,
      loggerSink: sink,
    });

    // stream will close due to non-ok response
    await drain(conn.openChunkStream());

    const errorEntries = entries.filter(
      (e) => e.level === "error" && e.ns === "core:sse",
    );
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

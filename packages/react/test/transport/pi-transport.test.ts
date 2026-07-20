import { describe, it, expect, vi } from "vitest";
import { PiTransport } from "../../src/transport/pi-transport.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import {
  textStreamFrames,
  makeSseResponse,
  makeJsonResponse,
} from "../fixtures/sse-samples.js";
import type { ImageContent } from "@blksails/pi-web-protocol";
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

  // prompt 被服务端拒绝(pi-clouds #23:上游 preflight 失败 → 502)时,错误必须上抛给 useChat
  // 渲染错误气泡,且本轮刚建立的 /stream 订阅要一并关闭,不能每次失败泄漏一条常驻 SSE 连接。
  it("prompt 被拒(502)→ 抛错并关闭本轮订阅,不泄漏 SSE 连接", async () => {
    const aborted: boolean[] = [];
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/messages") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ error: { code: "UPSTREAM_ERROR", message: "No API key" } }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/stream")) {
        init?.signal?.addEventListener("abort", () => aborted.push(true));
        return makeSseResponse(textStreamFrames("never"));
      }
      return makeJsonResponse({ ok: true });
    });
    const fetchImpl = f as unknown as typeof fetch;
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl,
    });
    const transport = new PiTransport({
      sessionId: "s1",
      client: createPiClient("http://api.test", fetchImpl),
      connection,
    });
    await expect(
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "s1",
        messageId: undefined,
        messages: [userMessage("Hi")],
        abortSignal: undefined,
      }),
    ).rejects.toThrow();
    expect(aborted).toContain(true);
  });

  it("maps image attachments from body to PromptRequest.images", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    const images: ImageContent[] = [
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "image", data: "BBBB", mimeType: "image/jpeg" },
    ];
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("look at this")],
      abortSignal: undefined,
      body: { images },
    });
    expect(routed.postedMessages).toHaveLength(1);
    expect(routed.postedMessages[0]?.body).toEqual({
      message: "look at this",
      images,
    });
  });

  it("maps image attachments from metadata to PromptRequest.images", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    const images: ImageContent[] = [
      { type: "image", data: "CCCC", mimeType: "image/webp" },
    ];
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("look")],
      abortSignal: undefined,
      metadata: { images },
    });
    expect(routed.postedMessages[0]?.body).toEqual({
      message: "look",
      images,
    });
  });

  it("omits images when no attachments are provided (unchanged behavior)", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("plain text")],
      abortSignal: undefined,
    });
    expect(routed.postedMessages[0]?.body).toEqual({ message: "plain text" });
    expect(
      (routed.postedMessages[0]?.body as Record<string, unknown>).images,
    ).toBeUndefined();
  });

  it("does not forward unrelated body fields into the prompt payload", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("hello")],
      abortSignal: undefined,
      body: { foo: "bar", images: undefined },
    });
    // 仅映射 message(+ images);不透传任意 body 字段。
    expect(routed.postedMessages[0]?.body).toEqual({ message: "hello" });
  });

  it("maps attachmentIds from body to PromptRequest.attachmentIds", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("see file")],
      abortSignal: undefined,
      body: { attachmentIds: ["att_a", "att_b"] },
    });
    expect(routed.postedMessages).toHaveLength(1);
    expect(routed.postedMessages[0]?.body).toEqual({
      message: "see file",
      attachmentIds: ["att_a", "att_b"],
    });
  });

  it("maps attachmentIds from metadata to PromptRequest.attachmentIds", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("see file")],
      abortSignal: undefined,
      metadata: { attachmentIds: ["att_x"] },
    });
    expect(routed.postedMessages[0]?.body).toEqual({
      message: "see file",
      attachmentIds: ["att_x"],
    });
  });

  it("carries both images and attachmentIds together (vision + bridge coexist)", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    const images: ImageContent[] = [
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ];
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("both")],
      abortSignal: undefined,
      body: { images, attachmentIds: ["att_a"] },
    });
    expect(routed.postedMessages[0]?.body).toEqual({
      message: "both",
      images,
      attachmentIds: ["att_a"],
    });
  });

  it("omits attachmentIds when none are provided (unchanged behavior)", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("plain")],
      abortSignal: undefined,
    });
    expect(routed.postedMessages[0]?.body).toEqual({ message: "plain" });
    expect(
      (routed.postedMessages[0]?.body as Record<string, unknown>).attachmentIds,
    ).toBeUndefined();
  });

  it("omits attachmentIds for empty array or non-string-array values", async () => {
    const { transport, routed } = build(textStreamFrames("Hi"));
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("empty")],
      abortSignal: undefined,
      body: { attachmentIds: [] },
    });
    expect(routed.postedMessages[0]?.body).toEqual({ message: "empty" });

    const { transport: t2, routed: r2 } = build(textStreamFrames("Hi"));
    await t2.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("bad")],
      abortSignal: undefined,
      body: { attachmentIds: [1, 2, 3] },
    });
    expect(r2.postedMessages[0]?.body).toEqual({ message: "bad" });
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

  it("waits for the /stream subscription before POSTing the prompt (race fix)", async () => {
    // 复现修复的竞态:/stream 建连被人为延迟,POST /messages 必须等到订阅就绪后才发出,
    // 否则本轮回复帧会在「无订阅者」窗口被广播而丢失(需刷新才可见)。
    const order: string[] = [];
    let releaseStream!: (r: Response) => void;
    const streamGate = new Promise<Response>((resolve) => {
      releaseStream = resolve;
    });
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/messages") && init?.method === "POST") {
          order.push("prompt");
          return makeJsonResponse({ ok: true });
        }
        if (url.endsWith("/stream")) {
          order.push("stream-fetch");
          return streamGate; // 延迟 resolve:模拟 /stream 冷编译/慢建连
        }
        return makeJsonResponse({ ok: true });
      },
    ) as unknown as typeof fetch;
    const client = createPiClient("http://api.test", fetchImpl);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl,
    });
    const transport = new PiTransport({ sessionId: "s1", client, connection });

    const sendP = transport.sendMessages({
      trigger: "submit-message",
      chatId: "s1",
      messageId: undefined,
      messages: [userMessage("hi")],
      abortSignal: undefined,
    });

    // 推进微任务:/stream fetch 已发起但未 resolve → prompt 绝不能提前发出。
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["stream-fetch"]);

    // 订阅建立(收到 /stream 响应)后,才允许 POST prompt。
    releaseStream(makeSseResponse(textStreamFrames("hi")));
    await sendP;
    expect(order).toEqual(["stream-fetch", "prompt"]);
  });
});

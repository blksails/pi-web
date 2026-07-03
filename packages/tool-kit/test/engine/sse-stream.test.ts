/**
 * sse-stream 单元测试:SSE 行读取 + OpenAI-chat 累积器。
 */
import { describe, it, expect } from "vitest";
import {
  readOpenAiSse,
  makeOpenAiChatAccumulator,
  makeOpenAiImagesAccumulator,
} from "../../src/engine/sse-stream.js";

/** 用给定文本块序列造一个 SSE Response(可分片,验证半帧缓冲)。 */
function sseResponse(chunks: string[], contentType = "text/event-stream"): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": contentType } });
}

describe("readOpenAiSse", () => {
  it("逐帧解析 data: JSON,跳过心跳注释,遇 [DONE] 结束", async () => {
    const frames: unknown[] = [];
    const r = sseResponse([
      ": OPENROUTER PROCESSING\n\n",
      'data: {"a":1}\n\n',
      'data: {"b":2}\n\n',
      "data: [DONE]\n\n",
      'data: {"c":3}\n\n', // [DONE] 后不应再解析
    ]);
    await readOpenAiSse(r, (j) => frames.push(j));
    expect(frames).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("容忍跨分片的半帧(缓冲拼接)", async () => {
    const frames: unknown[] = [];
    const r = sseResponse(['data: {"hel', 'lo":"world"}\n', "\n"]);
    await readOpenAiSse(r, (j) => frames.push(j));
    expect(frames).toEqual([{ hello: "world" }]);
  });

  it("非 JSON data 帧被容错跳过", async () => {
    const frames: unknown[] = [];
    const r = sseResponse(["data: not-json\n\n", 'data: {"ok":1}\n\n']);
    await readOpenAiSse(r, (j) => frames.push(j));
    expect(frames).toEqual([{ ok: 1 }]);
  });
});

describe("makeOpenAiChatAccumulator", () => {
  it("累积 reasoning(delta.reasoning 串)并逐次回调累积值", () => {
    const seen: string[] = [];
    const acc = makeOpenAiChatAccumulator({ onReasoning: (t) => seen.push(t) });
    acc.onData({ choices: [{ delta: { reasoning: "Think" } }] });
    acc.onData({ choices: [{ delta: { reasoning: "ing…" } }] });
    expect(seen).toEqual(["Think", "Thinking…"]);
    expect(acc.result().reasoning).toBe("Thinking…");
  });

  it("delta.reasoning 缺失时回退到 reasoning_details 的 text/summary", () => {
    const acc = makeOpenAiChatAccumulator();
    acc.onData({
      choices: [{ delta: { reasoning_details: [{ summary: "sum" }, { text: "-txt" }] } }],
    });
    expect(acc.result().reasoning).toBe("sum-txt");
  });

  it("收集图像 url(去重保序)并回调全量列表", () => {
    const imgCalls: string[][] = [];
    const acc = makeOpenAiChatAccumulator({ onImage: (u) => imgCalls.push(u) });
    acc.onData({ choices: [{ delta: { images: [{ image_url: { url: "u1" } }] } }] });
    acc.onData({ choices: [{ delta: { images: [{ image_url: { url: "u1" } }] } }] }); // 重复,不再回调
    acc.onData({ choices: [{ delta: { images: [{ image_url: { url: "u2" } }] } }] });
    expect(imgCalls).toEqual([["u1"], ["u1", "u2"]]);
    expect(acc.result().imageUrls).toEqual(["u1", "u2"]);
  });

  it("捕获流内 error 帧", () => {
    const acc = makeOpenAiChatAccumulator();
    acc.onData({ error: { code: 429, message: "rate limited" } });
    expect(acc.error()).toBe("rate limited");
  });

  it("累积 content 答复正文", () => {
    const texts: string[] = [];
    const acc = makeOpenAiChatAccumulator({ onText: (t) => texts.push(t) });
    acc.onData({ choices: [{ delta: { content: "Hel" } }] });
    acc.onData({ choices: [{ delta: { content: "lo" } }] });
    expect(texts).toEqual(["Hel", "Hello"]);
    expect(acc.result().content).toBe("Hello");
  });

  it("端到端:readOpenAiSse + 累积器还原一次流式出图", async () => {
    const acc = makeOpenAiChatAccumulator();
    const r = sseResponse([
      'data: {"choices":[{"delta":{"reasoning":"planning"}}]}\n\n',
      'data: {"choices":[{"delta":{"images":[{"image_url":{"url":"data:image/png;base64,AAAA"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    await readOpenAiSse(r, acc.onData);
    const res = acc.result();
    expect(res.reasoning).toBe("planning");
    expect(res.imageUrls).toEqual(["data:image/png;base64,AAAA"]);
    expect(acc.error()).toBeUndefined();
  });
});

describe("makeOpenAiImagesAccumulator(partial_images 渐进局部图)", () => {
  it("逐张 partial 回调(带 index)+ completed 作最终图", () => {
    const partials: [string, number][] = [];
    let final: string | undefined;
    const acc = makeOpenAiImagesAccumulator({
      onPartial: (u, i) => partials.push([u, i]),
      onComplete: (u) => (final = u),
    });
    acc.onData({ type: "image_generation.partial_image", partial_image_index: 0, b64_json: "AA" });
    acc.onData({ type: "image_generation.partial_image", partial_image_index: 1, b64_json: "BB" });
    acc.onData({ type: "image_generation.completed", b64_json: "CC" });
    expect(partials).toEqual([
      ["data:image/png;base64,AA", 0],
      ["data:image/png;base64,BB", 1],
    ]);
    expect(final).toBe("data:image/png;base64,CC");
    expect(acc.result()).toEqual({ finalDataUri: "data:image/png;base64,CC", partialCount: 2 });
  });

  it("无 completed 时回退到最后一张 partial", () => {
    const acc = makeOpenAiImagesAccumulator();
    acc.onData({ type: "image_generation.partial_image", partial_image_index: 0, b64_json: "AA" });
    expect(acc.result().finalDataUri).toBe("data:image/png;base64,AA");
  });

  it("image_edit.* 事件同样识别", () => {
    let final: string | undefined;
    const acc = makeOpenAiImagesAccumulator({ onComplete: (u) => (final = u) });
    acc.onData({ type: "image_edit.completed", b64_json: "ZZ" });
    expect(final).toBe("data:image/png;base64,ZZ");
  });

  it("捕获 error 帧", () => {
    const acc = makeOpenAiImagesAccumulator();
    acc.onData({ error: { message: "content policy" } });
    expect(acc.error()).toBe("content policy");
  });
});

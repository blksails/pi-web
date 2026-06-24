/**
 * mock SSE 文本帧样本 + 编码/Response 辅助。
 *
 * 用 @blksails/protocol 的 makeUiMessageChunkFrame / makeControlFrame 构造合法帧,
 * 再编码为 http-api 风格的 SSE 文本(`id:` + `data:` + 空行),供单测/集成测试驱动。
 */
import {
  makeUiMessageChunkFrame,
  makeControlFrame,
  type SseFrame,
  type UiMessageChunk,
  type ControlPayload,
} from "@blksails/protocol";

/** 把一个 SseFrame 编码为 SSE 事件文本块(带可选 id)。 */
export function encodeFrame(frame: SseFrame, id?: string): string {
  const json = JSON.stringify(frame);
  const idLine = id !== undefined ? `id: ${id}\n` : "";
  return `${idLine}data: ${json}\n\n`;
}

/** uiMessageChunk 帧文本。 */
export function chunkFrameText(chunk: UiMessageChunk, id?: string): string {
  return encodeFrame(makeUiMessageChunkFrame(chunk), id);
}

/** control 帧文本。 */
export function controlFrameText(payload: ControlPayload, id?: string): string {
  return encodeFrame(makeControlFrame(payload), id);
}

/** 一段典型 text 流(start → 逐字 delta → end → finish)。 */
export function textStreamFrames(
  text: string,
  msgId = "m1",
): string {
  const parts: string[] = [];
  let i = 0;
  parts.push(chunkFrameText({ type: "start", messageId: msgId }, `e${i++}`));
  parts.push(chunkFrameText({ type: "text-start", id: "t1" }, `e${i++}`));
  for (const ch of text) {
    parts.push(
      chunkFrameText({ type: "text-delta", id: "t1", delta: ch }, `e${i++}`),
    );
  }
  parts.push(chunkFrameText({ type: "text-end", id: "t1" }, `e${i++}`));
  parts.push(chunkFrameText({ type: "finish" }, `e${i++}`));
  return parts.join("");
}

/** 构造一个把给定文本流式吐出的 SSE Response(text/event-stream)。 */
export function makeSseResponse(
  text: string,
  init?: { chunkSize?: number; status?: number },
): Response {
  const encoder = new TextEncoder();
  const chunkSize = init?.chunkSize ?? text.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < text.length; i += chunkSize) {
        controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** 构造一个 JSON Response。 */
export function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

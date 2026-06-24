/**
 * http-api — SSE 帧编码器(纯函数,无 I/O,Req 5.2/5.5/6.1/6.4/7.1)。
 *
 * 把单个 `SseFrame`(@blksails/protocol,`uiMessageChunk` 与 `control` 两类)+ 单调
 * 序号编码为符合 SSE 规范的 `text/event-stream` 文本块:
 *   event: <kind>\n
 *   id: <seq>\n
 *   data: <json>\n            (多行 data 按规范拆 data: 行)
 *   \n                        (空行结束帧)
 *
 * 每帧 JSON 承载 `protocolVersion`(取自帧自身,续流保持一致)。
 */
import type { SseFrame } from "@blksails/protocol";

/** 把可能含换行的 data 文本拆成多条 `data:` 行(SSE 规范)。 */
function dataLines(json: string): string {
  return json
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
}

/** 编码一个 SSE 帧(承载序号到 `id:` 行,事件类别到 `event:` 行)。 */
export function encodeFrame(frame: SseFrame, seq: number): string {
  const json = JSON.stringify(frame);
  return `event: ${frame.kind}\nid: ${seq}\n${dataLines(json)}\n\n`;
}

/** 编码一条心跳注释帧(`:` 开头,Req 5.4)。 */
export function encodeHeartbeat(): string {
  return ": keep-alive\n\n";
}

/** 编码会话结束的 control 帧 + 关闭信号(Req 5.5)。 */
export function encodeEndFrame(
  frame: SseFrame,
  seq: number,
): string {
  return encodeFrame(frame, seq);
}

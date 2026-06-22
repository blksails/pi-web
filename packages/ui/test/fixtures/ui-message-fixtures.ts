/**
 * UIMessage part 样本与 UIMessageChunk 序列(对齐 AI SDK v5 形状)。
 */
import type { UIMessage, UIMessageChunk } from "ai";

export function textPart(text: string, state: "streaming" | "done" = "done") {
  return { type: "text" as const, text, state };
}

export function reasoningPart(
  text: string,
  state: "streaming" | "done" = "done",
) {
  return { type: "reasoning" as const, text, state };
}

/** 工具卡 start 态(input-available)。 */
export function toolStartPart(name: string, input: unknown) {
  return {
    type: `tool-${name}` as const,
    toolCallId: `call-${name}`,
    state: "input-available" as const,
    input,
  };
}

/** 工具卡 update 态(output-available + preliminary)。 */
export function toolUpdatePart(name: string, input: unknown, output: unknown) {
  return {
    type: `tool-${name}` as const,
    toolCallId: `call-${name}`,
    state: "output-available" as const,
    input,
    output,
    preliminary: true,
  };
}

/** 工具卡 end 态(output-available 最终)。 */
export function toolEndPart(name: string, input: unknown, output: unknown) {
  return {
    type: `tool-${name}` as const,
    toolCallId: `call-${name}`,
    state: "output-available" as const,
    input,
    output,
  };
}

/** 工具卡 error 态(output-error)。 */
export function toolErrorPart(name: string, input: unknown, errorText: string) {
  return {
    type: `tool-${name}` as const,
    toolCallId: `call-${name}`,
    state: "output-error" as const,
    input,
    errorText,
  };
}

/** data-pi-* 样本。 */
export function dataPart(name: string, data: unknown) {
  return { type: `data-${name}` as const, data };
}

/** file part 样本(用户消息里的图片等)。 */
export function filePart(
  url: string,
  mediaType: string,
  filename?: string,
) {
  return {
    type: "file" as const,
    url,
    mediaType,
    ...(filename !== undefined ? { filename } : {}),
  };
}

export function assistantMessage(
  parts: UIMessage["parts"],
  id = "m-assistant",
): UIMessage {
  return { id, role: "assistant", parts };
}

export function userMessage(text: string, id = "m-user"): UIMessage {
  return { id, role: "user", parts: [textPart(text)] };
}

/**
 * 流式文本 + 工具三态 + 思考块的 chunk 序列,供 mock transport 推送。
 */
export function streamWithToolAndReasoning(): UIMessageChunk[] {
  return [
    { type: "start", messageId: "a1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Hello" },
    { type: "text-delta", id: "t1", delta: " world" },
    { type: "text-end", id: "t1" },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", delta: "Let me think…" },
    { type: "reasoning-end", id: "r1" },
    {
      type: "tool-input-available",
      toolCallId: "tc1",
      toolName: "search",
      input: { q: "pi" },
    },
    { type: "tool-output-available", toolCallId: "tc1", output: { hits: 3 } },
    { type: "finish" },
  ];
}

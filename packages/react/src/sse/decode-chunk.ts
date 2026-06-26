/**
 * uiMessageChunk 帧负载 → AI SDK v5 UIMessageChunk 映射。
 *
 * 来源:@blksails/pi-web-protocol 的 UiMessageChunk(z.infer),其形状已对齐 AI SDK v5
 * UIMessageChunk 联合(text/reasoning/tool/data-pi-* + lifecycle)。本函数做"协议块 →
 * AI SDK 块"的显式映射,确保字段名与 AI SDK 约定一致(text/reasoning 用 id+delta;
 * tool 用 toolCallId/toolName/input/output;data-pi-* 透传为 data-${type} part)。
 *
 * 纯函数、无副作用。不可解析的输入由上游 connection 层经 SseFrameSchema.safeParse 拦截,
 * 不会进入本函数。
 */
import type { UiMessageChunk } from "@blksails/pi-web-protocol";
import type { UIMessageChunk } from "ai";

/**
 * 把协议 uiMessageChunk 负载映射为 AI SDK UIMessageChunk。
 *
 * tool-output-error 在 AI SDK 中需 errorText;tool-output-available 的 isError 标志
 * 在协议里承载,这里据其转为 tool-output-error / tool-output-available。
 */
export function decodeUiMessageChunk(chunk: UiMessageChunk): UIMessageChunk {
  switch (chunk.type) {
    // ---- lifecycle ----
    case "start":
      return chunk.messageId === undefined
        ? { type: "start" }
        : { type: "start", messageId: chunk.messageId };
    case "finish":
      return { type: "finish" };
    case "start-step":
      return { type: "start-step" };
    case "finish-step":
      return { type: "finish-step" };
    case "abort":
      return { type: "abort" };
    case "error":
      return { type: "error", errorText: chunk.errorText };

    // ---- text ----
    case "text-start":
      return { type: "text-start", id: chunk.id };
    case "text-delta":
      return { type: "text-delta", id: chunk.id, delta: chunk.delta };
    case "text-end":
      return { type: "text-end", id: chunk.id };

    // ---- reasoning ----
    case "reasoning-start":
      return { type: "reasoning-start", id: chunk.id };
    case "reasoning-delta":
      return { type: "reasoning-delta", id: chunk.id, delta: chunk.delta };
    case "reasoning-end":
      return { type: "reasoning-end", id: chunk.id };

    // ---- tool ----
    case "tool-input-start":
      return {
        type: "tool-input-start",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
      };
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        toolCallId: chunk.toolCallId,
        inputTextDelta: chunk.inputTextDelta,
      };
    case "tool-input-available":
      return {
        type: "tool-input-available",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      };
    case "tool-output-available":
      return {
        type: "tool-output-available",
        toolCallId: chunk.toolCallId,
        output: chunk.output,
        // preliminary(tool_execution_update 中间产出)透传 → AI SDK 按 toolCallId
        // 复用 part 并标记 preliminary,前端据此渲染 update/Streaming 态。
        ...(chunk.preliminary === true ? { preliminary: true } : {}),
      };
    case "tool-output-error":
      return {
        type: "tool-output-error",
        toolCallId: chunk.toolCallId,
        errorText: chunk.errorText,
      };

    // ---- data-pi-* data parts ----
    case "data-pi-queue":
    case "data-pi-compaction":
    case "data-pi-auto-retry":
    case "data-pi-ui":
    // ctx.ui.custom 桥接(spec ctx-ui-custom-bridge):透传给已注册的 CustomUiDataPart 渲染。
    case "data-pi-custom-ui":
      return { type: chunk.type, data: chunk.data };

    default: {
      // 穷尽性检查:若协议新增分支而未在此映射,编译期报错。
      const _exhaustive: never = chunk;
      void _exhaustive;
      throw new Error(
        `unmapped uiMessageChunk type: ${String((chunk as { type: string }).type)}`,
      );
    }
  }
}

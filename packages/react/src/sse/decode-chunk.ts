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
 * 从 tool 失败产出中抽取人类可读 errorText。
 * 兼容 pi tool result 形状 `{ content:[{type:"text",text}] }`、纯字符串、以及
 * sandbox block 的 `{ reason }` 等。
 */
export function formatToolErrorText(output: unknown): string {
  if (typeof output === "string") {
    const t = output.trim();
    return t.length > 0 ? t : "Tool error";
  }
  if (output !== null && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.errorText === "string" && o.errorText.trim()) return o.errorText;
    if (typeof o.reason === "string" && o.reason.trim()) return o.reason;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (Array.isArray(o.content)) {
      const parts: string[] = [];
      for (const item of o.content) {
        if (item !== null && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          if (typeof text === "string" && text.length > 0) parts.push(text);
        }
      }
      if (parts.length > 0) return parts.join("\n");
    }
    try {
      const json = JSON.stringify(output);
      if (json && json !== "{}" && json !== "null") return json;
    } catch {
      // ignore
    }
  }
  if (output === null || output === undefined) return "Tool error";
  return String(output);
}

/**
 * 把协议 uiMessageChunk 负载映射为 AI SDK UIMessageChunk。
 *
 * tool-output-error 在 AI SDK 中需 errorText;tool-output-available 的 isError 标志
 * 在协议里承载,这里据其转为 tool-output-error / tool-output-available。
 * （历史回归：曾只透传 type/output 而丢弃 isError，沙盒 block / 工具失败卡显示为
 * Completed 且错误文案进不了 error 态——见 decode-chunk isError 转换。）
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
      // 协议可用 isError 标记失败(server translate 历史路径仍可能发此形态);
      // AI SDK 只认 tool-output-error + errorText → 必须在此转换,否则前端工具卡
      // 停留 output-available/Completed,沙盒拒绝等原因不可见。
      if (chunk.isError === true) {
        return {
          type: "tool-output-error",
          toolCallId: chunk.toolCallId,
          errorText: formatToolErrorText(chunk.output),
        };
      }
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

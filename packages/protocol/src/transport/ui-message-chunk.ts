/**
 * pi-web 自定义传输层 — uiMessageChunk 负载 schema(喂给 AI SDK v5 useChat 的 UIMessage 流块)。
 *
 * 形状对齐 AI SDK v5 的 `UIMessageChunk` 联合(UI Message Stream parts),覆盖:
 *   - lifecycle: start / finish / start-step / finish-step / error / abort
 *   - text     : text-start / text-delta / text-end          ← message_update.text_*
 *   - reasoning: reasoning-start / reasoning-delta / reasoning-end ← message_update.thinking_*
 *   - tool     : tool-input-start / tool-input-delta / tool-input-available
 *                / tool-output-available / tool-output-error    ← tool_execution_*
 *   - data-part: 自定义 data-pi-* part 与通用 data-${string} part ← 见 data-part.ts
 *
 * 字段名贴合 AI SDK 约定:text/reasoning 用 `id` + `delta`;tool 用
 * `toolCallId`/`toolName`/`input`/`output`;`start` 携带可选 `messageId`;
 * `error`/`tool-output-error` 携带 `errorText`。
 * (本包只定义对象形状;实际 SSE 编解码/传输归 http-api。)
 */
import { z } from "zod";
import { DataPartSchema } from "./data-part.js";

/** AI SDK v5 流式生命周期块:创建/结束 assistant message 与 step 边界、错误、中断。 */
const LifecycleChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    messageId: z.string().optional(),
  }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("start-step") }),
  z.object({ type: z.literal("finish-step") }),
  z.object({ type: z.literal("error"), errorText: z.string() }),
  z.object({ type: z.literal("abort") }),
]);

const TextChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-start"), id: z.string() }),
  z.object({ type: z.literal("text-delta"), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal("text-end"), id: z.string() }),
]);

const ReasoningChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reasoning-start"), id: z.string() }),
  z.object({
    type: z.literal("reasoning-delta"),
    id: z.string(),
    delta: z.string(),
  }),
  z.object({ type: z.literal("reasoning-end"), id: z.string() }),
]);

const ToolChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool-input-start"),
    toolCallId: z.string(),
    toolName: z.string(),
  }),
  z.object({
    type: z.literal("tool-input-delta"),
    toolCallId: z.string(),
    inputTextDelta: z.string(),
  }),
  z.object({
    type: z.literal("tool-input-available"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool-output-available"),
    toolCallId: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("tool-output-error"),
    toolCallId: z.string(),
    errorText: z.string(),
  }),
]);

/**
 * uiMessageChunk 负载联合(以 `type` 判别)。lifecycle / text / reasoning / tool 为
 * AI SDK v5 标准块,data-pi-* 为 pi-web 自定义 data-part。
 */
export const UiMessageChunkSchema = z.union([
  LifecycleChunkSchema,
  TextChunkSchema,
  ReasoningChunkSchema,
  ToolChunkSchema,
  DataPartSchema,
]);
export type UiMessageChunk = z.infer<typeof UiMessageChunkSchema>;

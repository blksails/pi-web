/**
 * pi 原生派生 — AgentEvent 可辨识联合 schema(RPC 通道广播的事件流)。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   - @earendil-works/pi-agent-core/dist/types.d.ts → `AgentEvent`
 *       (agent_start / agent_end / turn_start / turn_end / message_start /
 *        message_update / message_end / tool_execution_start/update/end)
 *   - @earendil-works/pi-coding-agent/dist/core/agent-session.d.ts → `AgentSessionEvent`
 *       在 core 之上扩展:覆盖 agent_end(带 messages/willRetry)、queue_update、
 *       compaction_start/end、session_info_changed、thinking_level_changed、
 *       auto_retry_start/end。RPC 通道实际广播的是 AgentSessionEvent。
 *   - @earendil-works/pi-ai/dist/types.d.ts → `AssistantMessageEvent`
 *       (text_start/text_delta/text_end/thinking_start/thinking_delta/thinking_end/
 *        toolcall start-delta-end/done/error) —— 由 message_update.assistantMessageEvent 承载。
 *   - extension_ui_request 经 RPC 通道与事件同流广播,见 rpc/extension-ui.ts。
 *
 * 判别键:`type`。message_update 的子事件以内层 `assistantMessageEvent.type` 再判别。
 */
import { z } from "zod";
import {
  AgentMessageSchema,
  AssistantMessageSchema,
  ThinkingLevelSchema,
  ToolCallSchema,
} from "./model.js";
import { CompactionResultSchema } from "./session-state.js";
import { RpcExtensionUIRequestSchema } from "./extension-ui.js";

/**
 * pi-ai AssistantMessageEvent —— 由 message_update 携带,描述助手消息的流式增量。
 * 覆盖 text/thinking 的 start/delta/end,以及 toolcall 流式与终止事件。
 */
export const AssistantMessageEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), partial: AssistantMessageSchema }),
  z.object({
    type: z.literal("text_start"),
    contentIndex: z.number(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("text_delta"),
    contentIndex: z.number(),
    delta: z.string(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("text_end"),
    contentIndex: z.number(),
    content: z.string(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("thinking_start"),
    contentIndex: z.number(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("thinking_delta"),
    contentIndex: z.number(),
    delta: z.string(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("thinking_end"),
    contentIndex: z.number(),
    content: z.string(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("toolcall_start"),
    contentIndex: z.number(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("toolcall_delta"),
    contentIndex: z.number(),
    delta: z.string(),
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("toolcall_end"),
    contentIndex: z.number(),
    toolCall: ToolCallSchema,
    partial: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("done"),
    reason: z.enum(["stop", "length", "toolUse"]),
    message: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("error"),
    reason: z.enum(["aborted", "error"]),
    error: AssistantMessageSchema,
  }),
]);
export type AssistantMessageEvent = z.infer<
  typeof AssistantMessageEventSchema
>;

const CompactionReason = z.enum(["manual", "threshold", "overflow"]);

/**
 * 核心事件可辨识联合(判别键 `type`)。extension_ui_request 因内层以 `method` 再判别,
 * 与核心事件合并后会与 discriminatedUnion 的"每个判别值唯一一个分支"约束冲突,
 * 故单独保留,在 AgentEventSchema 处以 z.union 合并。
 */
const CoreAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_start") }),
  // AgentSessionEvent 覆盖了 core 的 agent_end:带 messages + willRetry。
  z.object({
    type: z.literal("agent_end"),
    messages: z.array(AgentMessageSchema),
    willRetry: z.boolean(),
  }),
  z.object({ type: z.literal("turn_start") }),
  z.object({
    type: z.literal("turn_end"),
    message: AgentMessageSchema,
    toolResults: z.array(z.unknown()),
  }),
  z.object({ type: z.literal("message_start"), message: AgentMessageSchema }),
  z.object({
    type: z.literal("message_update"),
    message: AgentMessageSchema,
    assistantMessageEvent: AssistantMessageEventSchema,
  }),
  z.object({ type: z.literal("message_end"), message: AgentMessageSchema }),
  z.object({
    type: z.literal("tool_execution_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_execution_update"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
    // partialResult 为累积值(替换即可)。
    partialResult: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_execution_end"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean(),
  }),
  // --- AgentSessionEvent 扩展 ---
  z.object({
    type: z.literal("queue_update"),
    steering: z.array(z.string()),
    followUp: z.array(z.string()),
  }),
  z.object({
    type: z.literal("compaction_start"),
    reason: CompactionReason,
  }),
  z.object({
    type: z.literal("compaction_end"),
    reason: CompactionReason,
    result: CompactionResultSchema.optional(),
    aborted: z.boolean(),
    willRetry: z.boolean(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal("session_info_changed"),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("thinking_level_changed"),
    level: ThinkingLevelSchema,
  }),
  z.object({
    type: z.literal("auto_retry_start"),
    attempt: z.number(),
    maxAttempts: z.number(),
    delayMs: z.number(),
    errorMessage: z.string(),
  }),
  z.object({
    type: z.literal("auto_retry_end"),
    success: z.boolean(),
    attempt: z.number(),
    finalError: z.string().optional(),
  }),
]);

/**
 * AgentEvent —— 核心事件联合 + extension_ui_request(同流广播的旁路 UI 请求)。
 * 仍以 `type` 可判别(extension_ui_request 的 type 在核心联合中不出现)。
 */
export const AgentEventSchema = z.union([
  CoreAgentEventSchema,
  RpcExtensionUIRequestSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

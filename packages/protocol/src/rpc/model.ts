/**
 * pi 原生派生 — Model / AgentMessage 及其内容部件 schema。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   - @earendil-works/pi-ai/dist/types.d.ts
 *       · Model<TApi>、TextContent、ThinkingContent、ImageContent、ToolCall、
 *         Usage、StopReason、UserMessage、AssistantMessage、ToolResultMessage、Message
 *   - @earendil-works/pi-agent-core/dist/types.d.ts
 *       · AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
 *       · ThinkingLevel(re-export 自 pi-ai)
 *
 * 说明:这些类型在包内未经 `exports` 导出,故本地化重建为 zod schema。
 * `Model.compat` 等与 provider 强相关的可选字段以宽松/passthrough 处理,
 * 避免与 pi 的内部联合细节耦合(本包只关心跨层稳定形状)。
 */
import { z } from "zod";

/** pi-ai: ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" */
export const ThinkingLevelSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

/** pi-ai: ModelThinkingLevel = "off" | ThinkingLevel */
export const ModelThinkingLevelSchema = z.union([
  z.literal("off"),
  ThinkingLevelSchema,
]);
export type ModelThinkingLevel = z.infer<typeof ModelThinkingLevelSchema>;

/** pi-ai: TextContent */
export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  textSignature: z.string().optional(),
});
export type TextContent = z.infer<typeof TextContentSchema>;

/** pi-ai: ThinkingContent */
export const ThinkingContentSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  thinkingSignature: z.string().optional(),
  redacted: z.boolean().optional(),
});
export type ThinkingContent = z.infer<typeof ThinkingContentSchema>;

/** pi-ai: ImageContent */
export const ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});
export type ImageContent = z.infer<typeof ImageContentSchema>;

/** pi-ai: ToolCall */
export const ToolCallSchema = z.object({
  type: z.literal("toolCall"),
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  thoughtSignature: z.string().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** pi-ai: Usage */
export const UsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  cacheWrite1h: z.number().optional(),
  totalTokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
});
export type Usage = z.infer<typeof UsageSchema>;

/** pi-ai: StopReason */
export const StopReasonSchema = z.enum([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

/** pi-ai: UserMessage */
export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.union([
    z.string(),
    z.array(z.union([TextContentSchema, ImageContentSchema])),
  ]),
  timestamp: z.number(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

/** pi-ai: AssistantMessage */
export const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.array(
    z.union([TextContentSchema, ThinkingContentSchema, ToolCallSchema]),
  ),
  api: z.string(),
  provider: z.string(),
  model: z.string(),
  responseModel: z.string().optional(),
  responseId: z.string().optional(),
  diagnostics: z.array(z.unknown()).optional(),
  usage: UsageSchema,
  stopReason: StopReasonSchema,
  errorMessage: z.string().optional(),
  timestamp: z.number(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

/** pi-ai: ToolResultMessage */
export const ToolResultMessageSchema = z.object({
  role: z.literal("toolResult"),
  toolCallId: z.string(),
  toolName: z.string(),
  content: z.array(z.union([TextContentSchema, ImageContentSchema])),
  details: z.unknown().optional(),
  isError: z.boolean(),
  timestamp: z.number(),
});
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;

/** pi-ai: Message = UserMessage | AssistantMessage | ToolResultMessage(以 role 判别) */
export const MessageSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
]);
export type Message = z.infer<typeof MessageSchema>;

/**
 * pi-agent-core: AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
 *
 * `CustomAgentMessages` 是可被扩展声明合并的接口(module augmentation),其成员形状
 * 在编译期对本包不可知。为防漂移又不丢失 RPC 流中的自定义消息,这里以基础 Message
 * 联合为主、并对带 `role` 的其它对象做 passthrough 容纳(自定义消息亦以 role 区分)。
 */
export const AgentMessageSchema = z.union([
  MessageSchema,
  z.object({ role: z.string() }).passthrough(),
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/**
 * pi-ai: Model<TApi>
 *
 * `compat` 因 api 不同而形状各异,这里以可选 passthrough 容纳;其余字段按 d.ts 重建。
 */
export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  api: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  reasoning: z.boolean(),
  thinkingLevelMap: z
    .record(z.string(), z.union([z.string(), z.null()]))
    .optional(),
  input: z.array(z.enum(["text", "image"])),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  }),
  contextWindow: z.number(),
  maxTokens: z.number(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: z.object({}).passthrough().optional(),
});
export type Model = z.infer<typeof ModelSchema>;

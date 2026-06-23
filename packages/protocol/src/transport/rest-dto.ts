/**
 * pi-web 自定义传输层 — REST DTO schema(建会话 + 各命令请求/响应)。
 *
 * 对应 PLAN.md §3.3 / §13.2 的 REST 面。本包仅定义 DTO 形状;端点实现归 http-api。
 *
 *   POST /sessions                         CreateSessionRequest → { sessionId }
 *   POST /sessions/:id/messages            PromptRequest        → CommandAck
 *   POST /sessions/:id/{steer,follow_up}   SteerRequest         → CommandAck
 *   POST /sessions/:id/abort               —                    → CommandAck
 *   POST /sessions/:id/model               SetModelRequest      → CommandAck
 *   POST /sessions/:id/thinking            SetThinkingRequest   → CommandAck
 *   GET  /sessions/:id/state               —                    → GetStateResponse
 *   GET  /sessions/:id/stats               —                    → GetStatsResponse
 *   GET  /sessions/:id/messages            —                    → GetMessagesResponse
 *   GET  /sessions/:id/commands            —                    → GetCommandsResponse
 *   POST /sessions/:id/ui-response         ExtensionUIResponse  → CommandAck
 *   DELETE /sessions/:id                   —                    → CommandAck
 *   GET  /sessions/:id/models              —                    → GetAvailableModelsResponse
 *   POST /sessions/:id/fork                ForkRequest          → ForkResponse
 *   GET  /sessions/:id/fork-messages       —                    → GetForkMessagesResponse
 */
import { z } from "zod";
import { ImageContentSchema, ModelSchema, ThinkingLevelSchema } from "../rpc/model.js";
import {
  RpcSessionStateSchema,
  RpcSlashCommandSchema,
  SessionStatsSchema,
} from "../rpc/session-state.js";
import { AgentMessageSchema } from "../rpc/model.js";
import { RpcExtensionUIResponseSchema } from "../rpc/extension-ui.js";
import { LogEntrySchema, LogLevelSchema } from "../logging/log-entry.js";

/**
 * 建会话请求:`{ source, cwd?, model?, env?, resumeId? }`。`source` 必填(agent 源标识)。
 * `resumeId` 存在即"恢复已有会话"而非新建——服务端据其从持久化存储读取创建元数据
 * (source/cwd/model)并以该标识恢复会话;缺失即新建。
 * 注意:与 SpawnSpec(四字段必填的启动规格)是不同契约,见 transport/spawn.ts。
 */
export const CreateSessionRequestSchema = z.object({
  source: z.string(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  resumeId: z.string().optional(),
  /**
   * 按请求的显式项目信任意图(门控工作目录下 `.pi/` 扩展/子代理/技能的加载)。
   * `true` → 信任并放行(并跨会话记住);`false` → 拒绝;缺省 → 由服务端信任策略
   * (持久化信任库 / trustedRoots / 安全默认)决定。
   */
  trust: z.boolean().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
});
export type CreateSessionResponse = z.infer<
  typeof CreateSessionResponseSchema
>;

/** 通用命令 ack 响应。 */
export const CommandAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type CommandAck = z.infer<typeof CommandAckSchema>;

export const PromptRequestSchema = z.object({
  message: z.string(),
  images: z.array(ImageContentSchema).optional(),
  streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  /**
   * 该消息附带的已落库附件的公开 id 列表(`att_<nanoid>`),由前端提交。
   * 服务端据此查元数据并以结构化文本引用注入用户消息文本(attachment-tool-bridge,
   * Req 8.1);与 `images`/vision base64 并存,不替代、不内联字节(Req 9.1)。
   */
  attachmentIds: z.array(z.string()).optional(),
});
export type PromptRequest = z.infer<typeof PromptRequestSchema>;

export const SteerRequestSchema = z.object({
  message: z.string(),
  images: z.array(ImageContentSchema).optional(),
});
export type SteerRequest = z.infer<typeof SteerRequestSchema>;

export const SetModelRequestSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
});
export type SetModelRequest = z.infer<typeof SetModelRequestSchema>;

export const SetThinkingRequestSchema = z.object({
  level: ThinkingLevelSchema,
});
export type SetThinkingRequest = z.infer<typeof SetThinkingRequestSchema>;

export const GetStateResponseSchema = z.object({
  state: RpcSessionStateSchema,
});
export type GetStateResponse = z.infer<typeof GetStateResponseSchema>;

export const GetStatsResponseSchema = z.object({
  stats: SessionStatsSchema,
});
export type GetStatsResponse = z.infer<typeof GetStatsResponseSchema>;

export const GetMessagesResponseSchema = z.object({
  messages: z.array(AgentMessageSchema),
});
export type GetMessagesResponse = z.infer<typeof GetMessagesResponseSchema>;

export const GetCommandsResponseSchema = z.object({
  commands: z.array(RpcSlashCommandSchema),
});
export type GetCommandsResponse = z.infer<typeof GetCommandsResponseSchema>;

/** ui-response 请求体即 pi 的 RpcExtensionUIResponse。 */
export const UiResponseRequestSchema = RpcExtensionUIResponseSchema;
export type UiResponseRequest = z.infer<typeof UiResponseRequestSchema>;

/**
 * GET /sessions/:id/models 响应 —— 复用既有 `Model` schema。
 * 对齐 RpcCommand `get_available_models` 的成功响应 `{ models: Model[] }`(见 rpc/response.ts)。
 * 模型列表仅来自 pi,不含写死项;空列表合法(对应"模型选择器降级"语义,见 Requirement 4.4/4.5)。
 */
export const GetAvailableModelsResponseSchema = z.object({
  models: z.array(ModelSchema),
});
export type GetAvailableModelsResponse = z.infer<
  typeof GetAvailableModelsResponseSchema
>;

/**
 * POST /sessions/:id/fork 请求 —— 复用既有 entryId 形状。
 * 对齐 RpcCommand `fork`(`{ type: "fork", entryId }`)。
 */
export const ForkRequestSchema = z.object({
  entryId: z.string(),
});
export type ForkRequest = z.infer<typeof ForkRequestSchema>;

/**
 * POST /sessions/:id/fork 响应。
 * 对齐 RpcCommand `fork` 的成功响应 `{ text, cancelled }`(见 rpc/response.ts);
 * 两字段在 REST 透传面均为可选(取消时可仅返回 `cancelled`)。
 */
export const ForkResponseSchema = z.object({
  text: z.string().optional(),
  cancelled: z.boolean().optional(),
});
export type ForkResponse = z.infer<typeof ForkResponseSchema>;

/**
 * GET /sessions/:id/fork-messages 响应。
 * 对齐 RpcCommand `get_fork_messages` 的成功响应 `{ messages: { entryId, text }[] }`
 * (见 rpc/response.ts)。
 */
export const GetForkMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({ entryId: z.string(), text: z.string() }),
  ),
});
export type GetForkMessagesResponse = z.infer<
  typeof GetForkMessagesResponseSchema
>;

/**
 * GET /sessions/:id/logs 响应 —— 返回结构化日志条目列表。
 * 对应 Requirement 3.3 / design Event Contract: control:logs。
 */
export const GetLogsResponseSchema = z.object({
  entries: z.array(LogEntrySchema),
});
export type GetLogsResponse = z.infer<typeof GetLogsResponseSchema>;

/**
 * GET /sessions/:id/logs 查询参数 schema。
 * 所有字段可选:level 过滤级别、limit 最大条数、since 起始 epoch ms。
 * 对应 Requirement 4.1 (REST 日志端点查询参数)。
 */
export const GetLogsQuerySchema = z.object({
  level: LogLevelSchema.optional(),
  limit: z.number().optional(),
  since: z.number().optional(),
});
export type GetLogsQuery = z.infer<typeof GetLogsQuerySchema>;

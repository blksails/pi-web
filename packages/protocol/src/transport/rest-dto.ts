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
 */
import { z } from "zod";
import { ImageContentSchema, ThinkingLevelSchema } from "../rpc/model.js";
import {
  RpcSessionStateSchema,
  RpcSlashCommandSchema,
  SessionStatsSchema,
} from "../rpc/session-state.js";
import { AgentMessageSchema } from "../rpc/model.js";
import { RpcExtensionUIResponseSchema } from "../rpc/extension-ui.js";

/**
 * 建会话请求:`{ source, cwd?, model?, env? }`。`source` 必填(agent 源标识)。
 * 注意:与 SpawnSpec(四字段必填的启动规格)是不同契约,见 transport/spawn.ts。
 */
export const CreateSessionRequestSchema = z.object({
  source: z.string(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
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

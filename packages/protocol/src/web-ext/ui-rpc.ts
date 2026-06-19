/**
 * web-ext 契约 — UI↔agent RPC(Tier 3 贡献点 + artifact 经宿主回 agent 的双向通道)。
 *
 * 复用既有传输:上行经 REST `POST /sessions/:id/ui-rpc`(body=UiRpcRequest);
 * 下行经 SSE `control` 帧 `{ control: "ui-rpc", response }`,按 `correlationId` 配对。
 * 纯数据 + zod。payload/result 形状按 point 在消费侧细化,这里用 unknown 保持传输无关。
 */
import { z } from "zod";

/** 贡献点类别(slash/@mention/补全/命令/自定义)。 */
export const UiRpcPointSchema = z.enum([
  "slash",
  "mention",
  "autocomplete",
  "inlineComplete",
  "command",
  "custom",
]);
export type UiRpcPoint = z.infer<typeof UiRpcPointSchema>;

/** 动作:列候选/解析实体/执行/补全。 */
export const UiRpcActionSchema = z.enum([
  "list",
  "resolve",
  "execute",
  "complete",
]);
export type UiRpcAction = z.infer<typeof UiRpcActionSchema>;

/** UI → agent 请求。correlationId 用于配对下行响应。 */
export const UiRpcRequestSchema = z.object({
  correlationId: z.string().min(1),
  point: UiRpcPointSchema,
  action: UiRpcActionSchema,
  payload: z.unknown(),
  protocolVersion: z.string(),
});
export type UiRpcRequest = z.infer<typeof UiRpcRequestSchema>;

/** agent → UI 响应。ok=false 时带 error。 */
export const UiRpcResponseSchema = z.object({
  correlationId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
});
export type UiRpcResponse = z.infer<typeof UiRpcResponseSchema>;

/** SSE `control` 帧的 ui-rpc 载荷(下行响应)。 */
export const UiRpcControlPayloadSchema = z.object({
  control: z.literal("ui-rpc"),
  response: UiRpcResponseSchema,
});
export type UiRpcControlPayload = z.infer<typeof UiRpcControlPayloadSchema>;

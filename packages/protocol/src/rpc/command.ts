/**
 * pi 原生派生 — RpcCommand schema(stdin 上的 JSONL 命令)。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   @earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts → `RpcCommand`
 *
 * 形状:以 `type` 为判别键的可辨识联合;所有命令携带可选 `id`(关联响应)。
 */
import { z } from "zod";
import { ImageContentSchema, ThinkingLevelSchema } from "./model.js";

const base = { id: z.string().optional() };

export const RpcCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("prompt"),
    message: z.string(),
    images: z.array(ImageContentSchema).optional(),
    streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("steer"),
    message: z.string(),
    images: z.array(ImageContentSchema).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("follow_up"),
    message: z.string(),
    images: z.array(ImageContentSchema).optional(),
  }),
  z.object({ ...base, type: z.literal("abort") }),
  z.object({
    ...base,
    type: z.literal("new_session"),
    parentSession: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("get_state") }),
  z.object({
    ...base,
    type: z.literal("set_model"),
    provider: z.string(),
    modelId: z.string(),
  }),
  z.object({ ...base, type: z.literal("cycle_model") }),
  z.object({ ...base, type: z.literal("get_available_models") }),
  z.object({
    ...base,
    type: z.literal("set_thinking_level"),
    level: ThinkingLevelSchema,
  }),
  z.object({ ...base, type: z.literal("cycle_thinking_level") }),
  z.object({
    ...base,
    type: z.literal("set_steering_mode"),
    mode: z.enum(["all", "one-at-a-time"]),
  }),
  z.object({
    ...base,
    type: z.literal("set_follow_up_mode"),
    mode: z.enum(["all", "one-at-a-time"]),
  }),
  z.object({
    ...base,
    type: z.literal("compact"),
    customInstructions: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("set_auto_compaction"),
    enabled: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal("set_auto_retry"),
    enabled: z.boolean(),
  }),
  z.object({ ...base, type: z.literal("abort_retry") }),
  z.object({
    ...base,
    type: z.literal("bash"),
    command: z.string(),
    excludeFromContext: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal("abort_bash") }),
  z.object({ ...base, type: z.literal("get_session_stats") }),
  z.object({
    ...base,
    type: z.literal("export_html"),
    outputPath: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("switch_session"),
    sessionPath: z.string(),
  }),
  z.object({ ...base, type: z.literal("fork"), entryId: z.string() }),
  z.object({ ...base, type: z.literal("clone") }),
  z.object({ ...base, type: z.literal("get_fork_messages") }),
  z.object({ ...base, type: z.literal("get_last_assistant_text") }),
  z.object({
    ...base,
    type: z.literal("set_session_name"),
    name: z.string(),
  }),
  z.object({ ...base, type: z.literal("get_messages") }),
  z.object({ ...base, type: z.literal("get_commands") }),
]);
export type RpcCommand = z.infer<typeof RpcCommandSchema>;

/** pi: RpcCommandType = RpcCommand["type"] */
export type RpcCommandType = RpcCommand["type"];

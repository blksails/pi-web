/**
 * pi 原生派生 — RpcResponse schema(stdout 上的 JSONL 响应,按 `id` 关联命令)。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   @earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts → `RpcResponse`
 *
 * 形状:`type: "response"` 固定;以 `command` 区分成功负载;失败分支 `success: false` + `error`。
 * 由于成功/失败均以 `type:"response"` 标记,无法用 discriminatedUnion(判别键唯一),
 * 故用 z.union;失败分支放在最后(其 `command` 为任意 string + `success: false`)。
 */
import { z } from "zod";
import { AgentMessageSchema, ModelSchema, ThinkingLevelSchema } from "./model.js";
import {
  BashResultSchema,
  CompactionResultSchema,
  RpcSessionStateSchema,
  RpcSlashCommandSchema,
  SessionStatsSchema,
} from "./session-state.js";

const base = { id: z.string().optional(), type: z.literal("response") };
const ok = (command: string, data?: z.ZodTypeAny) =>
  data
    ? z.object({ ...base, command: z.literal(command), success: z.literal(true), data })
    : z.object({ ...base, command: z.literal(command), success: z.literal(true) });

export const RpcResponseSchema = z.union([
  ok("prompt"),
  ok("steer"),
  ok("follow_up"),
  ok("abort"),
  ok("new_session", z.object({ cancelled: z.boolean() })),
  ok("get_state", RpcSessionStateSchema),
  ok("set_model", ModelSchema),
  ok(
    "cycle_model",
    z.union([
      z.object({
        model: ModelSchema,
        thinkingLevel: ThinkingLevelSchema,
        isScoped: z.boolean(),
      }),
      z.null(),
    ]),
  ),
  ok("get_available_models", z.object({ models: z.array(ModelSchema) })),
  ok("set_thinking_level"),
  ok(
    "cycle_thinking_level",
    z.union([z.object({ level: ThinkingLevelSchema }), z.null()]),
  ),
  ok("set_steering_mode"),
  ok("set_follow_up_mode"),
  ok("compact", CompactionResultSchema),
  ok("set_auto_compaction"),
  ok("set_auto_retry"),
  ok("abort_retry"),
  ok("bash", BashResultSchema),
  ok("abort_bash"),
  ok("get_session_stats", SessionStatsSchema),
  ok("export_html", z.object({ path: z.string() })),
  ok("switch_session", z.object({ cancelled: z.boolean() })),
  ok("fork", z.object({ text: z.string(), cancelled: z.boolean() })),
  ok("clone", z.object({ cancelled: z.boolean() })),
  ok(
    "get_fork_messages",
    z.object({
      messages: z.array(z.object({ entryId: z.string(), text: z.string() })),
    }),
  ),
  ok("get_last_assistant_text", z.object({ text: z.union([z.string(), z.null()]) })),
  ok("set_session_name"),
  ok("get_messages", z.object({ messages: z.array(AgentMessageSchema) })),
  ok("get_commands", z.object({ commands: z.array(RpcSlashCommandSchema) })),
  // 失败分支:任意 command + success:false + error
  z.object({
    ...base,
    command: z.string(),
    success: z.literal(false),
    error: z.string(),
  }),
]);
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/**
 * web-ext 契约 — 状态注入桥(state-injection-bridge)的可序列化契约面。
 *
 * 一条独立于 LLM 对话历史之外的会话级共享状态路线:
 *   - 下行(agent→UI):权威 KV 变更经 SSE `control:"state"` 帧镜像到前端。
 *   - 写回(UI→agent):前端经 `POST /sessions/:id/state` 写回,server 转 server↔runner 内部行
 *     `piweb_state_set` / `piweb_state_delete` 下发子进程 stdin。
 *   - 内部行(server↔runner):子进程经 stdout `piweb_state` 行上报变更,server 截获翻译为 control 帧。
 *
 * 纯数据 + zod。`value` 为传输无关的任意可 JSON 值(z.unknown),不限定为文本。
 */
import { z } from "zod";

/** SSE `control` 帧的 state 载荷(下行镜像;并入 transport/sse-frame 的判别联合)。 */
export const StateControlPayloadSchema = z.object({
  control: z.literal("state"),
  key: z.string().min(1),
  value: z.unknown(),
  /** 该 key 的单调递增修订号(前端据此丢弃乱序/过期帧)。 */
  rev: z.number().int().nonnegative(),
  /** 为 true 时表示该 key 被删除(value 应忽略)。 */
  deleted: z.boolean().optional(),
});
export type StateControlPayload = z.infer<typeof StateControlPayloadSchema>;

/** `POST /sessions/:id/state` 请求体(UI→agent 写回)。 */
export const StateSetRequestSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  /** 写入或删除;缺省为 set。 */
  op: z.enum(["set", "delete"]).default("set"),
});
export type StateSetRequest = z.infer<typeof StateSetRequestSchema>;

/** `POST /sessions/:id/state` 响应体(同步 ack)。 */
export const StateSetResponseSchema = z.object({
  ok: z.boolean(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type StateSetResponse = z.infer<typeof StateSetResponseSchema>;

/** server↔runner 内部行 — 子进程 stdout 上报的状态变更(下行源)。 */
export const StateDownLineSchema = z.object({
  type: z.literal("piweb_state"),
  key: z.string().min(1),
  value: z.unknown(),
  rev: z.number().int().nonnegative(),
  deleted: z.boolean().optional(),
});
export type StateDownLine = z.infer<typeof StateDownLineSchema>;

/** server↔runner 内部行 — server 经 stdin 下发的写回命令(被 runner 第二个读取器截获)。 */
export const StateSetLineSchema = z.object({
  type: z.enum(["piweb_state_set", "piweb_state_delete"]),
  key: z.string().min(1),
  value: z.unknown().optional(),
});
export type StateSetLine = z.infer<typeof StateSetLineSchema>;

/**
 * web-ext 契约 — agent 权威 surface(agent-authoritative-surface)的命令 payload/result 形状。
 *
 * surface 是「富交互 UI = agent 进程里某 `domain` 的瘦投影 + 命令发起端」这一 CQRS 范式的
 * 领域无关门面。状态权威永在 agent 子进程(经既有 `control:"state"` KV 桥,`key="surface:<domain>"`
 * 镜像下行),命令经 Tier3 ui-rpc 的 **agent 转发路径**上行(`point="command"` / `action="execute"`)。
 *
 * 这两个 schema 在消费侧细化 ui-rpc 的 unknown payload/result,**不改** `UiRpcRequestSchema` /
 * `UiRpcResponseSchema` / `UiRpcControlPayloadSchema` 结构(向后兼容);也不新增任何顶层 control 帧。
 *
 * 关键约束:`SurfaceCommandPayload` **不含顶层 `name` 字段** —— 使 `CommandExecutePayloadSchema`
 * (要求 `name`)`safeParse` 失败,从而逃逸宿主主进程的 host 命令拦截,自然落到 `session.uiRpc`
 * 转发进 agent 子进程(见 `command-routes.ts` `makeUiRpcHandler`)。
 */
import { z } from "zod";

/** surface state 快照的 key 约定:与探针命令 `surface:<domain>` 同名段。 */
export type SurfaceKey = `surface:${string}`;

/** 由 domain 构造 surface state 的 KV key(单一真源,避免手拼字符串)。 */
export function surfaceStateKey(domain: string): SurfaceKey {
  return `surface:${domain}`;
}

/**
 * point="command" / action="execute" 时,surface 命令的 payload 细化。
 *
 * **无顶层 `name`**(以逃逸 host 拦截);`args` 为传输无关的任意可 JSON 值。
 */
export const SurfaceCommandPayloadSchema = z.object({
  domain: z.string().min(1),
  action: z.string().min(1),
  args: z.unknown().optional(),
});
export type SurfaceCommandPayload = z.infer<typeof SurfaceCommandPayloadSchema>;

/** ui-rpc `response.result` 的 surface 细化(命令回流结果)。 */
export const SurfaceCommandResultSchema = z.object({
  domain: z.string().min(1),
  action: z.string().min(1),
  ok: z.boolean(),
  /** 成功时的领域数据(轻量;二进制走 `att_` 引用,永不进帧)。 */
  data: z.unknown().optional(),
  /** 失败时的稳定领域码 + 信息。 */
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type SurfaceCommandResult = z.infer<typeof SurfaceCommandResultSchema>;

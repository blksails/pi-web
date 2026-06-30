/**
 * pi-web 自定义传输层 — 会话权威快照(session-snapshot-authority)。
 *
 * 把会话状态从「事件流被各 feature 各自归约、状态被前端 useChat 与 ControlStore 劈两半」
 * 收口为**服务端唯一权威** `SessionSnapshot`:lifecycle/busy/turn/stats/model/title 六字段。
 * 服务端在任一字段变更时广播一条 `control: session-state` 帧(粘性,订阅时回放当前态),
 * 前端据此纯投影派生 busy/ready/stats,不再从消息流 status 时序推断。
 *
 * 该帧为**新增**控制帧:旧消费者遇到未知 `control` 走 default 分支安全忽略(向后兼容)。
 * 与 `session-status`(就绪握手)正交并存:`session-state.snapshot.lifecycle` 与之同义,
 * 过渡期两帧并存,快照为权威来源。零运行时、isomorphic;并入 sse-frame 的 ControlPayload。
 */
import { z } from "zod";
import { SessionLifecycleStateSchema } from "./session-status.js";

/**
 * 会话权威快照:服务端为唯一写者。
 * - `lifecycle`:业务就绪态(与 session-status 状态机一致)。
 * - `busy`:轮次活跃区间(agent_start..agent_end 之间为 true);权威字段,非时序推断。
 * - `turn`:当前轮次信息(`startedAt` 由服务端注入,保证归约纯函数可测)。
 * - `stats`:会话用量统计(passthrough,按 SessionStats 解读),单一来源。
 * - `model`:当前模型(最近已知值)。
 * - `title`:会话标题(最近已知值)。
 * 字段缺省即「未知」,不编造默认(Req 1.5)。
 */
export const SessionSnapshotSchema = z.object({
  lifecycle: SessionLifecycleStateSchema,
  busy: z.boolean(),
  turn: z.object({ startedAt: z.number() }).optional(),
  stats: z.object({}).passthrough().optional(),
  model: z.unknown().optional(),
  title: z.string().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

/**
 * `control: session-state` 控制帧负载:承载完整权威快照。
 * 每次任一权威字段变更广播一帧;新订阅者订阅时回放当前快照(粘性)。
 */
export const SessionStateControlSchema = z.object({
  control: z.literal("session-state"),
  snapshot: SessionSnapshotSchema,
});
export type SessionStateControl = z.infer<typeof SessionStateControlSchema>;

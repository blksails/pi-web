/**
 * web-ext 契约 — message queue「取回」(clearQueue)的可序列化契约面。
 *
 * pi 的 `AgentSession.clearQueue()` 不在 pi 的 RPC 命令集内,故复用 state-injection-bridge 的
 * 「第二个 stdin 读取器 + 自定义 stdout 行」接缝在 pi-web 内闭环(pi 上游零改动):
 *   - 请求(server→runner):server 经 stdin 下发内部行 `piweb_clear_queue`(含关联 id),被 runner
 *     的 `wireClearQueueBridge` 第二个读取器截获 → 调 `runtime.session.clearQueue()`。
 *   - 结果(runner→server):runner 经 stdout 写回内部行 `piweb_clear_queue_result`(同 id + 被清空的
 *     steering / followUp 文本),server 的 `handleRawLine` 按 id 配对 pending 请求 resolve。
 *
 * 关联 id 隔离于 `PiRpcProcess` 的 RPC pending map;pi 自身 stdin 读取器对该请求行回无害
 * `Unknown command`(id 不匹配→丢弃),与 state 桥同已知无害行为。
 *
 * 纯数据 + zod,同构零运行时。
 */
import { z } from "zod";

/** server↔runner 内部行 — server 经 stdin 下发的清空队列请求(被 runner 第二个读取器截获)。 */
export const ClearQueueLineSchema = z.object({
  type: z.literal("piweb_clear_queue"),
  /** 关联 id,用于把结果行配对回发起的 pending 请求。 */
  id: z.string().min(1),
});
export type ClearQueueLine = z.infer<typeof ClearQueueLineSchema>;

/** server↔runner 内部行 — runner 经 stdout 写回的清空队列结果(被 server handleRawLine 截获)。 */
export const ClearQueueResultLineSchema = z.object({
  type: z.literal("piweb_clear_queue_result"),
  id: z.string().min(1),
  /** 被清空的 steering(插话)消息文本,按原有先后。 */
  steering: z.array(z.string()),
  /** 被清空的 follow-up(跟进)消息文本,按原有先后。 */
  followUp: z.array(z.string()),
});
export type ClearQueueResultLine = z.infer<typeof ClearQueueResultLineSchema>;

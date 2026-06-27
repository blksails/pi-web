/**
 * pi-web 自定义传输层 — 会话生命周期状态(session-readiness-handshake)。
 *
 * pi 子进程启动后存在就绪竞态:服务端把会话/进程标记为可用早于 agent 真正能处理命令,
 * 而 pi 事件流中**不存在** session_start/ready 锚点。本模块定义会话**业务就绪态**的枚举
 * 与一条**粘性** `control: session-status` 旁路控制帧:服务端以只读探针(getCommands)的
 * 首条响应判定真实就绪,经此帧广播,并在新订阅者订阅时回放当前态(防早期帧丢失)。
 *
 * 该业务就绪态与通道层活动态(active/stopping/stopped)正交,二者并存、互不复用。
 * 零运行时、isomorphic;并入 sse-frame 的 ControlPayload 判别联合(以 `control` 判别)。
 */
import { z } from "zod";

/**
 * 会话生命周期状态:
 * - `initializing`:子进程已起、就绪探针尚未成功(默认初态,失败安全:未确认即不可发送)。
 * - `ready`:就绪探针首条响应,agent 可接受 prompt。
 * - `error`:探针超时 / 子进程就绪前早退,会话不可用。
 * - `ended`:正常停止 / 就绪后子进程退出。
 */
export const SessionLifecycleStateSchema = z.enum([
  "initializing",
  "ready",
  "error",
  "ended",
]);
export type SessionLifecycleState = z.infer<typeof SessionLifecycleStateSchema>;

/**
 * `control: session-status` 控制帧负载。
 * - `state`:当前生命周期态。
 * - `detail`:人类可读原因(error/ended 场景填,可选)。
 * - `code`:机器可判别码(如 `probe-timeout` / `exit-before-ready`,可选)。
 */
export const SessionStatusControlSchema = z.object({
  control: z.literal("session-status"),
  state: SessionLifecycleStateSchema,
  detail: z.string().optional(),
  code: z.string().optional(),
});
export type SessionStatusControl = z.infer<typeof SessionStatusControlSchema>;

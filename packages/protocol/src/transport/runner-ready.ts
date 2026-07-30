/**
 * pi-web 传输层 — runner 就绪通告帧(spec runner-ready-frame)。
 *
 * runner 子进程完成装配、RPC 服务循环可接收命令时,经既有上行通道(与 `slash_completions`
 * 同族的 agent→server 一次性帧)主动发出本帧一次。`PiSession.handleRawLine` 收到即把生命周期
 * 迁移为 `ready`,取代原「服务端周期性探针」判定方式(spec `session-readiness-handshake`)。
 *
 * 最小单字段:仅需类型标记本身即可唯一识别,无需携带任何负载。
 */
import { z } from "zod";

/** runner 就绪通告帧:runner 可服务时上报一次。 */
export const RunnerReadyFrameSchema = z.object({
  type: z.literal("runner_ready"),
});
export type RunnerReadyFrame = z.infer<typeof RunnerReadyFrameSchema>;

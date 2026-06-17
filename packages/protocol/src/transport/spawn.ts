/**
 * pi-web 自定义传输层 — SpawnSpec 子进程启动规格(跨层契约)。
 *
 * 由 `agent-source-resolver` 产出、`rpc-channel` 消费:源解析后得到的、可直接交给
 * 子进程启动的具体命令规格(已无歧义、四字段必填)。
 *
 * 与建会话请求 DTO `CreateSessionRequest { source, cwd?, model?, env? }` 是**不同契约**:
 *   - CreateSessionRequest 是 REST 入参(source 为 agent 源标识,cwd/env 可选)。
 *   - SpawnSpec 是源解析"之后"的具体启动规格(四字段全必填)。
 * 二者不可混用、不复用形状。本包仅拥有并导出其形状,不实现源解析与 spawn 行为。
 */
import { z } from "zod";

export const SpawnSpecSchema = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  env: z.record(z.string(), z.string()),
});
export type SpawnSpec = z.infer<typeof SpawnSpecSchema>;

/**
 * pi 原生派生 — RpcSessionState 及其相关辅助类型 schema。
 *
 * 来源 d.ts(对齐 pi 0.79.x):
 *   - @earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts
 *       · RpcSessionState、RpcSlashCommand
 *   - @earendil-works/pi-coding-agent/dist/core/agent-session.d.ts → SessionStats
 *   - @earendil-works/pi-coding-agent/dist/core/compaction/compaction.d.ts → CompactionResult
 *   - @earendil-works/pi-coding-agent/dist/core/bash-executor.d.ts → BashResult
 *   - @earendil-works/pi-coding-agent/dist/core/source-info.d.ts → SourceInfo
 */
import { z } from "zod";
import { ModelSchema, ThinkingLevelSchema } from "./model.js";

const SteeringMode = z.enum(["all", "one-at-a-time"]);

/** pi: RpcSessionState */
export const RpcSessionStateSchema = z.object({
  model: ModelSchema.optional(),
  thinkingLevel: ThinkingLevelSchema,
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  steeringMode: SteeringMode,
  followUpMode: SteeringMode,
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  sessionName: z.string().optional(),
  autoCompactionEnabled: z.boolean(),
  messageCount: z.number(),
  pendingMessageCount: z.number(),
});
export type RpcSessionState = z.infer<typeof RpcSessionStateSchema>;

/** pi: SourceInfo (core/source-info.d.ts) */
export const SourceInfoSchema = z.object({
  path: z.string(),
  source: z.string(),
  scope: z.enum(["user", "project", "temporary"]),
  origin: z.enum(["package", "top-level"]),
  baseDir: z.string().optional(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

/** pi: RpcSlashCommand。`builtin` 为 harness 内置命令(builtin-plugin-command);
 *  其无 agent 来源,故 `sourceInfo` 对内置命令省略(agent 命令仍恒带,向后兼容)。 */
export const RpcSlashCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["extension", "prompt", "skill", "builtin"]),
  sourceInfo: SourceInfoSchema.optional(),
  /**
   * 该扩展命令是否由其所属统一插件经 `pi-plugin.json` 的 `web.commands` 声明为
   * **web 可见**(plugin-system-unification 增量)。服务端 get_commands 据清单回填;
   * 前端补全对 `webVisible===true` 的扩展命令放行(保留"默认隐藏扩展命令"安全网,
   * 插件显式 opt-in)。仅对 `source:"extension"` 有意义。
   */
  webVisible: z.boolean().optional(),
});
export type RpcSlashCommand = z.infer<typeof RpcSlashCommandSchema>;

/** pi: SessionStats (core/agent-session.d.ts) */
export const SessionStatsSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  userMessages: z.number(),
  assistantMessages: z.number(),
  toolCalls: z.number(),
  toolResults: z.number(),
  totalMessages: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
  cost: z.number(),
  // ContextUsage 形状随上下文估算实现演进,这里宽松容纳。
  contextUsage: z.object({}).passthrough().optional(),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

/** pi: CompactionResult (core/compaction/compaction.d.ts) */
export const CompactionResultSchema = z.object({
  summary: z.string(),
  firstKeptEntryId: z.string(),
  tokensBefore: z.number(),
  details: z.unknown().optional(),
});
export type CompactionResult = z.infer<typeof CompactionResultSchema>;

/** pi: BashResult (core/bash-executor.d.ts) */
export const BashResultSchema = z.object({
  output: z.string(),
  exitCode: z.number().optional(),
  cancelled: z.boolean(),
  truncated: z.boolean(),
  fullOutputPath: z.string().optional(),
});
export type BashResult = z.infer<typeof BashResultSchema>;

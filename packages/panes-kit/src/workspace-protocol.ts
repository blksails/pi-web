/**
 * panes 工作区遥控协议(LLM → PanesHost)：领域中立的意图日志 + 回声契约。
 *
 * 状态权威仍在宿主(PanesHost 本地 reducer；用户点击零延迟、无会话也可用)。agent 侧经
 * surface domain `panes-workspace` 发布**意图操作日志**(单调 opId、窗口截断)，宿主按
 * opId 增量应用；宿主每次工作区变化经 surface 命令 `report` 回声实况(pane 目录/实例/
 * 激活态)，使 LLM 工具读到真实工作区。
 *
 * 幂等与重放安全：宿主对首帧快照取基线(不重放历史 ops)；快照粘性重放/重连只含已应用
 * opId，天然跳过；agent 重启导致 opId 回退时宿主自动再基线。
 */
import { z } from "zod";
import type { PaneInstanceState } from "./contract.js";

export const PANES_WORKSPACE_DOMAIN = "panes-workspace";
export const PANES_WORKSPACE_REPORT_ACTION = "report";
/** 意图日志窗口：快照仅保留最近 N 条 ops(宿主离线超过窗口的旧意图不追补)。 */
export const PANES_WORKSPACE_OPS_WINDOW = 32;

const IdSchema = z.string().min(1).max(128);
const OpIdSchema = z.number().int().positive();

/** activate/close/reload 支持 instanceId 精确定位，或 paneId 便捷定位(取该 pane 首个实例)。 */
export const PaneWorkspaceOpSchema = z.discriminatedUnion("type", [
  z.object({ opId: OpIdSchema, type: z.literal("open"), paneId: IdSchema }),
  z.object({ opId: OpIdSchema, type: z.literal("activate"), instanceId: IdSchema.optional(), paneId: IdSchema.optional() }),
  z.object({ opId: OpIdSchema, type: z.literal("close"), instanceId: IdSchema.optional(), paneId: IdSchema.optional() }),
  z.object({ opId: OpIdSchema, type: z.literal("reload"), instanceId: IdSchema.optional(), paneId: IdSchema.optional() }),
]);
export type PaneWorkspaceOp = z.infer<typeof PaneWorkspaceOpSchema>;

const InstanceStateSchema = z.enum([
  "creating",
  "connecting",
  "ready",
  "hidden",
  "failed",
  "disposed",
]) satisfies z.ZodType<PaneInstanceState>;

export const PaneWorkspaceReportSchema = z.object({
  /** 宿主已消费到的最大 opId(含基线跳过的历史)。 */
  appliedOpId: z.number().int().nonnegative(),
  activeInstanceId: IdSchema.optional(),
  /** 可开 pane 目录(来自宿主 definition；LLM 由此发现 paneId 与配额)。 */
  panes: z.array(z.object({
    paneId: IdSchema,
    title: z.string(),
    openCount: z.number().int().nonnegative(),
    maxInstances: z.number().int().positive(),
    allowMultiple: z.boolean(),
  })),
  instances: z.array(z.object({
    instanceId: IdSchema,
    paneId: IdSchema,
    epoch: z.number().int().positive(),
    state: InstanceStateSchema,
  })),
});
export type PaneWorkspaceReport = z.infer<typeof PaneWorkspaceReportSchema>;

export const PanesWorkspaceSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  ops: z.array(PaneWorkspaceOpSchema),
  report: PaneWorkspaceReportSchema.optional(),
});
export type PanesWorkspaceSnapshot = z.infer<typeof PanesWorkspaceSnapshotSchema>;

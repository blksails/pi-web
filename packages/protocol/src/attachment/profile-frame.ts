/**
 * pi-web 协议层 — agent 具名附件 profile 装配期声明帧(`agent-attachment-profile` spec,
 * 任务 1.1;Req 2.3)。
 *
 * `slash_completions`/`agent_routes` 同族:纯数据单帧,runner 子进程装配期(`runRpcMode` 之前)
 * 经 stdout 发射一次;主进程 `PiSession.handleRawLine` 识别并按会话缓存为只读投影。
 * 未声明 `attachmentProfile` 的 agent 不发此帧(existing sessions 零行为变化)。
 */
import { z } from "zod";

export const AgentAttachmentProfileFrameSchema = z.object({
  type: z.literal("agent_attachment_profile"),
  /** 宿主注册的具名后端名(纯字符串,agent 侧无凭据/端点通道)。 */
  profile: z.string().min(1),
});
export type AgentAttachmentProfileFrame = z.infer<
  typeof AgentAttachmentProfileFrameSchema
>;

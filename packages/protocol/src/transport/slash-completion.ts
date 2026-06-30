/**
 * pi-web 传输层 — agent 声明的 slash 命令补全候选(spec agent-slash-completion)。
 *
 * 两类 schema:
 *  - `SlashCompletionDecl`:agent(经 `AgentDefinition.slashCompletions`)声明的**静态**
 *    伪命令补全候选。纯数据(无函数 / 无 pi SDK 导入),前端安全,可被 agent-kit /
 *    server / tool-kit 共同引用。
 *  - `SlashCompletionsFrame`:agent 子进程在 **runner 装配期**(`runRpcMode` 之前)经 stdout
 *    推给 server 主进程的一次性自建 JSONL 帧(与 `ui_rpc_response` 同性质,属 pi-web 自建
 *    的 agent→server 帧,不触及外部 pi SDK)。server 端 `PiSession.handleRawLine` 识别后
 *    按会话缓存,供 completion provider 读取。
 */
import { z } from "zod";

/** 单个 slash 伪命令补全候选声明。`insertText` 缺省 = `"/" + name + " "`。 */
export const SlashCompletionDeclSchema = z.object({
  /** 命令名(无前导 "/"),如 "img-gen"。 */
  name: z.string().min(1),
  /** 候选描述(浮层副文本)。 */
  description: z.string().optional(),
  /** 选中后填入输入框的文本;缺省由消费方按 `"/" + name + " "` 推导。 */
  insertText: z.string().optional(),
});
export type SlashCompletionDecl = z.infer<typeof SlashCompletionDeclSchema>;

/** 装配期 agent→server 一次性帧:声明本会话的 slash 补全候选。 */
export const SlashCompletionsFrameSchema = z.object({
  type: z.literal("slash_completions"),
  items: z.array(SlashCompletionDeclSchema),
});
export type SlashCompletionsFrame = z.infer<typeof SlashCompletionsFrameSchema>;

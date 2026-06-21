/**
 * pi-web 传输层 — 触发符补全(completion-provider-framework)DTO schema。
 *
 *   GET /sessions/:id/completion/triggers        → TriggersResponse
 *   GET /sessions/:id/completion?trigger=&q=      → CompletionResponse
 *
 * 仅定义跨前后端共享的线协议形状(候选项 / 响应 / 活跃触发符);服务端 provider
 * 契约(含函数的 CompletionProvider/Ctx)是服务端内部类型,不在协议层。
 */
import { z } from "zod";

/** 触发符 token 提取规则名(前端按名选择实现)。 */
export const CompletionExtractRuleSchema = z.enum(["wordTail", "lineStart"]);
export type CompletionExtractRule = z.infer<typeof CompletionExtractRuleSchema>;

/** 单个补全候选项。`insertText` 缺省时由前端按 token 文法序列化。 */
export const CompletionItemSchema = z.object({
  providerId: z.string(),
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  insertText: z.string().optional(),
  score: z.number().optional(),
  sortText: z.string().optional(),
});
export type CompletionItem = z.infer<typeof CompletionItemSchema>;

/** 候选分组摘要(按 kind),供前端分区渲染。 */
export const CompletionGroupSchema = z.object({
  kind: z.string(),
  count: z.number(),
});
export type CompletionGroup = z.infer<typeof CompletionGroupSchema>;

/** 候选查询响应:已排序/去重/截断的候选 + 分组摘要。 */
export const CompletionResponseSchema = z.object({
  items: z.array(CompletionItemSchema),
  groups: z.array(CompletionGroupSchema),
});
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;

/** 单个活跃触发符及其提取规则。 */
export const CompletionTriggerSpecSchema = z.object({
  trigger: z.string(),
  extract: CompletionExtractRuleSchema,
});
export type CompletionTriggerSpec = z.infer<
  typeof CompletionTriggerSpecSchema
>;

/** 活跃触发符响应:所有已注册 provider 触发符的并集 + 提取规则。 */
export const CompletionTriggersResponseSchema = z.object({
  triggers: z.array(CompletionTriggerSpecSchema),
});
export type CompletionTriggersResponse = z.infer<
  typeof CompletionTriggersResponseSchema
>;

/**
 * web-ext 契约 — 统一命令层(unified-command-result-layer)的 payload 形状。
 *
 * 复用 Tier3 ui-rpc 传输:命令执行经 `point="command"`、`action="execute"`,payload 为
 * CommandExecutePayload;结果经 `control:"ui-rpc"` 的 response.result(CommandResult)回流。
 * ctx.ui.custom 经 `point="custom"` 携带 CustomUiPayload(声明式组件描述,替代不可序列化的工厂)。
 *
 * 这些 schema 在消费侧细化 ui-rpc 的 unknown payload/result,**不改** UiRpc* 结构本身(向后兼容)。
 */
import { z } from "zod";

/** point=command / action=execute 的请求载荷。 */
export const CommandExecutePayloadSchema = z.object({
  /** 命令名(不含前导 `/`),如 "plugin"。 */
  name: z.string().min(1),
  /** 命令名之后的原始参数串(如 "install local:/x"),由服务端解析。 */
  argv: z.string().optional(),
});
export type CommandExecutePayload = z.infer<typeof CommandExecutePayloadSchema>;

/** host 命令结果(ui-rpc response.result 的一种形状);effect 数据驱动 UI 更新意图。 */
export const CommandResultSchema = z.object({
  command: z.string(),
  /**
   * UI 渲染意图(数据驱动,不含组件):
   * - panel-refresh / open-panel:打开并刷新管理面板(/plugin)
   * - clear-transcript:清空聊天消息视图(/clear,与 agent 上下文清空一致)
   * - notify:仅通知文案;none:无 UI 副作用
   */
  effect: z
    .enum(["panel-refresh", "notify", "open-panel", "clear-transcript", "none"])
    .optional(),
  message: z.string().optional(),
  /** 附带数据(如刷新用的列表快照)。 */
  data: z.unknown().optional(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;

/** point=custom 的渲染描述(声明式:注册名 + props)。 */
export const CustomUiPayloadSchema = z.object({
  /** 前端注册表中的组件名。 */
  component: z.string().min(1),
  props: z.unknown().optional(),
});
export type CustomUiPayload = z.infer<typeof CustomUiPayloadSchema>;

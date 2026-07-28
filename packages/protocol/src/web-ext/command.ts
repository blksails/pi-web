/**
 * web-ext 契约 — 统一命令层(unified-command-result-layer)的 payload 形状。
 *
 * 复用 Tier3 ui-rpc 传输:命令执行经 `point="command"`、`action="execute"`,payload 为
 * CommandExecutePayload;结果经 `control:"ui-rpc"` 的 response.result(CommandResult)回流。
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
  /**
   * `data` 应渲染成哪种 data part(spec publish-host-command,任务 1.2)。
   *
   * 缺省时消费侧按**命令名**查 `BuiltinCommandSpec.resultDataPart` —— 那意味着一个命令
   * 只能有一种结果卡片。`/agent` 的 install 与 publish 结果形状完全不同,故加此字段让
   * **服务端逐次指定**,优先于按命令名查表。
   *
   * ★ 安全边界:本字段**只允许服务端 handler 写入**(它们是第一方代码),
   *   **不得**接到任何用户可控的数据上 —— 否则等于让用户指定渲染组件。
   *   消费侧对未知取值不匹配任何渲染器 → 静默不渲染(fail-soft),不构成注入面。
   */
  dataPart: z.string().optional(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;

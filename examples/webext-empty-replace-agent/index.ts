/**
 * webext-empty-replace-agent — Tier 5 纯声明示例(空态 replace 合并)。
 *
 * 与 webext-empty-config-agent 同源,但 mergeCommands 用 "replace":空态仅展示配置建议项,
 * 不展示 agent slash 命令。演示声明式配置完全接管空态建议。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-empty-replace-agent. Your empty-state suggestions fully replace the agent commands via a declarative .pi/web manifest.",
});

/**
 * webext-empty-config-agent — Tier 5 纯声明示例(空态可配置)。
 *
 * agent 本体最小;空态(EmptyState)标题/副标题/建议项完全靠 `.pi/web/manifest.json`
 * 内联的声明式 `config.empty` 配置,不携带任何 bundle。mergeCommands 用 "prepend":
 * 配置建议项排在 agent slash 命令之前。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-empty-config-agent. Your empty-state title/subtitle/suggestions come from a declarative .pi/web manifest (no code).",
});

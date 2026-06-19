/**
 * webext-declarative-agent — Tier 5 纯声明示例(零代码 UI 扩展)。
 *
 * agent 本体最小;UI 定制完全靠 `.pi/web/manifest.json` 内联的声明式 config
 * (theme token + layout),不携带任何 bundle —— 演示零加载路径。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-declarative-agent. Your UI theme/layout come from a declarative .pi/web manifest (no code).",
});

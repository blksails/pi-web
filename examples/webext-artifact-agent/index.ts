/**
 * webext-artifact-agent — Tier 4 artifact 隔离表面示例。
 * `.pi/web` 声明 artifact 入口;宿主在独立 origin sandbox iframe 中渲染(凡 LLM 输出走此)。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt: "You are webext-artifact-agent. Rich/LLM output renders in a sandboxed artifact iframe.",
});

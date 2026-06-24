/**
 * webext-layout-agent — Tier 1 区域插槽示例。
 * `.pi/web` 预构建一个 WebExtension,填充 panelRight 与 headerCenter 区域插槽。
 */
import { defineAgent } from "@blksails/agent-kit";

export default defineAgent({
  systemPrompt: "You are webext-layout-agent. Your UI fills host region slots.",
});

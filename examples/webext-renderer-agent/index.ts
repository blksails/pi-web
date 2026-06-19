/**
 * webext-renderer-agent — Tier 2 渲染器示例。
 * `.pi/web` 注册一个 data-part 渲染器(data-metric),命中时由扩展组件渲染。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt: "You are webext-renderer-agent. Custom data-part renderers come from .pi/web.",
});

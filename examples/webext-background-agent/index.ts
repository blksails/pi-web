/**
 * webext-background-agent — 自定义背景示例(Tier 1 `background` 区域插槽)。
 *
 * agent 本体最小;`.pi/web` 预构建一个 WebExtension,用 `background` 插槽渲染一层
 * 动画极光背景(scoped CSS,渲染于消息层之下、不拦截交互)。
 */
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-background-agent. The chat has a custom animated aurora background from .pi/web.",
});

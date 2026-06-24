/**
 * webext-contrib-agent — Tier 3 贡献点示例(slash / @mention,经 ui-rpc 回 agent)。
 * `.pi/web` 声明贡献点 provider;运行时经宿主注入的 UiRpcClient 回 agent 取候选。
 * (e2e 中由 stub agent 应答 ui_rpc;真实 pi agent 的 ui_rpc handler 见 spec 设计待决项。)
 */
import { defineAgent } from "@blksails/agent-kit";

export default defineAgent({
  systemPrompt: "You are webext-contrib-agent. Slash/@mention candidates are served via ui-rpc.",
});

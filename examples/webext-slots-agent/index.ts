/**
 * webext-slots-agent — Tier1 协议保留插槽全集补齐验收 fixture(spec R6)。
 * `.pi/web` 声明全部 12 个协议保留插槽,验证宿主 `pi-chat.tsx` 已为各插槽接线 SlotHost。
 */
import { defineAgent } from "@blksails/agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-slots-agent. Your UI fills all reserved host region slots.",
});

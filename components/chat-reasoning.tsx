"use client";

/**
 * ChatReasoning — 把 pi 的 reasoning part 适配到 AI Elements 风格的 Reasoning 组合。
 *
 * 经 <PiChat components={{ Reasoning: ChatReasoning }}>(components.Reasoning)注入,
 * 整体替换默认 PiReasoning 外观:流式自动展开/收起 + "Thought for Ns"。
 * 保留 data-pi-reasoning / data-pi-reasoning-content 以兼容既有选择器与 e2e。
 *
 * 展示门控:读 settings.showReasoning（默认 false）。关闭时整块不渲染——
 * 默认不展示思考内容；用户可在 /settings 开启「显示思考过程」。
 */
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import type { PiReasoningProps } from "@blksails/pi-web-ui";
import { useShowReasoningSetting } from "@blksails/pi-web-ui";

export function ChatReasoning({
  part,
}: PiReasoningProps): React.JSX.Element | null {
  const showReasoning = useShowReasoningSetting("/api");
  if (!showReasoning) return null;

  const isStreaming = part.state === "streaming";
  return (
    <Reasoning isStreaming={isStreaming} data-pi-reasoning>
      <ReasoningTrigger />
      <ReasoningContent data-pi-reasoning-content>{part.text}</ReasoningContent>
    </Reasoning>
  );
}

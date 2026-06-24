"use client";

/**
 * ChatReasoning — 把 pi 的 reasoning part 适配到 AI Elements 风格的 Reasoning 组合。
 *
 * 经 <PiChat components={{ Reasoning: ChatReasoning }}>(components.Reasoning)注入,
 * 整体替换默认 PiReasoning 外观:流式自动展开/收起 + "Thought for Ns"。
 * 保留 data-pi-reasoning / data-pi-reasoning-content 以兼容既有选择器与 e2e。
 */
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import type { PiReasoningProps } from "@blksails/pi-web-ui";

export function ChatReasoning({ part }: PiReasoningProps): React.JSX.Element {
  const isStreaming = part.state === "streaming";
  return (
    <Reasoning isStreaming={isStreaming} data-pi-reasoning>
      <ReasoningTrigger />
      <ReasoningContent data-pi-reasoning-content>{part.text}</ReasoningContent>
    </Reasoning>
  );
}

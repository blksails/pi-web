/**
 * Conversation — 无状态会话滚动容器 + "回到底部"入口。
 *
 * 渲染一个可滚动视口承载 children(消息列表),并经 `useAutoScroll` 实现:
 *  - 贴底时新内容/流式增量自动滚动到底 (Req 7.1)。
 *  - 离底时停止自动滚动并显示带 `aria-label` 的"回到底部"按钮 (Req 7.2)。
 *  - 点击按钮平滑滚动到最新并恢复自动滚动 (Req 7.3)。
 *
 * 主题经 shadcn CSS 变量(cn + 既有 Button 基元),无硬编码颜色 (Req 11.5);
 * 按钮带 `aria-label` 以满足无障碍 (Req 11.4)。
 */
import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";
import { useAutoScroll } from "./use-auto-scroll.js";

export interface ConversationProps {
  readonly children?: React.ReactNode;
  /** "回到底部"按钮的无障碍标签,默认中文"回到底部"。 */
  readonly scrollToBottomLabel?: string;
  /** 贴底判定容差(像素),透传给 useAutoScroll。 */
  readonly threshold?: number;
  readonly className?: string;
  /** 视口区域的额外 className。 */
  readonly viewportClassName?: string;
}

export function Conversation({
  children,
  scrollToBottomLabel = "回到底部",
  threshold,
  className,
  viewportClassName,
}: ConversationProps): React.JSX.Element {
  const { ref, atBottom, scrollToBottom } = useAutoScroll(
    children,
    threshold === undefined ? undefined : { threshold },
  );

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      data-pi-conversation
    >
      <div
        ref={ref}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          viewportClassName,
        )}
        data-pi-conversation-viewport
        role="log"
        aria-live="polite"
      >
        {children}
      </div>

      {!atBottom ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
          data-pi-conversation-scroll-anchor
        >
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="pointer-events-auto rounded-full shadow-md"
            aria-label={scrollToBottomLabel}
            onClick={scrollToBottom}
            data-pi-conversation-to-bottom
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

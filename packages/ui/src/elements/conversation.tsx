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
import { useI18n } from "../i18n/index.js";
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
  /**
   * 在视口底边叠加一道「背景色 → 透明」的渐隐遮罩,让滚动中的消息在贴近底部
   * (输入框上沿)时优雅淡出,避免末条消息硬贴输入框。默认 false(不改变既有用法)。
   * 遮罩为 `pointer-events-none` 且渲染于「回到底部」按钮之下,不影响交互与按钮可见性。
   */
  readonly fadeBottom?: boolean;
}

export function Conversation({
  children,
  scrollToBottomLabel,
  threshold,
  className,
  viewportClassName,
  fadeBottom = false,
}: ConversationProps): React.JSX.Element {
  const t = useI18n();
  const scrollLabel = scrollToBottomLabel ?? t("conversation.scrollToBottom");
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
          "pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto pr-4",
          viewportClassName,
        )}
        data-pi-conversation-viewport
        role="log"
        aria-live="polite"
      >
        {children}
      </div>

      {/* 底边渐隐遮罩:置于视口之后、按钮之前 → 盖住滚动消息底缘但不遮挡"回到底部"按钮。 */}
      {fadeBottom ? (
        <div
          aria-hidden="true"
          data-pi-conversation-fade
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[hsl(var(--background))] to-transparent"
        />
      ) : null}

      {!atBottom ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-end pr-3"
          data-pi-conversation-scroll-anchor
        >
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="pointer-events-auto rounded-full shadow-md"
            aria-label={scrollLabel}
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

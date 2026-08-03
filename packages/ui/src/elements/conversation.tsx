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
import { ArrowDown, LocateFixed } from "lucide-react";
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
  /** 输入 dock 高度；浮动控件据此停在输入框右上方。 */
  readonly controlsBottom?: number;
  /** 与输入框同一内容宽度类，使控件右缘对齐输入框边框。 */
  readonly controlsClassName?: string;
  /** 用户输入历史；两项起显示定位入口。 */
  readonly userMessageNavigation?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
}

export function Conversation({
  children,
  scrollToBottomLabel,
  threshold,
  className,
  viewportClassName,
  fadeBottom = false,
  controlsBottom = 8,
  controlsClassName,
  userMessageNavigation = [],
}: ConversationProps): React.JSX.Element {
  const t = useI18n();
  const scrollLabel = scrollToBottomLabel ?? t("conversation.scrollToBottom");
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  const [activeMessageId, setActiveMessageId] = React.useState<string>();
  const navigationRef = React.useRef<HTMLDivElement>(null);
  const { ref, atBottom, scrollToBottom } = useAutoScroll(
    children,
    threshold === undefined ? undefined : { threshold },
  );
  const hasNavigation = userMessageNavigation.length >= 2;

  React.useEffect(() => {
    if (!navigationOpen) return undefined;
    const close = (event: MouseEvent): void => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        setNavigationOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [navigationOpen]);

  const navigateToMessage = React.useCallback((id: string): void => {
    const target = [...(ref.current?.querySelectorAll<HTMLElement>(
      "[data-pi-message-id]",
    ) ?? [])].find((element) => element.dataset.piMessageId === id);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    setActiveMessageId(id);
    setNavigationOpen(false);
  }, [ref]);

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      data-pi-conversation
    >
      <div
        ref={ref}
        className={cn(
          "pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto px-2",
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

      {!atBottom || hasNavigation ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-20"
          style={{ bottom: controlsBottom }}
          data-pi-conversation-scroll-anchor
        >
          <div className={cn("flex justify-end px-3", controlsClassName)}>
            <div className="flex flex-col items-end gap-1.5">
              {hasNavigation ? (
                <div className="group relative" ref={navigationRef}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="pointer-events-auto h-8 w-8 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md"
                    aria-label="定位用户输入"
                    aria-haspopup="menu"
                    aria-expanded={navigationOpen}
                    onClick={() => setNavigationOpen((open) => !open)}
                    data-pi-conversation-user-navigation
                  >
                    <LocateFixed className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-2 py-1 text-[11px] text-[hsl(var(--popover-foreground))] opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    定位用户输入
                  </span>
                  {navigationOpen ? (
                    <div
                      role="menu"
                      aria-label="用户输入历史"
                      className="pointer-events-auto absolute bottom-0 right-10 z-30 flex max-h-64 w-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1.5 text-[hsl(var(--popover-foreground))] shadow-xl"
                    >
                      {userMessageNavigation.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          title={item.label}
                          className={cn(
                            "flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-[hsl(var(--accent))]",
                            activeMessageId === item.id
                              ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                              : "text-[hsl(var(--muted-foreground))]",
                          )}
                          onClick={() => navigateToMessage(item.id)}
                        >
                          <span className="w-5 shrink-0 text-right tabular-nums opacity-60">
                            {index + 1}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!atBottom ? (
                <div className="group relative">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="pointer-events-auto h-8 w-8 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md"
                    aria-label={scrollLabel}
                    onClick={scrollToBottom}
                    data-pi-conversation-to-bottom
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-2 py-1 text-[11px] text-[hsl(var(--popover-foreground))] opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    {scrollLabel}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

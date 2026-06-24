/**
 * Suggestions — 建议气泡列表(Req 10.1/10.2/10.3、11.4)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅接收 `items`(Suggestion[],来自 useSuggestions)
 * 展示为气泡(button)列表(Req 10.1)。点击某项按其 `mode` 分发:`mode==="fill"` 调
 * `onFill(value)`(填入输入框),`mode==="send"` 调 `onSend(value)`(直接发送)(Req 10.2)。
 * `items` 为空时返回 null 不渲染建议区域(Req 10.3)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色;无障碍:每个气泡为可访问 <button>(Req 11.4)。
 */
import * as React from "react";
import type { Suggestion } from "@blksails/react";
import { cn } from "../lib/cn.js";

export interface SuggestionsProps {
  /** 建议项列表(来自 useSuggestions);空时不渲染(Req 10.3)。 */
  readonly items: ReadonlyArray<Suggestion>;
  /** mode==="fill" 的项被点击时回传其 value(填入输入框)。 */
  readonly onFill: (value: string) => void;
  /** mode==="send" 的项被点击时回传其 value(直接发送)。 */
  readonly onSend: (value: string) => void;
  /**
   * 布局变体:
   *  - "bubbles"(默认):横向自动换行的小圆角气泡(会话进行中的紧凑建议)。
   *  - "grid":2 列大圆角卡片网格(空态欢迎页的 starter 提示)。
   */
  readonly layout?: "bubbles" | "grid";
  readonly className?: string;
}

export function Suggestions({
  items,
  onFill,
  onSend,
  layout = "bubbles",
  className,
}: SuggestionsProps): React.JSX.Element | null {
  // 无建议项 → 不渲染建议区域(Req 10.3)。
  if (items.length === 0) {
    return null;
  }

  const dispatch = (item: Suggestion): void => {
    // 按 mode 分发(Req 10.2)。
    if (item.mode === "send") {
      onSend(item.value);
    } else {
      onFill(item.value);
    }
  };

  if (layout === "grid") {
    return (
      <div
        className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}
        data-pi-suggestions
        data-pi-suggestions-layout="grid"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => dispatch(item)}
            className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-5 py-4 text-center text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-pi-suggestions
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dispatch(item)}
          className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-1 text-sm text-[hsl(var(--secondary-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

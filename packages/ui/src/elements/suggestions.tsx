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
import type { Suggestion } from "@pi-web/react";
import { cn } from "../lib/cn.js";

export interface SuggestionsProps {
  /** 建议项列表(来自 useSuggestions);空时不渲染(Req 10.3)。 */
  readonly items: ReadonlyArray<Suggestion>;
  /** mode==="fill" 的项被点击时回传其 value(填入输入框)。 */
  readonly onFill: (value: string) => void;
  /** mode==="send" 的项被点击时回传其 value(直接发送)。 */
  readonly onSend: (value: string) => void;
  readonly className?: string;
}

export function Suggestions({
  items,
  onFill,
  onSend,
  className,
}: SuggestionsProps): React.JSX.Element | null {
  // 无建议项 → 不渲染建议区域(Req 10.3)。
  if (items.length === 0) {
    return null;
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
          onClick={() => {
            // 按 mode 分发(Req 10.2)。
            if (item.mode === "send") {
              onSend(item.value);
            } else {
              onFill(item.value);
            }
          }}
          className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-1 text-sm text-[hsl(var(--secondary-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

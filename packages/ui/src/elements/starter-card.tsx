/**
 * StarterCard — 空态欢迎页的单个起始建议卡(pi-chat-customization 任务 2.3)。
 *
 * 默认样式与既有 Suggestions grid 卡片一致(Req 1.1);可由 components.StarterCard 覆盖
 * 以定制单卡外观(Req 5.1/5.2)。点击按 mode 分发(fill/send)。
 */
import * as React from "react";
import type { Suggestion } from "@blksails/react";
import { cn } from "../lib/cn.js";

export interface StarterCardProps {
  readonly item: Suggestion;
  readonly onFill: (value: string) => void;
  readonly onSend: (value: string) => void;
  readonly className?: string;
}

export function StarterCard({
  item,
  onFill,
  onSend,
  className,
}: StarterCardProps): React.JSX.Element {
  const onClick = (): void => {
    if (item.mode === "send") onSend(item.value);
    else onFill(item.value);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-5 py-4 text-center text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className,
      )}
      data-pi-starter-card
    >
      {item.label}
    </button>
  );
}

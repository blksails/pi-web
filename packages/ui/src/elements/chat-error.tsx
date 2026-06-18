/**
 * ChatError — 无状态错误提示元件(Req 1.2/2.4/4.2)。
 *
 * 无状态展示元件:不接 pi/useChat 数据逻辑,仅接收 `message` 展示,由装配层(PiChat)
 * 接线。`message` 为空(undefined 或空串)→ 返回 null 不渲染(Req 4.2,如中止/无错误态);
 * 非空 → 以 shadcn destructive CSS 变量配色渲染错误提示块,无硬编码颜色,带 `role="alert"`
 * 立即播报,展示该真实 `message` 文本(Req 1.2/2.4,不替换为无意义占位)。
 *
 * 风格、配色对照 `elements/notifications.tsx` 的 error toast 分支(destructive 变量、role、cn)。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";

export interface ChatErrorProps {
  /** 错误信息文本(来自 useChat 的 error.message);为空则不渲染(Req 4.2)。 */
  readonly message: string | undefined;
  readonly className?: string;
}

export function ChatError({
  message,
  className,
}: ChatErrorProps): React.JSX.Element | null {
  // 空 message(undefined 或空串)→ 不渲染(Req 4.2:中止/无错误态)。
  if (message === undefined || message === "") {
    return null;
  }

  return (
    <div
      role="alert"
      data-pi-chat-error
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm shadow-md",
        "border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
        className,
      )}
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
    </div>
  );
}

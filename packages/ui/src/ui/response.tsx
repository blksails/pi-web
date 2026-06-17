/**
 * Response — AI Elements 等价的 Markdown 渲染原语(经 streamdown 安全渲染流式 Markdown)。
 *
 * 替代 AI Elements `<Response>`:streamdown 同样是其底座,直接装配以避免网络拉取 registry。
 */
import * as React from "react";
import { Streamdown } from "streamdown";
import { cn } from "../lib/cn.js";

export interface ResponseProps {
  readonly children: string;
  readonly className?: string;
}

export const Response = React.memo(function Response({
  children,
  className,
}: ResponseProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none text-[hsl(var(--foreground))]",
        className,
      )}
      data-pi-response
    >
      <Streamdown>{children}</Streamdown>
    </div>
  );
});

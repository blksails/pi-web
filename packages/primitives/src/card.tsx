/**
 * Card — shadcn 风格卡片原语,供工具卡/统计等复用。
 */
import * as React from "react";
import { cn } from "./cn.js";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-sm",
        className,
      )}
      {...props}
    />
  );
});

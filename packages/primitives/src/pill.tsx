/**
 * Pill — 统一的紧凑圆角按钮，供 pi-web 基座与 Agent WebExtension 共用。
 *
 * 仅在 Button 之上固定 pill 的尺寸与 outline 外观；业务图标、文案与交互仍由调用方提供。
 */
import * as React from "react";
import { Button, type ButtonProps } from "./button.js";
import { cn } from "./cn.js";

export interface PillProps extends Omit<ButtonProps, "size" | "variant"> {
  /** 选中态外观；调用方仍可用 aria-pressed 表达交互状态。 */
  readonly active?: boolean;
}

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  function Pill({ active = false, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="outline"
        size="sm"
        className={cn(
          "h-8 gap-1.5 rounded-full px-3 text-xs",
          active && "border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Popover — shadcn/Radix Popover 封装原语(CSS 变量主题,无硬编码颜色)。
 *
 * 与 ui/select.tsx 同风格:Portal + Content,主题走 --popover/--border/--radius。
 * Combobox(可搜索下拉)即由 Popover + Command 组合(见 ui/command.tsx)。
 */
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "./cn.js";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className, align = "start", sideOffset = 4, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover,var(--background)))] text-[hsl(var(--popover-foreground,var(--foreground)))] shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

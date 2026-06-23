/**
 * Command — shadcn/cmdk 封装原语(可搜索命令面板,Combobox 的列表内核)。
 *
 * 与 ui/select.tsx 同风格(CSS 变量主题、cn、forwardRef)。配合 ui/popover.tsx 组成
 * shadcn 推荐的 Combobox(可搜索下拉)。cmdk 内建按 item `value` 模糊过滤、键盘导航、
 * 分组、空态;item role=option、list role=listbox。
 */
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "../lib/cn.js";

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-[var(--radius)] bg-transparent text-[hsl(var(--popover-foreground,var(--foreground)))]",
        className,
      )}
      {...props}
    />
  );
});

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    <div
      className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3"
      cmdk-input-wrapper=""
    >
      <Search className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      <CommandPrimitive.Input
        ref={ref}
        className={cn(
          "flex h-9 w-full bg-transparent py-2 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn("max-h-72 overflow-y-auto overflow-x-hidden py-1", className)}
      {...props}
    />
  );
});

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(function CommandEmpty({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Empty
      ref={ref}
      className={cn(
        "px-3 py-4 text-center text-sm text-[hsl(var(--muted-foreground))]",
        className,
      )}
      {...props}
    />
  );
});

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      className={cn(
        "overflow-hidden py-1 text-[hsl(var(--foreground))] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[hsl(var(--muted-foreground))]",
        className,
      )}
      {...props}
    />
  );
});

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-left text-sm text-[hsl(var(--foreground))] outline-none transition-colors data-[selected=true]:bg-[hsl(var(--accent))] data-[selected=true]:text-[hsl(var(--accent-foreground))] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(function CommandSeparator({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Separator
      ref={ref}
      className={cn("my-1 h-px bg-[hsl(var(--border))]", className)}
      {...props}
    />
  );
});

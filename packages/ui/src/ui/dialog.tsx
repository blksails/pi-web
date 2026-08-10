/**
 * Dialog — shadcn/Radix Dialog 封装。
 * 有 chat 主列时，遮罩与内容在 chat 侧居中（避开左侧会话栏与右侧 Pane）。
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useChatColumnBox } from "./chat-centered-overlay.js";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, style, ...props }, ref) {
  const box = useChatColumnBox();
  const boxStyle: React.CSSProperties =
    box !== null
      ? {
          position: "fixed",
          top: box.top,
          left: box.left,
          width: Math.max(0, box.width),
          height: Math.max(0, box.height),
          right: "auto",
          bottom: "auto",
        }
      : { position: "fixed", inset: 0 };

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out",
        // 无 chat 列时仍用 inset-0 类；有列时用 inline style 覆盖
        box === null && "fixed inset-0",
        className,
      )}
      style={{ ...boxStyle, ...style }}
      {...props}
    />
  );
});

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, style, ...props }, ref) {
  const box = useChatColumnBox();
  const centerStyle: React.CSSProperties =
    box !== null
      ? {
          position: "fixed",
          left: box.left + box.width / 2,
          top: box.top + box.height / 2,
          transform: "translate(-50%, -50%)",
        }
      : {
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        };

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "z-50 grid w-full max-w-lg gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 text-[hsl(var(--foreground))] shadow-lg",
          // 有 chat 列时不用 tailwind 的 left-1/2 top-1/2（改用 box 中心）
          box === null && "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          className,
        )}
        style={{ ...centerStyle, ...style }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props} />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold leading-none", className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-[hsl(var(--muted-foreground))]", className)}
      {...props}
    />
  );
});

/**
 * Notifications — 扩展通知浮层(toasts)(Req 1.1/1.2/1.3/1.4/1.5/1.6、8.1/8.2)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅接收 `notifications` 列表堆叠展示(以 `id` 作 key,
 * Req 1.5),由装配层(PiChat)接线。按 `notifyType`(info/warning/error)以 shadcn CSS
 * 变量配色(Req 1.2),无硬编码颜色。每条挂载后 `autoDismissMs`(默认 5000)毫秒自动消失
 * (Req 1.3),`autoDismissMs <= 0` 则关闭自动消失;每条带关闭按钮支持手动关闭(Req 1.4);
 * 自动/手动均回调 `onDismiss(id)`。`notifications` 为空时返回 null 不渲染浮层区域(Req 1.6)。
 *
 * 自动消失定时按每条 toast 抽成子组件 `Toast`,以 `useEffect` 正确管理各自 timer 生命周期
 * (卸载/重渲染清理)。无障碍(Req 8.2):error → `role="alert"`,info/warning → `role="status"`;
 * 关闭按钮带 `aria-label`。
 */
import * as React from "react";
import { X } from "lucide-react";
import type { ExtensionNotification } from "@blksails/react";
import { cn } from "../lib/cn.js";

export interface NotificationsProps {
  /** 通知列表(来自 useExtensionUI);空时不渲染(Req 1.6)。 */
  readonly notifications: readonly ExtensionNotification[];
  /** 通知被关闭(手动或自动消失)时回传其 id。 */
  readonly onDismiss: (id: string) => void;
  /** 自动消失时长(毫秒),默认 5000;<=0 关闭自动消失。 */
  readonly autoDismissMs?: number;
  readonly className?: string;
}

const DEFAULT_AUTO_DISMISS_MS = 5000;

/** 按通知级别选择展示样式(仅用 shadcn CSS 变量,无硬编码颜色)。 */
function toastClassName(notifyType: ExtensionNotification["notifyType"]): string {
  switch (notifyType) {
    case "error":
      return "border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]";
    case "warning":
      return "border-[hsl(var(--border))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]";
    case "info":
    default:
      return "border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]";
  }
}

interface ToastProps {
  readonly notification: ExtensionNotification;
  readonly onDismiss: (id: string) => void;
  readonly autoDismissMs: number;
}

function Toast({
  notification,
  onDismiss,
  autoDismissMs,
}: ToastProps): React.JSX.Element {
  const { id, message, notifyType } = notification;

  // 挂载后定时自动消失;autoDismissMs<=0 关闭;卸载/依赖变化清理 timer(Req 1.3)。
  React.useEffect(() => {
    if (autoDismissMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      onDismiss(id);
    }, autoDismissMs);
    return () => {
      clearTimeout(timer);
    };
  }, [id, autoDismissMs, onDismiss]);

  // 无障碍:error 需立即播报 → alert;info/warning → status(Req 8.2)。
  const role = notifyType === "error" ? "alert" : "status";

  return (
    <div
      role={role}
      data-pi-notification
      data-pi-notify-type={notifyType}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm shadow-md",
        toastClassName(notifyType),
      )}
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        data-pi-notification-dismiss
        onClick={() => onDismiss(id)}
        className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Notifications({
  notifications,
  onDismiss,
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
  className,
}: NotificationsProps): React.JSX.Element | null {
  // 无通知 → 不渲染浮层区域(Req 1.6)。
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-pi-notifications
    >
      {notifications.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
          autoDismissMs={autoDismissMs}
        />
      ))}
    </div>
  );
}

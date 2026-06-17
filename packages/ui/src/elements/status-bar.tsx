/**
 * StatusBar — 扩展键控状态条(Req 2.1/2.4/2.5、8.1)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅接收 `statuses`(键 → 状态文本映射,来自 useExtensionUI)
 * 并列展示为一行小 pill(Req 2.1/2.4)。键序稳定:按 `Object.keys(statuses).sort()` 渲染,
 * 避免映射插入序波动导致 DOM 抖动。`statuses` 为空对象(无键)时返回 null 不渲染状态区(Req 2.5)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色;无障碍(Req 8.1):容器 `role="status"` +
 * `aria-live="polite"`,使状态变更以非打断方式播报。data 属性:容器 `data-pi-status-bar`,
 * 每项 `data-pi-status` + `data-status-key`(展示文本为对应 value)。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";

export interface StatusBarProps {
  /** 键控状态映射(来自 useExtensionUI);空对象时不渲染(Req 2.5)。 */
  readonly statuses: Readonly<Record<string, string>>;
  readonly className?: string;
}

export function StatusBar({
  statuses,
  className,
}: StatusBarProps): React.JSX.Element | null {
  // 按键排序以保证 DOM 顺序稳定(Req 2.4)。
  const keys = Object.keys(statuses).sort();

  // 无任何有效键控状态 → 不渲染状态区(Req 2.5)。
  if (keys.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-pi-status-bar
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {keys.map((key) => (
        <span
          key={key}
          data-pi-status
          data-status-key={key}
          className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs text-[hsl(var(--muted-foreground))]"
        >
          {statuses[key]}
        </span>
      ))}
    </div>
  );
}

/**
 * Widgets — 扩展 widget 区元件(Req 3.1/3.2/3.5、8.1)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅接收数组形态的 `widgets`(每项 key 内联)与目标
 * `placement`,由装配层(PiChat)把 hook 的 `Record<string, ExtensionWidget>` 派生为数组传入。
 * 仅渲染 `widget.placement === placement` 的项(按 placement 过滤,Req 3.2),并把每项的
 * `lines` 逐行渲染(Req 3.1)。过滤后为空(或 widgets 为空)返回 null 不渲染 widget 区(Req 3.5)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色(Req 8.1)。data 属性:容器 `data-pi-widgets`
 * + `data-pi-widget-placement`;每项 `data-pi-widget` + `data-widget-key`;每行 `data-pi-widget-line`。
 *
 * 注:本元件的 props 用数组形态(key 内联),不依赖 react 包的 `Record` 形态,故类型在本文件内联定义。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";

/** 单个 widget 的最小展示形状(数组形态,key 内联;展示元件不依赖 react 包的 Record 形态)。 */
export interface WidgetItem {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveEditor" | "belowEditor";
}

export interface WidgetsProps {
  /** widget 列表(由装配层从 Record 派生为数组);仅渲染匹配 placement 的项。 */
  readonly widgets: readonly WidgetItem[];
  /** 目标放置位:仅渲染该 placement 的 widget(Req 3.2)。 */
  readonly placement: "aboveEditor" | "belowEditor";
  readonly className?: string;
}

export function Widgets({
  widgets,
  placement,
  className,
}: WidgetsProps): React.JSX.Element | null {
  // 按 placement 过滤(Req 3.2)。
  const matched = widgets.filter((widget) => widget.placement === placement);

  // 过滤后为空(或 widgets 为空)→ 不渲染 widget 区(Req 3.5)。
  if (matched.length === 0) {
    return null;
  }

  return (
    <div
      data-pi-widgets
      data-pi-widget-placement={placement}
      className={cn("flex flex-col gap-1", className)}
    >
      {matched.map((widget) => (
        <div
          key={widget.key}
          data-pi-widget
          data-widget-key={widget.key}
          className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]"
        >
          {widget.lines.map((line, index) => (
            <div
              key={index}
              data-pi-widget-line
              className="whitespace-pre-wrap break-words font-mono"
            >
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

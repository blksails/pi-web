/**
 * Sources — 可折叠引用来源块(Req 9.3/9.4)。
 *
 * 无状态展示元件:不接 pi 数据逻辑,仅接收 `sources` 数组展示,由装配/注册层(Req 9 的
 * data-part 渲染器注册归装配任务 4.1)接线。可折叠头部显示来源数 + 展开/折叠箭头,默认
 * 折叠(Req 9.3);展开时列出来源(`title` 文本 + `url` 渲染为 <a> 链接)。`sources` 为空
 * 或缺省时返回 null 不渲染(Req 9.4)。
 *
 * 折叠开合属本地 UI 态,由组件内部 `useState` 管理(此为允许的局部 UI 态,"无状态"指不
 * 接 pi 数据)。主题经 shadcn CSS 变量(cn),无硬编码颜色;无障碍:展开按钮带
 * `aria-expanded` / `aria-controls`。
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn.js";

/** 单条引用来源的最小展示形状(展示元件不依赖 pi 协议)。 */
export interface Source {
  readonly id?: string;
  readonly title?: string;
  readonly url?: string;
}

export interface SourcesProps {
  /** 引用来源列表;空/缺省时不渲染(Req 9.4)。 */
  readonly sources?: readonly Source[];
  /** 初始是否展开,默认 false(折叠,Req 9.3)。 */
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

export function Sources({
  sources,
  defaultOpen = false,
  className,
}: SourcesProps): React.JSX.Element | null {
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const contentId = React.useId();

  // 无来源(空/缺省)→ 不渲染(Req 9.4)。
  if (sources === undefined || sources.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
        className,
      )}
      data-pi-sources
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        <span>Sources</span>
        <span className="ml-1 rounded-full bg-[hsl(var(--background))] px-1.5 text-xs">
          {sources.length}
        </span>
      </button>
      {open ? (
        <ul
          id={contentId}
          className="space-y-1 px-3 pb-3 text-sm"
          data-pi-sources-content
        >
          {sources.map((source, index) => {
            const key = source.id ?? source.url ?? `source-${index}`;
            const label = source.title ?? source.url ?? "Untitled source";
            return (
              <li key={key}>
                {source.url !== undefined ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[hsl(var(--primary))] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  >
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

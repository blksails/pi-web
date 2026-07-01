/**
 * PiQueuePanel — message-queue-ui 排队消息展示区。
 *
 * 纯 props 呈现组件(不引入数据源):由挂载方(PiChat)注入 `queue` 快照。渲染 steering(插话)与
 * follow-up(跟进)分组待投递条目及 pending 合计计数。队列为空(合计 0)时返回 null,不占布局。
 *
 * 稳定标记(供 e2e / 验收断言):容器 `data-pi-queue`、计数 `data-pi-queue-count`。
 * 样式复用补全浮层的贴边卡片风格(rounded / border / shadow)。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

export interface PiQueuePanelProps {
  /** steering / follow-up 待投递文本快照(通常来自 usePiControls().queue)。 */
  readonly queue: {
    readonly steering: readonly string[];
    readonly followUp: readonly string[];
  };
  /** 附加类名(可选,便于挂载方定位)。 */
  readonly className?: string;
}

interface QueueGroupProps {
  readonly kind: "steering" | "followUp";
  readonly label: string;
  readonly items: readonly string[];
}

function QueueGroup({ kind, label, items }: QueueGroupProps): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <li data-pi-queue-group={kind}>
      <div className="px-2 py-1 text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((text, i) => (
          <li
            // 队列快照仅字符串数组,无稳定条目 id;顺序稳定,index 作 key 可接受。
            key={`${kind}-${i}`}
            data-pi-queue-item={kind}
            className="truncate rounded-sm px-2 py-1 text-sm text-[hsl(var(--foreground))]"
            title={text}
          >
            {text}
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * 渲染当前排队消息。合计为 0 时不渲染任何可见结构(Req 2.3 / 2.4)。
 */
export function PiQueuePanel({
  queue,
  className,
}: PiQueuePanelProps): React.JSX.Element | null {
  const t = useI18n();
  const total = queue.steering.length + queue.followUp.length;
  if (total === 0) return null;
  return (
    <div
      data-pi-queue=""
      className={cn(
        "mb-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">
        <span>{t("chat.queue.title")}</span>
        <span
          data-pi-queue-count={String(total)}
          className="rounded-full bg-[hsl(var(--muted))] px-1.5 py-0.5 tabular-nums"
        >
          {total}
        </span>
      </div>
      <ul className="max-h-40 overflow-y-auto p-1">
        <QueueGroup
          kind="steering"
          label={t("chat.queue.steering")}
          items={queue.steering}
        />
        <QueueGroup
          kind="followUp"
          label={t("chat.queue.followUp")}
          items={queue.followUp}
        />
      </ul>
    </div>
  );
}

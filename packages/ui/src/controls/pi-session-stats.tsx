/**
 * PiSessionStats — 单行内敛会话用量条;展示 usePiControls.stats(用量/成本)。
 *
 * 设计:无边框、淡色、单行紧凑(窄屏可换行),贴近输入框时不喧宾夺主。
 * 保留 data-pi-session-stats / data-pi-stat 锚点与货币格式以稳定测试与 e2e。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import { cn } from "../lib/cn.js";

export interface PiSessionStatsProps {
  readonly controls: UsePiControlsResult;
  readonly className?: string;
}

function fmtCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function Item({
  label,
  stat,
  value,
}: {
  label: string;
  stat: string;
  value: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="opacity-60">{label}</span>
      <span
        data-pi-stat={stat}
        className="font-medium tabular-nums text-[hsl(var(--foreground))]"
      >
        {value}
      </span>
    </span>
  );
}

export function PiSessionStats({
  controls,
  className,
}: PiSessionStatsProps): React.JSX.Element {
  const stats = controls.stats;

  if (stats === undefined) {
    return (
      <div
        className={cn(
          "px-3 py-1 text-xs text-[hsl(var(--muted-foreground))]",
          className,
        )}
        data-pi-session-stats
      >
        No stats yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1 text-xs text-[hsl(var(--muted-foreground))]",
        className,
      )}
      data-pi-session-stats
    >
      <Item label="Messages" stat="messages" value={fmtNum(stats.totalMessages)} />
      <span aria-hidden className="opacity-30">·</span>
      <Item label="Tools" stat="toolCalls" value={fmtNum(stats.toolCalls)} />
      <span aria-hidden className="opacity-30">·</span>
      <Item label="Tokens" stat="tokens" value={fmtNum(stats.tokens.total)} />
      <span aria-hidden className="opacity-30">·</span>
      <span
        data-pi-stat="cost"
        className="font-medium tabular-nums text-[hsl(var(--foreground))] whitespace-nowrap"
      >
        {fmtCost(stats.cost)}
      </span>
    </div>
  );
}

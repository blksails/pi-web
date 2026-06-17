/**
 * PiSessionStats — 展示 usePiControls.stats(用量/成本);统计更新刷新。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import { Card } from "../ui/card.js";
import { cn } from "../lib/cn.js";

export interface PiSessionStatsProps {
  readonly controls: UsePiControlsResult;
  readonly className?: string;
}

function fmtCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function PiSessionStats({
  controls,
  className,
}: PiSessionStatsProps): React.JSX.Element {
  const stats = controls.stats;

  if (stats === undefined) {
    return (
      <Card
        className={cn("p-3 text-sm text-[hsl(var(--muted-foreground))]", className)}
        data-pi-session-stats
      >
        No stats yet
      </Card>
    );
  }

  return (
    <Card
      className={cn("flex flex-col gap-1 p-3 text-sm", className)}
      data-pi-session-stats
    >
      <div className="flex justify-between gap-4">
        <span className="text-[hsl(var(--muted-foreground))]">Messages</span>
        <span data-pi-stat="messages">{stats.totalMessages}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[hsl(var(--muted-foreground))]">Tool calls</span>
        <span data-pi-stat="toolCalls">{stats.toolCalls}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[hsl(var(--muted-foreground))]">Tokens</span>
        <span data-pi-stat="tokens">{stats.tokens.total}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[hsl(var(--muted-foreground))]">Cost</span>
        <span data-pi-stat="cost">{fmtCost(stats.cost)}</span>
      </div>
    </Card>
  );
}

/**
 * LogsPanel — 日志面板组件（shadcn/Tailwind 风格）。
 *
 * 消费 useLogs（来自 @pi-web/react），渲染结构化日志条目并提供过滤控件。
 *
 * 特性：
 *  - 容器带 data-pi-logs-region（供 e2e/测试定位）
 *  - 按时间顺序渲染日志行；每行带 data-pi-log-level={level} 与 data-pi-log-ns={ns}
 *  - 控件：级别下拉（debug/info/warn/error）、命名空间过滤、搜索框
 *  - 自动滚动：新日志到达且处于底部 → 滚到底；用户上滚 → 暂停
 *
 * 重要：日志消息用纯元素（<span>/<pre>）渲染 textContent，不用异步高亮组件，
 * 以确保 jsdom 测试环境下 textContent 正确可断言（见项目教训）。
 *
 * Requirements: 5.1–5.6
 */

import * as React from "react";
import { useRef, useEffect, useCallback } from "react";
import type { LogEntry, LogLevel } from "@pi-web/logger";
import { useLogs, createLogsStore, type UseLogsResult } from "@pi-web/react";
import { cn } from "../lib/cn.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Input } from "../ui/input.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** Tolerance in px for "at bottom" detection (handles sub-pixel rounding). */
const SCROLL_BOTTOM_THRESHOLD = 8;

// ── Default store (lazy singleton, used when no store prop is provided) ────────

/** Module-level default store, created once and reused across renders without a store prop. */
let _defaultStore: ReturnType<typeof createLogsStore> | undefined;
function getDefaultStore(): ReturnType<typeof createLogsStore> {
  if (!_defaultStore) _defaultStore = createLogsStore();
  return _defaultStore;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Single log row. Pure element rendering — no async highlights. */
function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  return (
    <li
      data-pi-log-level={entry.level}
      data-pi-log-ns={entry.ns}
      className={cn(
        "flex gap-2 px-3 py-0.5 text-xs font-mono leading-5 hover:bg-[hsl(var(--accent)/0.4)]",
        entry.level === "debug" && "text-[hsl(var(--muted-foreground))]",
        entry.level === "info" && "text-[hsl(var(--foreground))]",
        entry.level === "warn" && "text-amber-600 dark:text-amber-400",
        entry.level === "error" && "text-destructive",
      )}
    >
      <span className="shrink-0 w-10 opacity-70 uppercase">{entry.level}</span>
      <span className="shrink-0 max-w-[160px] truncate opacity-60">{entry.ns}</span>
      <span className="flex-1 break-all">{entry.msg}</span>
    </li>
  );
}

// ── LogsPanel ─────────────────────────────────────────────────────────────────

export interface LogsPanelProps {
  /**
   * Optional pre-configured useLogs result (injected by parent or tests).
   * If not provided, the component uses an internal default store.
   */
  readonly logsResult?: UseLogsResult;
  readonly className?: string;
}

/**
 * LogsPanel — renderable panel with filtering controls and auto-scroll.
 *
 * When `logsResult` is not provided, the component creates its own internal
 * store (useful for standalone usage; task 3.4 wires the real session store).
 */
export function LogsPanel({ logsResult, className }: LogsPanelProps): React.JSX.Element {
  // Use injected result or fall back to internal hook driven by default store.
  const internal = useLogs({ store: getDefaultStore() });
  const logs = logsResult ?? internal;

  const { entries, filters, setFilters, autoscroll, setAutoscroll } = logs;

  // Ref to the scroll sentinel at the bottom of the list.
  const sentinelRef = useRef<HTMLLIElement>(null);

  // ── Auto-scroll: scroll sentinel into view when autoscroll=true ───────────

  useEffect(() => {
    if (autoscroll && sentinelRef.current) {
      sentinelRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [autoscroll, entries]);

  // ── Scroll handler: detect whether user is at the bottom ──────────────────

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD;
      setAutoscroll(atBottom);
    },
    [setAutoscroll],
  );

  // ── Level filter change ───────────────────────────────────────────────────

  const handleLevelChange = useCallback(
    (value: string) => {
      setFilters({ level: value as LogLevel });
    },
    [setFilters],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]",
        className,
      )}
    >
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] shrink-0">
        {/* Level filter dropdown */}
        <Select value={filters.level} onValueChange={handleLevelChange}>
          <SelectTrigger
            className="h-7 w-24 text-xs"
            data-pi-logs-level-filter
          >
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((lvl) => (
              <SelectItem key={lvl} value={lvl} className="text-xs">
                {lvl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Namespace filter */}
        <Input
          className="h-7 text-xs flex-1"
          placeholder="namespace filter…"
          value={filters.namespace}
          onChange={(e) => setFilters({ namespace: e.target.value })}
          data-pi-logs-ns-filter
        />

        {/* Text search */}
        <Input
          className="h-7 text-xs flex-1"
          placeholder="search…"
          value={filters.text}
          onChange={(e) => setFilters({ text: e.target.value })}
          data-pi-logs-text-filter
        />
      </div>

      {/* Scrollable log container — also the data-pi-logs-region anchor */}
      <ul
        data-pi-logs-region
        className="flex-1 overflow-y-auto overflow-x-hidden py-1 list-none"
        onScroll={handleScroll}
        role="list"
      >
        {entries.map((entry, idx) => (
          <LogRow
            key={entry.id ?? `${entry.ts}-${idx}`}
            entry={entry}
          />
        ))}
        {/* Scroll sentinel — always rendered at the bottom of the list */}
        <li
          ref={sentinelRef}
          aria-hidden
          className="h-0 w-0 overflow-hidden"
        />
      </ul>
    </div>
  );
}

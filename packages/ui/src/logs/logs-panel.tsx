/**
 * LogsPanel — 日志面板组件（shadcn/Tailwind 风格）。
 *
 * 消费 useLogs（来自 @pi-web/react），渲染结构化日志条目并提供过滤控件。
 *
 * 特性：
 *  - 标题栏：左侧"日志"标题+条目计数，右侧折叠/展开 toggle（默认展开）
 *  - 容器带 data-pi-logs-region（供 e2e/测试定位）
 *  - 按时间顺序渲染日志行；每行带时间戳列、级别徽章、data-pi-log-level/data-pi-log-ns
 *  - 控件：级别下拉（debug/info/warn/error）、命名空间过滤、搜索框
 *  - 自动滚动：新日志到达且处于底部 → 滚到底；用户上滚 → 暂停
 *
 * 重要：日志消息用纯元素（<span>/<pre>）渲染 textContent，不用异步高亮组件，
 * 以确保 jsdom 测试环境下 textContent 正确可断言（见项目教训）。
 *
 * Requirements: 5.1–5.6
 */

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format epoch milliseconds to local time string HH:MM:SS.mmm.
 * Pure synchronous — safe in jsdom.
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ── Level badge styles ────────────────────────────────────────────────────────

const LEVEL_BADGE_CLASS: Record<LogLevel, string> = {
  debug: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  info:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  warn:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Single log row. Pure element rendering — no async highlights. */
function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  return (
    <li
      data-pi-log-level={entry.level}
      data-pi-log-ns={entry.ns}
      className="flex gap-2 px-3 py-0.5 text-xs font-mono leading-5 hover:bg-[hsl(var(--accent)/0.4)]"
    >
      {/* Timestamp column */}
      <span className="shrink-0 w-28 opacity-60 tabular-nums">
        {formatTimestamp(entry.ts)}
      </span>

      {/* Level badge */}
      <span
        data-pi-log-level-badge
        className={cn(
          "shrink-0 inline-flex items-center px-1.5 rounded text-[10px] font-semibold uppercase leading-4",
          LEVEL_BADGE_CLASS[entry.level] ?? LEVEL_BADGE_CLASS.debug,
        )}
      >
        {entry.level.toUpperCase()}
      </span>

      {/* Namespace */}
      <span className="shrink-0 max-w-[160px] truncate opacity-60">{entry.ns}</span>

      {/* Message */}
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

  // Collapsed/expanded state — default expanded so e2e can see the panel.
  const [expanded, setExpanded] = useState(true);

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

  // ── Collapse toggle ───────────────────────────────────────────────────────

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded-lg overflow-hidden",
        className,
      )}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[hsl(var(--border))] shrink-0 bg-[hsl(var(--muted)/0.4)]">
        <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
          {"日志"}
          {entries.length > 0 && (
            <span className="ml-1.5 opacity-60">{`· ${entries.length}`}</span>
          )}
        </span>
        <button
          type="button"
          data-pi-logs-collapse-toggle
          aria-label={expanded ? "折叠日志面板" : "展开日志面板"}
          aria-expanded={expanded}
          onClick={handleToggle}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-[hsl(var(--accent))] opacity-60 hover:opacity-100 transition-opacity"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Controls bar — only shown when expanded */}
      {expanded && (
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
      )}

      {/* Scrollable log container — data-pi-logs-region anchor (always rendered) */}
      <ul
        data-pi-logs-region
        className={cn(
          "overflow-y-auto overflow-x-hidden py-1 list-none",
          expanded ? "flex-1 min-h-[120px] max-h-64" : "h-0 overflow-hidden",
        )}
        onScroll={expanded ? handleScroll : undefined}
        role="list"
      >
        {expanded &&
          entries.map((entry, idx) => (
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

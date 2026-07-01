/**
 * LogsPanel — 日志面板组件（shadcn/Tailwind 风格）。
 *
 * 消费 useLogs（来自 @blksails/pi-web-react），渲染结构化日志条目并提供过滤控件。
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
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { LogEntry, LogLevel } from "@blksails/pi-web-logger";
import { useLogs, createLogsStore, type UseLogsResult } from "@blksails/pi-web-react";
import { cn } from "../lib/cn.js";
import { Input } from "../ui/input.js";
import { useI18n } from "../i18n/index.js";

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

/**
 * 把结构化 data 序列化为可读明细文本(同步,jsdom 安全)。
 * 字符串原样;对象/数组 JSON.stringify(2 缩进);循环引用/BigInt 等 stringify 抛错 → String() 兜底。
 */
function formatDetail(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Single log row. Pure element rendering — no async highlights.
 * 有结构化 `data` 时,行首出现展开开关(▸/▾),展开后整行全宽同步渲染 JSON 明细(Req:明细展示态)。
 */
function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  const t = useI18n();
  const hasDetail = entry.data !== undefined && entry.data !== null;
  const [expanded, setExpanded] = useState(false);
  const detailText = useMemo(
    () => (hasDetail ? formatDetail(entry.data) : ""),
    [hasDetail, entry.data],
  );
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <li
      data-pi-log-level={entry.level}
      data-pi-log-ns={entry.ns}
      {...(hasDetail ? { "data-pi-log-has-detail": "" } : {})}
      // 自适应行布局:宽容器 4 列单行;窄容器(如右侧栏)消息以 12rem 最小宽触发 flex-wrap,
      // 换到整行全宽并按词换行(break-words),避免固定列把消息挤成逐字竖排(break-all)。
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-0.5 text-xs font-mono leading-5 hover:bg-[hsl(var(--accent)/0.4)]"
    >
      {/* Disclosure caret — 仅当有结构化明细;无明细时占位 spacer 保持列对齐。 */}
      {hasDetail ? (
        <button
          type="button"
          data-pi-log-detail-toggle
          aria-expanded={expanded}
          aria-label={expanded ? t("logs.detail.collapse") : t("logs.detail.expand")}
          onClick={toggle}
          className="shrink-0 w-3 self-start leading-5 text-center opacity-50 hover:opacity-100 transition-opacity"
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="shrink-0 w-3" aria-hidden="true" />
      )}

      {/* Timestamp column */}
      <span className="shrink-0 w-[5.5rem] opacity-60 tabular-nums">
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
      <span className="shrink-0 max-w-[160px] truncate opacity-60" title={entry.ns}>
        {entry.ns}
      </span>

      {/* Message — grows to fill the line; min-width 12rem forces wrap-to-own-line in narrow containers. */}
      <span className="flex-[1_1_12rem] min-w-0 break-words">{entry.msg}</span>

      {/* 明细态:展开时整行全宽(basis-full)同步渲染结构化 data 的 JSON;有界高度内可滚。
          用纯 <pre>(非异步高亮组件)确保 jsdom 下 textContent 可断言(见项目教训)。 */}
      {hasDetail && expanded ? (
        <pre
          data-pi-log-detail
          className="basis-full mt-0.5 ml-3 max-h-60 overflow-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] px-2 py-1 text-[11px] leading-4 whitespace-pre-wrap break-words"
        >
          {detailText}
        </pre>
      ) : null}
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
  /**
   * 填充模式:滚动区填满有界父高度(用于 right 侧栏 / drawer 抽屉,父已给定高)而非
   * 固定 max-h-64 上限(后者用于 bottom dock,内容定高防无限增长)。
   * 默认 false(bottom dock 语义,保持既有行为)。
   */
  readonly fill?: boolean;
}

/**
 * LogsPanel — renderable panel with filtering controls and auto-scroll.
 *
 * When `logsResult` is not provided, the component creates its own internal
 * store (useful for standalone usage; task 3.4 wires the real session store).
 */
export function LogsPanel({ logsResult, className, fill }: LogsPanelProps): React.JSX.Element {
  const t = useI18n();
  // Use injected result or fall back to internal hook driven by default store.
  const internal = useLogs({ store: getDefaultStore() });
  const logs = logsResult ?? internal;

  const { entries, filters, setFilters, autoscroll, setAutoscroll } = logs;

  // Collapsed/expanded state — default expanded so e2e can see the panel.
  const [expanded, setExpanded] = useState(true);

  // Ref to the scroll container <ul>.
  const ulRef = useRef<HTMLUListElement>(null);

  // ── Unread count while autoscroll is paused ───────────────────────────────

  const [unreadCount, setUnreadCount] = useState(0);
  // Track previous entries length to compute delta.
  const prevLenRef = useRef(entries.length);

  // ── Auto-scroll: set ul.scrollTop = ul.scrollHeight when autoscroll=true ──

  useEffect(() => {
    const ul = ulRef.current;
    const currentLen = entries.length;
    const prevLen = prevLenRef.current;
    const delta = currentLen - prevLen;
    prevLenRef.current = currentLen;

    if (autoscroll) {
      // Scroll to bottom using direct scrollTop assignment (no page-level scroll).
      if (ul) {
        ul.scrollTop = ul.scrollHeight;
      }
      // Clear unread when following.
      setUnreadCount(0);
    } else {
      // Paused: accumulate positive deltas as unread.
      if (delta > 0) {
        setUnreadCount((prev) => prev + delta);
      }
      // Negative delta (filter shrink) — do not modify unreadCount.
    }
  }, [autoscroll, entries]);

  // ── Scroll handler: detect whether user is at the bottom ──────────────────

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD;
      setAutoscroll(atBottom);
      if (atBottom) {
        setUnreadCount(0);
      }
    },
    [setAutoscroll],
  );

  // ── Jump-to-latest handler ────────────────────────────────────────────────

  const handleJumpLatest = useCallback(() => {
    const ul = ulRef.current;
    if (ul) {
      ul.scrollTop = ul.scrollHeight;
    }
    setAutoscroll(true);
    setUnreadCount(0);
  }, [setAutoscroll]);

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
          {t("logs.title")}
          {entries.length > 0 && (
            <span className="ml-1.5 opacity-60">{`· ${entries.length}`}</span>
          )}
        </span>
        <button
          type="button"
          data-pi-logs-collapse-toggle
          aria-label={expanded ? t("logs.panel.collapse") : t("logs.panel.expand")}
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
          {/* Level filter dropdown — 原生 <select>(非 radix):radix Select 在 right 的 aside
              受限 flex/overflow 布局下 ref 反复挂卸致 React #185 整页崩;原生 select 无 Portal/
              ref 组合,三种位置(bottom/right/drawer)均稳定。 */}
          <select
            value={filters.level}
            onChange={(e) => handleLevelChange(e.target.value)}
            data-pi-logs-level-filter
            aria-label={t("logs.filter.levelLabel")}
            className="h-7 w-24 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-transparent px-2 text-xs"
          >
            {LOG_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>

          {/* Namespace filter */}
          <Input
            className="h-7 text-xs flex-1"
            placeholder={t("logs.filter.namespacePlaceholder")}
            value={filters.namespace}
            onChange={(e) => setFilters({ namespace: e.target.value })}
            data-pi-logs-ns-filter
          />

          {/* Text search */}
          <Input
            className="h-7 text-xs flex-1"
            placeholder={t("logs.filter.searchPlaceholder")}
            value={filters.text}
            onChange={(e) => setFilters({ text: e.target.value })}
            data-pi-logs-text-filter
          />
        </div>
      )}

      {/* Scrollable log container with relative wrapper for jump button anchor */}
      <div className="relative flex-1 min-h-0">
        <ul
          ref={ulRef}
          data-pi-logs-region
          className={cn(
            "overflow-y-auto overflow-x-hidden py-1 list-none h-full",
            // fill:填满有界父高度(right/drawer);否则固定 max-h-64 上限(bottom dock)。
            expanded
              ? fill
                ? "min-h-0"
                : "min-h-[120px] max-h-64"
              : "h-0 overflow-hidden",
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
        </ul>

        {/* Jump-to-latest button — shown only when paused with unread entries */}
        {expanded && !autoscroll && unreadCount > 0 && (
          <button
            type="button"
            data-pi-logs-jump-latest
            onClick={handleJumpLatest}
            className="absolute bottom-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium shadow-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            {t("logs.unread").replace("{count}", String(unreadCount))}
          </button>
        )}
      </div>
    </div>
  );
}

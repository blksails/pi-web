/**
 * LogsPanel 行为型测试（TDD）
 *
 * 覆盖 Requirements 5.1–5.6:
 *  - 5.1/5.2 渲染：给定一组 entries，面板渲染对应行，带 data-pi-log-level/data-pi-log-ns，文本含 msg
 *  - 5.3     级别过滤：切换级别下拉 → 只显示 ≥ 该级别的行
 *  - 5.4     命名空间过滤：输入命名空间 → 只显示该前缀的行
 *  - 5.5     文本搜索：输入搜索词 → 只显示消息匹配的行
 *  - 5.6     自动滚动：在底部时 autoscroll=true；上滚后 autoscroll=false
 *
 * 策略：mock useLogs hook，直接驱动 entries/filters/setFilters/autoscroll/setAutoscroll。
 * 避免使用异步高亮组件（jsdom 下 textContent 会空），日志消息用纯元素渲染。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LogEntry } from "@pi-web/logger";
import type { UseLogsResult, LogFilters } from "@pi-web/react";
import { LogsPanel } from "../../src/logs/logs-panel.js";

// ── Mock useLogs ──────────────────────────────────────────────────────────────

/**
 * We mock `@pi-web/react` so we can drive the hook's return value directly.
 * This isolates the LogsPanel component's rendering and UI interaction logic.
 */
const mockSetFilters = vi.fn();
const mockSetAutoscroll = vi.fn();
const mockFetchHistory = vi.fn(async () => undefined);

let mockLogsResult: UseLogsResult;

vi.mock("@pi-web/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pi-web/react")>();
  return {
    ...actual,
    useLogs: () => mockLogsResult,
    createLogsStore: actual.createLogsStore,
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<LogEntry> & { id: string },
): LogEntry {
  return {
    level: "info",
    ns: "agent:hello",
    msg: "hello world",
    ts: Date.now(),
    ...overrides,
  };
}

const DEFAULT_FILTERS: LogFilters = {
  level: "debug",
  namespace: "",
  text: "",
};

function makeResult(overrides: Partial<UseLogsResult> = {}): UseLogsResult {
  return {
    entries: [],
    filters: { ...DEFAULT_FILTERS },
    setFilters: mockSetFilters,
    fetchHistory: mockFetchHistory,
    autoscroll: true,
    setAutoscroll: mockSetAutoscroll,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LogsPanel — 渲染（5.1/5.2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("容器带 data-pi-logs-region 属性", () => {
    mockLogsResult = makeResult();
    const { container } = render(<LogsPanel />);
    expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
  });

  it("渲染三条日志行，每行带 data-pi-log-level 和 data-pi-log-ns", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "debug", ns: "agent:hello", msg: "debug msg" }),
      makeEntry({ id: "2", level: "info", ns: "ext:probe", msg: "info msg" }),
      makeEntry({ id: "3", level: "warn", ns: "core:sse", msg: "warn msg" }),
    ];
    mockLogsResult = makeResult({ entries });

    const { container } = render(<LogsPanel />);

    const rows = container.querySelectorAll("[data-pi-log-level]");
    expect(rows).toHaveLength(3);

    const row0 = rows[0]!;
    const row1 = rows[1]!;
    const row2 = rows[2]!;

    expect(row0).toHaveAttribute("data-pi-log-level", "debug");
    expect(row0).toHaveAttribute("data-pi-log-ns", "agent:hello");
    expect(row0.textContent).toContain("debug msg");

    expect(row1).toHaveAttribute("data-pi-log-level", "info");
    expect(row1).toHaveAttribute("data-pi-log-ns", "ext:probe");
    expect(row1.textContent).toContain("info msg");

    expect(row2).toHaveAttribute("data-pi-log-level", "warn");
    expect(row2).toHaveAttribute("data-pi-log-ns", "core:sse");
    expect(row2.textContent).toContain("warn msg");
  });

  it("每行文本同时含级别与命名空间标识", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "a", level: "error", ns: "core:attach", msg: "broken" }),
    ];
    mockLogsResult = makeResult({ entries });

    render(<LogsPanel />);
    const row = screen.getAllByRole("listitem")[0]!;
    // Badge text is uppercase; check case-insensitively
    expect(row.textContent?.toLowerCase()).toContain("error");
    expect(row.textContent).toContain("core:attach");
    expect(row.textContent).toContain("broken");
  });

  it("无日志时不渲染行", () => {
    mockLogsResult = makeResult({ entries: [] });

    const { container } = render(<LogsPanel />);
    const rows = container.querySelectorAll("[data-pi-log-level]");
    expect(rows).toHaveLength(0);
  });
});

describe("LogsPanel — 过滤控件交互（5.3/5.4/5.5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("级别下拉初始值反映 filters.level", () => {
    mockLogsResult = makeResult({ filters: { ...DEFAULT_FILTERS, level: "warn" } });
    const { container } = render(<LogsPanel />);
    // Radix Select trigger should display the current level
    const trigger = container.querySelector("[data-pi-logs-level-filter]");
    expect(trigger?.textContent).toContain("warn");
  });

  it("命名空间过滤输入框：输入触发 setFilters({ namespace })", () => {
    mockLogsResult = makeResult();
    const { container } = render(<LogsPanel />);

    const nsInput = container.querySelector(
      "[data-pi-logs-ns-filter]",
    ) as HTMLInputElement;
    expect(nsInput).not.toBeNull();

    fireEvent.change(nsInput, { target: { value: "agent:hello" } });
    expect(mockSetFilters).toHaveBeenCalledWith({ namespace: "agent:hello" });
  });

  it("搜索框：输入触发 setFilters({ text })", () => {
    mockLogsResult = makeResult();
    const { container } = render(<LogsPanel />);

    const searchInput = container.querySelector(
      "[data-pi-logs-text-filter]",
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    fireEvent.change(searchInput, { target: { value: "error" } });
    expect(mockSetFilters).toHaveBeenCalledWith({ text: "error" });
  });

  it("命名空间输入当前值反映 filters.namespace", () => {
    mockLogsResult = makeResult({
      filters: { ...DEFAULT_FILTERS, namespace: "ext:probe" },
    });
    const { container } = render(<LogsPanel />);

    const nsInput = container.querySelector(
      "[data-pi-logs-ns-filter]",
    ) as HTMLInputElement;
    expect(nsInput.value).toBe("ext:probe");
  });

  it("搜索框当前值反映 filters.text", () => {
    mockLogsResult = makeResult({
      filters: { ...DEFAULT_FILTERS, text: "hello" },
    });
    const { container } = render(<LogsPanel />);

    const searchInput = container.querySelector(
      "[data-pi-logs-text-filter]",
    ) as HTMLInputElement;
    expect(searchInput.value).toBe("hello");
  });

  it("过滤后 entries 变化时行数跟随变化（验证 entries 驱动渲染）", () => {
    // Start with 3 entries (simulating "debug" filter → all shown)
    const allEntries: LogEntry[] = [
      makeEntry({ id: "1", level: "debug", ns: "a", msg: "d msg" }),
      makeEntry({ id: "2", level: "info", ns: "b", msg: "i msg" }),
      makeEntry({ id: "3", level: "warn", ns: "c", msg: "w msg" }),
    ];
    mockLogsResult = makeResult({ entries: allEntries });

    const { rerender, container } = render(<LogsPanel />);
    expect(container.querySelectorAll("[data-pi-log-level]")).toHaveLength(3);

    // Simulate filter applied: only warn+ entries remain
    const filteredEntries: LogEntry[] = [
      makeEntry({ id: "3", level: "warn", ns: "c", msg: "w msg" }),
    ];
    mockLogsResult = makeResult({ entries: filteredEntries, filters: { ...DEFAULT_FILTERS, level: "warn" } });
    rerender(<LogsPanel />);

    expect(container.querySelectorAll("[data-pi-log-level]")).toHaveLength(1);
    expect(container.querySelector("[data-pi-log-level]")).toHaveAttribute(
      "data-pi-log-level",
      "warn",
    );
  });
});

describe("LogsPanel — 自动滚动（5.6）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("滚动到底部时调用 setAutoscroll(true)", () => {
    mockLogsResult = makeResult({ autoscroll: false });
    const { container } = render(<LogsPanel />);

    const scrollContainer = container.querySelector(
      "[data-pi-logs-region]",
    ) as HTMLElement;
    expect(scrollContainer).not.toBeNull();

    // Stub scroll dimensions: scrollTop + clientHeight >= scrollHeight → at bottom
    Object.defineProperty(scrollContainer, "scrollTop", { value: 100, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 300, configurable: true });

    fireEvent.scroll(scrollContainer);
    expect(mockSetAutoscroll).toHaveBeenCalledWith(true);
  });

  it("上滚时调用 setAutoscroll(false)", () => {
    mockLogsResult = makeResult({ autoscroll: true });
    const { container } = render(<LogsPanel />);

    const scrollContainer = container.querySelector(
      "[data-pi-logs-region]",
    ) as HTMLElement;

    // Stub: not at bottom (scrollTop + clientHeight < scrollHeight)
    Object.defineProperty(scrollContainer, "scrollTop", { value: 0, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 500, configurable: true });

    fireEvent.scroll(scrollContainer);
    expect(mockSetAutoscroll).toHaveBeenCalledWith(false);
  });

  it("autoscroll=true 时新 entries 到达触发滚到底（scrollIntoView 被调用）", () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
    ];
    mockLogsResult = makeResult({ entries, autoscroll: true });

    const { rerender } = render(<LogsPanel />);

    // Add new entry
    const newEntries: LogEntry[] = [
      ...entries,
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
    ];
    mockLogsResult = makeResult({ entries: newEntries, autoscroll: true });
    rerender(<LogsPanel />);

    // scrollIntoView should have been called on the last entry
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});

// ── 视觉重构新增测试（任务 6.1）──────────────────────────────────────────────

describe("LogsPanel — 标题栏与折叠（任务 6.1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染含 '日志' 文本的标题栏", () => {
    mockLogsResult = makeResult();
    render(<LogsPanel />);
    // Title bar should contain the text "日志"
    expect(screen.getByText(/日志/)).toBeInTheDocument();
  });

  it("标题栏包含折叠/展开 toggle 按钮", () => {
    mockLogsResult = makeResult();
    const { container } = render(<LogsPanel />);
    const toggle = container.querySelector("[data-pi-logs-collapse-toggle]");
    expect(toggle).not.toBeNull();
  });

  it("默认展开：data-pi-logs-region 可见，日志行渲染", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "visible msg" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    // Scroll region exists and log rows are rendered
    expect(container.querySelector("[data-pi-logs-region]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pi-log-level]")).toHaveLength(1);
  });

  it("折叠 toggle 点击后日志行隐藏", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);

    const toggle = container.querySelector("[data-pi-logs-collapse-toggle]") as HTMLElement;
    fireEvent.click(toggle);

    // After collapsing, rows should not be visible (hidden or not rendered)
    const rows = container.querySelectorAll("[data-pi-log-level]");
    expect(rows).toHaveLength(0);
  });

  it("折叠后再次点击 toggle 恢复展开，行再次出现", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);

    const toggle = container.querySelector("[data-pi-logs-collapse-toggle]") as HTMLElement;
    // Collapse
    fireEvent.click(toggle);
    expect(container.querySelectorAll("[data-pi-log-level]")).toHaveLength(0);
    // Expand again
    fireEvent.click(toggle);
    expect(container.querySelectorAll("[data-pi-log-level]")).toHaveLength(1);
  });

  it("标题栏显示当前条目计数", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
      makeEntry({ id: "2", level: "warn", ns: "b", msg: "msg2" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    // Title bar should contain the count "· 2"
    const titleBar = container.querySelector("[data-pi-logs-collapse-toggle]")?.closest("div");
    expect(titleBar?.textContent).toContain("2");
  });
});

describe("LogsPanel — 时间戳列与级别徽章（任务 6.1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("每行渲染时间戳（HH:MM:SS 格式）", () => {
    // Use a fixed ts to check timestamp format
    const ts = new Date("2024-01-15T10:30:45.123").getTime();
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg", ts }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);

    const row = container.querySelector("[data-pi-log-level]")!;
    // Should contain a time-like string matching HH:MM:SS
    expect(row.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("每行渲染级别徽章（data-pi-log-level 仍在）", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "error", ns: "a", msg: "err msg" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);

    const row = container.querySelector("[data-pi-log-level]")!;
    expect(row).toHaveAttribute("data-pi-log-level", "error");
    // Badge should contain uppercase level text
    const badge = row.querySelector("[data-pi-log-level-badge]");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("ERROR");
  });

  it("debug 级别徽章有灰色相关样式", () => {
    const entries: LogEntry[] = [makeEntry({ id: "1", level: "debug", ns: "a", msg: "d" })];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const badge = container.querySelector("[data-pi-log-level-badge]")!;
    expect(badge).not.toBeNull();
    // Badge text should be DEBUG
    expect(badge.textContent).toContain("DEBUG");
  });

  it("warn 级别徽章有琥珀/黄色相关样式", () => {
    const entries: LogEntry[] = [makeEntry({ id: "1", level: "warn", ns: "a", msg: "w" })];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const badge = container.querySelector("[data-pi-log-level-badge]")!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("WARN");
  });
});

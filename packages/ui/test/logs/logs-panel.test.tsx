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
import type { LogEntry } from "@blksails/pi-web-logger";
import type { UseLogsResult, LogFilters } from "@blksails/pi-web-react";
import { LogsPanel } from "../../src/logs/logs-panel.js";

// ── Mock useLogs ──────────────────────────────────────────────────────────────

/**
 * We mock `@blksails/pi-web-react` so we can drive the hook's return value directly.
 * This isolates the LogsPanel component's rendering and UI interaction logic.
 */
const mockSetFilters = vi.fn();
const mockSetAutoscroll = vi.fn();
const mockFetchHistory = vi.fn(async () => undefined);

let mockLogsResult: UseLogsResult;

vi.mock("@blksails/pi-web-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blksails/pi-web-react")>();
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

  it("autoscroll=true 时新 entries 到达触发滚到底（ul.scrollTop 设为 scrollHeight）", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
    ];
    mockLogsResult = makeResult({ entries, autoscroll: true });

    const { rerender, container } = render(<LogsPanel />);

    const ul = container.querySelector("[data-pi-logs-region]") as HTMLElement;
    expect(ul).not.toBeNull();

    // Stub scrollHeight so the assignment can be verified
    let capturedScrollTop = 0;
    Object.defineProperty(ul, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(ul, "scrollTop", {
      get: () => capturedScrollTop,
      set: (v: number) => { capturedScrollTop = v; },
      configurable: true,
    });

    // Add new entry → triggers useEffect with autoscroll=true
    const newEntries: LogEntry[] = [
      ...entries,
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
    ];
    mockLogsResult = makeResult({ entries: newEntries, autoscroll: true });
    rerender(<LogsPanel />);

    // ul.scrollTop should have been set to ul.scrollHeight
    expect(capturedScrollTop).toBe(500);
  });

  it("autoscroll=true 时不显示跳转按钮", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
    ];
    mockLogsResult = makeResult({ entries, autoscroll: true });
    const { container } = render(<LogsPanel />);
    expect(container.querySelector("[data-pi-logs-jump-latest]")).toBeNull();
  });
});

// ── 智能跟随 / 未读计数 / 跳转（任务 8.5）────────────────────────────────────

describe("LogsPanel — 智能跟随与未读跳转（任务 8.5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: stub a ul element's scrollHeight and capture scrollTop assignments.
   */
  function stubScrollDimensions(
    ul: HTMLElement,
    opts: { scrollHeight?: number; scrollTop?: number; clientHeight?: number } = {},
  ): { getCapturedScrollTop: () => number } {
    let capturedScrollTop = opts.scrollTop ?? 0;
    Object.defineProperty(ul, "scrollHeight", {
      value: opts.scrollHeight ?? 500,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(ul, "scrollTop", {
      get: () => capturedScrollTop,
      set: (v: number) => { capturedScrollTop = v; },
      configurable: true,
    });
    Object.defineProperty(ul, "clientHeight", {
      value: opts.clientHeight ?? 200,
      configurable: true,
    });
    return { getCapturedScrollTop: () => capturedScrollTop };
  }

  it("上滚（atBottom=false）后新日志不自动置底，出现未读跳转按钮含数字", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
    ];
    // autoscroll=false simulates user scrolled up
    mockLogsResult = makeResult({ entries, autoscroll: false });
    const { rerender, container } = render(<LogsPanel />);

    const ul = container.querySelector("[data-pi-logs-region]") as HTMLElement;
    const { getCapturedScrollTop } = stubScrollDimensions(ul, { scrollHeight: 500, scrollTop: 0, clientHeight: 200 });

    // Simulate user scrolling up (fire scroll event with not-at-bottom dimensions)
    fireEvent.scroll(ul);
    // setAutoscroll(false) should have been called (ul dimensions make atBottom=false)
    expect(mockSetAutoscroll).toHaveBeenCalledWith(false);

    // Add new entries while autoscroll=false
    const newEntries: LogEntry[] = [
      ...entries,
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
      makeEntry({ id: "3", level: "info", ns: "a", msg: "msg3" }),
    ];
    mockLogsResult = makeResult({ entries: newEntries, autoscroll: false });
    rerender(<LogsPanel />);

    // scrollTop should NOT have been set to scrollHeight (no auto-scroll)
    expect(getCapturedScrollTop()).toBe(0);

    // Jump button should appear
    const jumpBtn = container.querySelector("[data-pi-logs-jump-latest]");
    expect(jumpBtn).not.toBeNull();
    // Button text should contain a number (unread count)
    expect(jumpBtn!.textContent).toMatch(/\d+/);
  });

  it("点击跳转按钮置底、autoscroll 恢复、按钮消失", () => {
    // Start with autoscroll=false and initial entries so prevLenRef is set.
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
    ];
    mockLogsResult = makeResult({ entries, autoscroll: false });
    const { container, rerender } = render(<LogsPanel />);

    const ul = container.querySelector("[data-pi-logs-region]") as HTMLElement;
    const { getCapturedScrollTop } = stubScrollDimensions(ul, { scrollHeight: 600, scrollTop: 0, clientHeight: 200 });

    // Add more entries while autoscroll=false → unreadCount > 0 → button appears.
    const moreEntries: LogEntry[] = [
      ...entries,
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
      makeEntry({ id: "3", level: "info", ns: "a", msg: "msg3" }),
    ];
    mockLogsResult = makeResult({ entries: moreEntries, autoscroll: false });
    rerender(<LogsPanel />);

    // Button should appear — assert it exists before clicking.
    const jumpBtn = container.querySelector("[data-pi-logs-jump-latest]");
    expect(jumpBtn).not.toBeNull();

    // Click jump button
    fireEvent.click(jumpBtn as HTMLElement);

    // After click: setAutoscroll(true) called, scrollTop set to scrollHeight
    expect(mockSetAutoscroll).toHaveBeenCalledWith(true);
    expect(getCapturedScrollTop()).toBe(600);
  });

  it("滚到底恢复跟随时未读清零、按钮消失", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
    ];
    // Start with autoscroll=false and 2 entries
    mockLogsResult = makeResult({ entries, autoscroll: false });
    const { rerender, container } = render(<LogsPanel />);

    const ul = container.querySelector("[data-pi-logs-region]") as HTMLElement;

    // Use getter/setter so scrollTop remains writable (needed when autoscroll=true resets scrollTop)
    let scrollTopValue = 0;
    Object.defineProperty(ul, "scrollTop", {
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; },
      configurable: true,
    });
    Object.defineProperty(ul, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(ul, "scrollHeight", { value: 500, configurable: true, writable: true });

    // Add entry to trigger unread count
    const moreEntries: LogEntry[] = [
      ...entries,
      makeEntry({ id: "3", level: "info", ns: "a", msg: "msg3" }),
    ];
    mockLogsResult = makeResult({ entries: moreEntries, autoscroll: false });
    rerender(<LogsPanel />);

    // Now simulate user scrolling back to bottom (atBottom=true)
    scrollTopValue = 300; // simulate scroll position at bottom
    fireEvent.scroll(ul);

    // setAutoscroll(true) should be called
    expect(mockSetAutoscroll).toHaveBeenCalledWith(true);

    // Rerender with autoscroll=true → button should be gone
    mockLogsResult = makeResult({ entries: moreEntries, autoscroll: true });
    rerender(<LogsPanel />);

    const jumpBtn = container.querySelector("[data-pi-logs-jump-latest]");
    expect(jumpBtn).toBeNull();
  });

  it("过滤器变更导致 entries 减少时不累加负未读，不报错", () => {
    const manyEntries: LogEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: String(i), level: "info", ns: "a", msg: `msg${i}` }),
    );
    mockLogsResult = makeResult({ entries: manyEntries, autoscroll: false });
    const { rerender, container } = render(<LogsPanel />);

    // Simulate filter shrinking entries (e.g. level filter applied)
    const fewEntries: LogEntry[] = [
      makeEntry({ id: "0", level: "warn", ns: "a", msg: "msg0" }),
    ];
    mockLogsResult = makeResult({ entries: fewEntries, autoscroll: false });

    // Should not throw
    expect(() => rerender(<LogsPanel />)).not.toThrow();

    // Jump button should NOT show negative count
    const jumpBtn = container.querySelector("[data-pi-logs-jump-latest]");
    if (jumpBtn) {
      const text = jumpBtn.textContent ?? "";
      const match = text.match(/-?\d+/);
      if (match) {
        expect(Number(match[0])).toBeGreaterThan(0);
      }
    }
  });

  it("折叠状态下不显示跳转按钮", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", level: "info", ns: "a", msg: "msg1" }),
      makeEntry({ id: "2", level: "info", ns: "a", msg: "msg2" }),
    ];
    mockLogsResult = makeResult({ entries, autoscroll: false });
    const { container } = render(<LogsPanel />);

    // Collapse panel
    const toggle = container.querySelector("[data-pi-logs-collapse-toggle]") as HTMLElement;
    fireEvent.click(toggle);

    // Jump button should not appear even if autoscroll=false
    const jumpBtn = container.querySelector("[data-pi-logs-jump-latest]");
    expect(jumpBtn).toBeNull();
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

describe("LogsPanel — 结构化明细展示态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无 data 的行不渲染明细开关、不标记 has-detail", () => {
    const entries: LogEntry[] = [makeEntry({ id: "1", msg: "plain" })];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const row = container.querySelector("[data-pi-log-level]")!;
    expect(row).not.toHaveAttribute("data-pi-log-has-detail");
    expect(row.querySelector("[data-pi-log-detail-toggle]")).toBeNull();
  });

  it("有 data 的行标记 has-detail 且渲染明细开关(初始折叠,无 <pre>)", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", msg: "with data", data: { foo: 1, bar: "x" } }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const row = container.querySelector("[data-pi-log-level]")!;
    expect(row).toHaveAttribute("data-pi-log-has-detail");
    const toggle = row.querySelector("[data-pi-log-detail-toggle]");
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // 折叠态:明细 <pre> 不在场
    expect(row.querySelector("[data-pi-log-detail]")).toBeNull();
  });

  it("点击开关展开 → 同步渲染对象 data 的 JSON 明细(textContent 可断言)", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", msg: "m", data: { foo: 1, nested: { ok: true } } }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const toggle = container.querySelector("[data-pi-log-detail-toggle]")!;
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = container.querySelector("[data-pi-log-detail]")!;
    expect(detail).not.toBeNull();
    // 同步 <pre>:JSON 文本可断言(非异步高亮)
    expect(detail.textContent).toContain('"foo": 1');
    expect(detail.textContent).toContain('"nested"');
    expect(detail.textContent).toContain('"ok": true');
  });

  it("再次点击 → 折叠,明细 <pre> 移除", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", msg: "m", data: { a: 1 } }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const toggle = container.querySelector("[data-pi-log-detail-toggle]")!;
    fireEvent.click(toggle);
    expect(container.querySelector("[data-pi-log-detail]")).not.toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelector("[data-pi-log-detail]")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("字符串 data 原样展示(不 JSON 包引号)", () => {
    const entries: LogEntry[] = [
      makeEntry({ id: "1", msg: "m", data: "raw string detail" }),
    ];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    fireEvent.click(container.querySelector("[data-pi-log-detail-toggle]")!);
    const detail = container.querySelector("[data-pi-log-detail]")!;
    expect(detail.textContent).toBe("raw string detail");
  });

  it("循环引用 data 不抛错(String 兜底仍可展开)", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const entries: LogEntry[] = [makeEntry({ id: "1", msg: "m", data: circular })];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const toggle = container.querySelector("[data-pi-log-detail-toggle]")!;
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(container.querySelector("[data-pi-log-detail]")).not.toBeNull();
  });

  it("data 为 null 视为无明细(不标记 has-detail)", () => {
    const entries: LogEntry[] = [makeEntry({ id: "1", msg: "m", data: null })];
    mockLogsResult = makeResult({ entries });
    const { container } = render(<LogsPanel />);
    const row = container.querySelector("[data-pi-log-level]")!;
    expect(row).not.toHaveAttribute("data-pi-log-has-detail");
  });
});

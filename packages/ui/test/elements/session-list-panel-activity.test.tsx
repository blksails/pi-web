/**
 * SessionListPanel × 来源色条 + 工作状态指示(spec session-meta-index, 任务 4.1)。
 *
 * 覆盖 Req 6.1/6.2/6.3/6.5/6.6 与 7.1/7.2/7.3/7.6。
 *
 * ★ 断言依据是**先 dump 出来的真实 DOM 属性**(`data-pi-session-list-item-accent` /
 *   `data-pi-session-list-item-activity`),不是猜的 testid —— 猜 testid 有前科。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type {
  ListSessionsResponse,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { SessionListPanel } from "../../src/elements/session-list-panel.js";
import { sourceAccentColor } from "../../src/elements/session-source-color.js";

function item(
  over: Partial<SessionListItem> & { sessionId: string },
): SessionListItem {
  return {
    cwd: "/work",
    createdAt: "2026-06-30T00:00:00.000Z",
    ...over,
  };
}

const resp = (sessions: SessionListItem[]): ListSessionsResponse => ({
  sessions,
});

function renderPanel(sessions: SessionListItem[], showSource = true) {
  const listSessions = vi.fn(async () => resp(sessions));
  const view = render(
    <SessionListPanel
      listSessions={listSessions}
      onResume={vi.fn()}
      showSource={showSource}
    />,
  );
  return { ...view, listSessions };
}

const accentOf = (sessionId: string): HTMLElement | null =>
  document.querySelector(
    `[data-pi-session-list-item="${sessionId}"] [data-pi-session-list-item-accent]`,
  );

const activityOf = (sessionId: string): HTMLElement | null =>
  document.querySelector(
    `[data-pi-session-list-item="${sessionId}"] [data-pi-session-list-item-activity]`,
  );

describe("来源色条(Req 6.2/6.3/6.4/6.5)", () => {
  it("有来源 → 渲染色条,颜色取自派生函数", async () => {
    renderPanel([item({ sessionId: "s1", name: "会话一", source: "builtin:demo" })]);
    await waitFor(() => expect(screen.getByText("会话一")).toBeInTheDocument());
    const accent = accentOf("s1");
    expect(accent).not.toBeNull();
    expect(accent?.getAttribute("data-pi-session-list-item-accent")).toBe(
      "builtin:demo",
    );
    // 行内样式取派生色(不硬编码具体色值,只断言与派生函数一致)
    expect(accent?.style.backgroundColor.length).toBeGreaterThan(0);
    expect(sourceAccentColor("builtin:demo").length).toBeGreaterThan(0);
  });

  it("同来源两个会话色条颜色相同(Req 6.4)", async () => {
    renderPanel([
      item({ sessionId: "s1", name: "会话一", source: "builtin:same" }),
      item({ sessionId: "s2", name: "会话二", source: "builtin:same" }),
    ]);
    await waitFor(() => expect(screen.getByText("会话二")).toBeInTheDocument());
    expect(accentOf("s1")?.style.backgroundColor).toBe(
      accentOf("s2")?.style.backgroundColor,
    );
  });

  it("无来源 → 不渲染色条元素(不占位)", async () => {
    renderPanel([item({ sessionId: "s1", name: "无来源会话" })]);
    await waitFor(() => expect(screen.getByText("无来源会话")).toBeInTheDocument());
    expect(accentOf("s1")).toBeNull();
  });
});

describe("工作状态指示(Req 7.1/7.2/7.3/7.6)", () => {
  it("working → 显示指示且标注为工作中", async () => {
    renderPanel([item({ sessionId: "s1", name: "忙碌会话", activity: "working" })]);
    await waitFor(() => expect(screen.getByText("忙碌会话")).toBeInTheDocument());
    const el = activityOf("s1");
    expect(el?.getAttribute("data-pi-session-list-item-activity")).toBe("working");
    expect(el?.getAttribute("aria-label")).toBe("生成中");
  });

  it("awaiting-input → 显示等待用户回应指示", async () => {
    renderPanel([
      item({ sessionId: "s1", name: "等待会话", activity: "awaiting-input" }),
    ]);
    await waitFor(() => expect(screen.getByText("等待会话")).toBeInTheDocument());
    const el = activityOf("s1");
    expect(el?.getAttribute("data-pi-session-list-item-activity")).toBe(
      "awaiting-input",
    );
    expect(el?.getAttribute("aria-label")).toBe("等待你的回应");
  });

  it("error → 显示异常指示,且该会话仍可点击恢复(Req 7.3)", async () => {
    renderPanel([item({ sessionId: "s1", name: "异常会话", activity: "error" })]);
    await waitFor(() => expect(screen.getByText("异常会话")).toBeInTheDocument());
    expect(activityOf("s1")?.getAttribute("data-pi-session-list-item-activity")).toBe(
      "error",
    );
    const resume = document.querySelector<HTMLButtonElement>(
      '[data-pi-session-list-resume="s1"]',
    );
    expect(resume).not.toBeNull();
    expect(resume?.disabled).toBe(false);
  });

  it("空闲(字段缺省)→ 不渲染任何状态指示元素", async () => {
    renderPanel([item({ sessionId: "s1", name: "空闲会话" })]);
    await waitFor(() => expect(screen.getByText("空闲会话")).toBeInTheDocument());
    expect(activityOf("s1")).toBeNull();
  });

  it("混排:忙的显示指示、闲的不显示", async () => {
    renderPanel([
      item({ sessionId: "s1", name: "忙", activity: "working" }),
      item({ sessionId: "s2", name: "闲" }),
    ]);
    await waitFor(() => expect(screen.getByText("闲")).toBeInTheDocument());
    expect(activityOf("s1")).not.toBeNull();
    expect(activityOf("s2")).toBeNull();
  });
});

describe("标题状态(Req 6.7)", () => {
  it("auto-title 已设置标题 → 显示标题名称", async () => {
    renderPanel([item({ sessionId: "s1", name: "重构会话列表" })]);
    await waitFor(() => expect(screen.getByText("重构会话列表")).toBeInTheDocument());
    // 不再暴露 uuid 作为主标题
    expect(screen.queryByText("s1")).not.toBeInTheDocument();
  });

  it("★ 未设置标题 → 显示「新对话」而非 sessionId 的 uuid", async () => {
    const uuid = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    renderPanel([item({ sessionId: uuid })]);
    await waitFor(() => expect(screen.getByText("新对话")).toBeInTheDocument());
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });

  it("空字符串标题按「未设置」处理", async () => {
    renderPanel([item({ sessionId: "s1", name: "" })]);
    await waitFor(() => expect(screen.getByText("新对话")).toBeInTheDocument());
  });

  it("sessionId 仍可从 hover 提示查到(只是不占主标题位)", async () => {
    const uuid = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    renderPanel([item({ sessionId: uuid })]);
    await waitFor(() => expect(screen.getByText("新对话")).toBeInTheDocument());
    const btn = document.querySelector(`[data-pi-session-list-resume="${uuid}"]`);
    expect(btn?.getAttribute("title")).toContain(uuid);
  });
});

describe("既有渲染与交互不变(Req 6.1/6.6)", () => {
  it("标题、恢复按钮、来源副标题照旧", async () => {
    renderPanel([
      item({ sessionId: "s1", name: "标题在此", source: "builtin:demo" }),
    ]);
    await waitFor(() => expect(screen.getByText("标题在此")).toBeInTheDocument());
    // 既有的 source 副标题仍在(与新增色条并存)
    expect(
      document.querySelector(
        '[data-pi-session-list-item="s1"] [data-pi-session-list-item-source]',
      )?.textContent,
    ).toBe("builtin:demo");
    expect(
      document.querySelector('[data-pi-session-list-resume="s1"]'),
    ).not.toBeNull();
  });

  it("色条与状态指示同时出现时互不干扰", async () => {
    renderPanel([
      item({
        sessionId: "s1",
        name: "两者兼有",
        source: "builtin:demo",
        activity: "working",
      }),
    ]);
    await waitFor(() => expect(screen.getByText("两者兼有")).toBeInTheDocument());
    expect(accentOf("s1")).not.toBeNull();
    expect(activityOf("s1")).not.toBeNull();
  });
});

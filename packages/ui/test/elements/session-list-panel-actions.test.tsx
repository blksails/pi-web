/**
 * SessionListPanel × 项级管理(session-list-item-actions)。
 *
 * 覆盖:门控隐藏写入口(Req 6.1)、菜单不误触恢复(Req 1.4)、收藏置顶分区+不重复+无则不渲染
 * (Req 4.3/4.4)、删除二次确认→乐观移除(Req 2.4)、重命名内联→乐观改名(Req 3.3)、
 * 重命名空名不提交(Req 3.4)、删除失败保留项+错误提示(Req 2.7)。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import * as React from "react";
import type {
  SessionListItem,
  ListSessionsResponse,
} from "@blksails/pi-web-protocol";
import { SessionListPanel } from "../../src/elements/session-list-panel.js";

afterEach(cleanup);

function item(over: Partial<SessionListItem> & { sessionId: string }): SessionListItem {
  return { cwd: "/work", createdAt: "2026-06-30T00:00:00.000Z", ...over };
}
function resp(sessions: SessionListItem[]): ListSessionsResponse {
  return { sessions, scope: "cwd", globalEnabled: false };
}

function baseProps(
  over: Partial<React.ComponentProps<typeof SessionListPanel>> = {},
) {
  return {
    currentCwd: "/work",
    globalEnabled: false,
    onResume: vi.fn(),
    listSessions: vi.fn(async () =>
      resp([item({ sessionId: "s1", name: "Alpha" })]),
    ),
    manageEnabled: true,
    onDeleteSession: vi.fn(async () => {}),
    onRenameSession: vi.fn(async () => {}),
    onToggleFavorite: vi.fn(async () => {}),
    ...over,
  };
}

const q = (sel: string): HTMLElement | null =>
  document.querySelector(sel) as HTMLElement | null;

describe("SessionListPanel — 项级管理门控与恢复隔离", () => {
  it("manageEnabled=false → 不渲染写入口(⋯ 菜单)", async () => {
    render(<SessionListPanel {...baseProps({ manageEnabled: false })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(q("[data-pi-session-item-menu]")).toBeNull();
  });

  it("manageEnabled=true → 渲染 ⋯ 菜单;点击菜单不触发 onResume(Req 1.4)", async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<SessionListPanel {...baseProps({ onResume })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    const menu = q("[data-pi-session-item-menu]");
    expect(menu).not.toBeNull();
    await user.click(menu!);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("SessionListPanel — 收藏置顶分区", () => {
  it("已收藏且在视图内 → 顶部收藏分区且普通列表不重复", async () => {
    render(
      <SessionListPanel
        {...baseProps({
          listSessions: vi.fn(async () =>
            resp([
              item({ sessionId: "s1", name: "Alpha" }),
              item({ sessionId: "s2", name: "Beta" }),
            ]),
          ),
          favoriteSessionIds: ["s2"],
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());
    const fav = q("[data-pi-session-list-favorites]");
    expect(fav).not.toBeNull();
    // 收藏分区含 s2;s2 只渲染一次(不在普通列表重复)。
    expect(fav!.querySelector("[data-pi-session-list-item='s2']")).not.toBeNull();
    expect(
      document.querySelectorAll("[data-pi-session-list-item='s2']").length,
    ).toBe(1);
  });

  it("视图内无已收藏会话 → 不渲染收藏分区", async () => {
    render(
      <SessionListPanel
        {...baseProps({ favoriteSessionIds: ["ghost-not-in-view"] })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(q("[data-pi-session-list-favorites]")).toBeNull();
  });
});

describe("SessionListPanel — 删除", () => {
  it("二次确认→确认→调用 onDeleteSession 并乐观移除该项", async () => {
    const onDeleteSession = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SessionListPanel {...baseProps({ onDeleteSession })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    await user.click(q("[data-pi-session-item-menu]")!);
    await user.click(await screen.findByText("删除"));
    fireEvent.click(q("[data-pi-session-item-delete-confirm-btn]")!);

    await waitFor(() =>
      expect(onDeleteSession).toHaveBeenCalledWith("s1"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument(),
    );
  });

  it("删除失败 → 保留该项并展示错误提示(Req 2.7)", async () => {
    const onDeleteSession = vi.fn(async () => {
      throw new Error("boom");
    });
    const user = userEvent.setup();
    render(<SessionListPanel {...baseProps({ onDeleteSession })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    await user.click(q("[data-pi-session-item-menu]")!);
    await user.click(await screen.findByText("删除"));
    fireEvent.click(q("[data-pi-session-item-delete-confirm-btn]")!);

    await waitFor(() =>
      expect(q("[data-pi-session-list-action-error]")).not.toBeNull(),
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("SessionListPanel — 重命名", () => {
  it("菜单→重命名→内联输入→Enter→调用 onRenameSession 并乐观改名", async () => {
    const onRenameSession = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SessionListPanel {...baseProps({ onRenameSession })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    await user.click(q("[data-pi-session-item-menu]")!);
    await user.click(await screen.findByText("重命名"));

    const input = q("[data-pi-session-item-rename-input]") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(onRenameSession).toHaveBeenCalledWith("s1", "Renamed"),
    );
    await waitFor(() => expect(screen.getByText("Renamed")).toBeInTheDocument());
  });

  it("空名提交 → 不调用 onRenameSession,保留原名(Req 3.4)", async () => {
    const onRenameSession = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SessionListPanel {...baseProps({ onRenameSession })} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    await user.click(q("[data-pi-session-item-menu]")!);
    await user.click(await screen.findByText("重命名"));

    const input = q("[data-pi-session-item-rename-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameSession).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
  });
});

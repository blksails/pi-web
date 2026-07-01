/**
 * SessionItemMenu + SessionRenameField(session-list-item-actions)。
 *
 * 覆盖:菜单展开三项(Req 1.3)、重命名/收藏/删除回调(Req 2.1/2.2/3.1/4.5)、删除二次确认
 * (确认才回调、取消不回调)、内联重命名 Enter 提交 / 空名不提交 / Esc 取消(Req 3.4/3.5)。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import * as React from "react";
import {
  SessionItemMenu,
  SessionRenameField,
} from "../../src/elements/session-item-menu.js";

afterEach(cleanup);

function menuProps(over: Partial<React.ComponentProps<typeof SessionItemMenu>> = {}) {
  return {
    sessionId: "s1",
    isFavorite: false,
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onToggleFavorite: vi.fn(),
    ...over,
  };
}

describe("SessionItemMenu", () => {
  it("opens the menu with rename / favorite / delete items", async () => {
    const user = userEvent.setup();
    render(<SessionItemMenu {...menuProps()} />);
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    expect(await screen.findByText("重命名")).toBeInTheDocument();
    expect(screen.getByText("收藏")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("shows 取消收藏 when already favorited and toggles to false", async () => {
    const onToggleFavorite = vi.fn();
    const user = userEvent.setup();
    render(<SessionItemMenu {...menuProps({ isFavorite: true, onToggleFavorite })} />);
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    await user.click(await screen.findByText("取消收藏"));
    expect(onToggleFavorite).toHaveBeenCalledWith("s1", false);
  });

  it("favorite toggles to true when not favorited", async () => {
    const onToggleFavorite = vi.fn();
    const user = userEvent.setup();
    render(<SessionItemMenu {...menuProps({ isFavorite: false, onToggleFavorite })} />);
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    await user.click(await screen.findByText("收藏"));
    expect(onToggleFavorite).toHaveBeenCalledWith("s1", true);
  });

  it("rename item calls onRename", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(<SessionItemMenu {...menuProps({ onRename })} />);
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    await user.click(await screen.findByText("重命名"));
    expect(onRename).toHaveBeenCalledWith("s1");
  });

  it("delete requires confirmation: confirm calls onDelete, cancel does not", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<SessionItemMenu {...menuProps({ onDelete })} />);

    // 打开菜单 → 点删除 → 弹确认(此时尚未调用 onDelete)。
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    await user.click(await screen.findByText("删除"));
    const confirm = document.querySelector(
      "[data-pi-session-item-delete-confirm-btn]",
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    expect(onDelete).not.toHaveBeenCalled();

    // 取消 → 不调用。
    const cancel = document.querySelector(
      "[data-pi-session-item-delete-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(onDelete).not.toHaveBeenCalled();

    // 再次打开 → 删除 → 确认 → 调用。
    await user.click(screen.getByRole("button", { name: "会话操作" }));
    await user.click(await screen.findByText("删除"));
    fireEvent.click(
      document.querySelector(
        "[data-pi-session-item-delete-confirm-btn]",
      ) as HTMLButtonElement,
    );
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});

describe("SessionRenameField", () => {
  function fieldProps(
    over: Partial<React.ComponentProps<typeof SessionRenameField>> = {},
  ) {
    return {
      sessionId: "s1",
      initialValue: "Old",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      ...over,
    };
  }

  it("submits a trimmed non-empty name on Enter", () => {
    const onSubmit = vi.fn();
    render(<SessionRenameField {...fieldProps({ onSubmit })} />);
    const input = document.querySelector(
      "[data-pi-session-item-rename-input]",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  New Name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("s1", "New Name");
  });

  it("does not submit a blank name (Enter → cancel, keeps original)", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRenameField {...fieldProps({ onSubmit, onCancel })} />);
    const input = document.querySelector(
      "[data-pi-session-item-rename-input]",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("s1");
  });

  it("cancels on Escape", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<SessionRenameField {...fieldProps({ onSubmit, onCancel })} />);
    const input = document.querySelector(
      "[data-pi-session-item-rename-input]",
    ) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledWith("s1");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

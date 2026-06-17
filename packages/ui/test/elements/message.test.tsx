import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { BranchInfo } from "@pi-web/react";
import { Message } from "../../src/elements/message.js";

/**
 * Message 消息气泡 + 分支切换控件测试(Req 8.1/8.3/8.4、11.4)。
 * 无状态展示元件:依 role 决定对齐/样式;存在多版本(branch.total>1)时渲染
 * "‹ N/M ›" 分支控件并触发 onPrev/onNext;无 branch / 单版本 / 不可用时不渲染控件;
 * 边界处禁用对应方向按钮;分支按钮带 aria-label。
 */
describe("Message 消息气泡与分支切换控件", () => {
  it("渲染消息内容(children)与 role 标记", () => {
    const { container } = render(<Message role="assistant">你好</Message>);
    expect(screen.getByText("你好")).toBeInTheDocument();
    const root = container.querySelector("[data-pi-message]");
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("data-pi-message-role", "assistant");
  });

  it("user 与 assistant 的 role 标记不同(决定对齐/样式)", () => {
    const { container: u } = render(<Message role="user">问</Message>);
    const { container: a } = render(<Message role="assistant">答</Message>);
    expect(
      u.querySelector("[data-pi-message]"),
    ).toHaveAttribute("data-pi-message-role", "user");
    expect(
      a.querySelector("[data-pi-message]"),
    ).toHaveAttribute("data-pi-message-role", "assistant");
  });

  it("多版本(total>1):渲染 N/M 指示与上一个/下一个按钮 (Req 8.1)", () => {
    const branch: BranchInfo = { entryId: "e1", index: 1, total: 3 };
    render(
      <Message role="assistant" branch={branch} onPrev={vi.fn()} onNext={vi.fn()}>
        答
      </Message>,
    );
    // "第 N / 共 M" 可读:index 从 0 起,显示第 2 / 共 3。
    expect(screen.getByText(/第\s*2\b/)).toBeInTheDocument();
    expect(screen.getByText(/共\s*3\b/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /上一个|上一版本|previous|prev/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /下一个|下一版本|next/i }),
    ).toBeInTheDocument();
  });

  it("点击上一个/下一个调用 onPrev/onNext (Req 8.1/8.3)", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const branch: BranchInfo = { entryId: "e1", index: 1, total: 3 };
    render(
      <Message role="assistant" branch={branch} onPrev={onPrev} onNext={onNext}>
        答
      </Message>,
    );
    await user.click(
      screen.getByRole("button", { name: /上一个|上一版本|previous|prev/i }),
    );
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /下一个|下一版本|next/i }),
    );
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("第一个版本(index=0):禁用上一个按钮,下一个可用 (边界)", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const branch: BranchInfo = { entryId: "e1", index: 0, total: 3 };
    render(
      <Message role="assistant" branch={branch} onPrev={onPrev} onNext={vi.fn()}>
        答
      </Message>,
    );
    const prev = screen.getByRole("button", {
      name: /上一个|上一版本|previous|prev/i,
    });
    expect(prev).toBeDisabled();
    await user.click(prev);
    expect(onPrev).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /下一个|下一版本|next/i }),
    ).not.toBeDisabled();
  });

  it("最后一个版本(index=total-1):禁用下一个按钮 (边界)", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const branch: BranchInfo = { entryId: "e1", index: 2, total: 3 };
    render(
      <Message role="assistant" branch={branch} onPrev={vi.fn()} onNext={onNext}>
        答
      </Message>,
    );
    const next = screen.getByRole("button", {
      name: /下一个|下一版本|next/i,
    });
    expect(next).toBeDisabled();
    await user.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("无 branch:不渲染分支控件 (Req 8.4)", () => {
    const { container } = render(<Message role="assistant">答</Message>);
    expect(container.querySelector("[data-pi-branch]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /上一个|previous|prev/i }),
    ).not.toBeInTheDocument();
  });

  it("单版本(total=1):不渲染分支控件 (Req 8.4)", () => {
    const branch: BranchInfo = { entryId: "e1", index: 0, total: 1 };
    const { container } = render(
      <Message role="assistant" branch={branch}>
        答
      </Message>,
    );
    expect(container.querySelector("[data-pi-branch]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /下一个|next/i }),
    ).not.toBeInTheDocument();
  });
});

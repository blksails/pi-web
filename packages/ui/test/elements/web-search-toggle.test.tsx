import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { WebSearchToggle } from "../../src/elements/web-search-toggle.js";

/**
 * WebSearchToggle 联网开关测试(Req 6.1/6.2、11.5)。
 *
 * 无状态受控元件:状态由父持有(enabled),本元件只受控显示 + 回传切换(onToggle)。
 * 默认场景由父传 enabled=false(默认关闭,Req 6.1);点击调 onToggle(!enabled)(Req 6.2);
 * aria-pressed 反映受控 enabled;支持 disabled 禁用。主题经 CSS 变量,无障碍 aria-label。
 */

describe("WebSearchToggle 联网开关", () => {
  it("默认关闭场景(父传 enabled=false):渲染按钮、aria-pressed=false、带 aria-label (Req 6.1/11.5)", () => {
    render(<WebSearchToggle enabled={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("aria-label");
  });

  it("受控 enabled=true 时 aria-pressed=true (Req 6.2)", () => {
    render(<WebSearchToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("点击时调 onToggle(true)(当前关闭→取反开启) (Req 6.2)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<WebSearchToggle enabled={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("点击时调 onToggle(false)(当前开启→取反关闭) (Req 6.2)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<WebSearchToggle enabled onToggle={onToggle} />);
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("受控特性:本元件不持有状态,点击后 aria-pressed 仍由 props 决定(父未更新则不变) (Req 6.2)", async () => {
    const user = userEvent.setup();
    render(<WebSearchToggle enabled={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    await user.click(button);
    // 父未回传新 enabled,故仍为 false(证明无内部状态)。
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("disabled 时按钮禁用且点击不调 onToggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<WebSearchToggle enabled={false} onToggle={onToggle} disabled />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("可选 label 用作无障碍标签", () => {
    render(
      <WebSearchToggle enabled={false} onToggle={vi.fn()} label="网络搜索" />,
    );
    expect(
      screen.getByRole("button", { name: "网络搜索" }),
    ).toBeInTheDocument();
  });
});

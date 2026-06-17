import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { SubmitButton } from "../../src/elements/submit-button.js";

/**
 * SubmitButton 四态渲染与回调测试(Req 2.1/2.2/2.3/2.4、1.3)。
 * 无状态元件:依 useChat status 与 canSubmit 切换发送/停止/错误态。
 */
describe("SubmitButton 状态化发送/停止按钮", () => {
  it("ready + canSubmit:可点发送按钮触发 onSubmit (Req 2.1)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <SubmitButton
        status="ready"
        canSubmit
        onSubmit={onSubmit}
        onStop={onStop}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-label");
    await user.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("ready + !canSubmit:禁用以阻止空提交 (Req 1.3)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SubmitButton
        status="ready"
        canSubmit={false}
        onSubmit={onSubmit}
        onStop={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("streaming:显示停止态,点击触发 onStop (Req 2.2/2.3)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <SubmitButton
        status="streaming"
        canSubmit={false}
        onSubmit={onSubmit}
        onStop={onStop}
      />,
    );
    const btn = screen.getByRole("button", { name: /停止|中断|stop/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submitted:同样显示停止态并可中断 (Req 2.2/2.3)", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <SubmitButton
        status="submitted"
        canSubmit={false}
        onSubmit={vi.fn()}
        onStop={onStop}
      />,
    );
    const btn = screen.getByRole("button", { name: /停止|中断|stop/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("error:显示可读错误态,允许重试发送 (Req 2.4)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SubmitButton
        status="error"
        canSubmit
        onSubmit={onSubmit}
        onStop={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    // 错误态可读(aria-label 含错误/重试语义)。
    expect(btn).toHaveAttribute("aria-label");
    expect(btn.getAttribute("aria-label")).toMatch(/错误|重试|retry|error/i);
    // 有可发送内容时允许重试(触发 onSubmit)。
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PromptInput } from "../../src/elements/prompt-input.js";

/**
 * PromptInput 富输入外壳测试(Req 1.1/1.2/1.3/1.4/1.5、11.5)。
 *
 * 无状态元件:受控 value/onChange/onSubmit;textarea 的 Enter 提交、Shift+Enter 换行、
 * 空内容禁用提交;提供动作菜单与子控件插槽位(由装配层 4.1 注入真实子控件)。
 */
describe("PromptInput 富输入外壳", () => {
  it("受控渲染:展示 textarea 与传入 value、可覆盖 placeholder (Req 1.1/1.5)", () => {
    const onChange = vi.fn();
    render(
      <PromptInput
        value="hello"
        onChange={onChange}
        onSubmit={vi.fn()}
        placeholder="自定义占位符"
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("hello");
    expect(textarea).toHaveAttribute("placeholder", "自定义占位符");
  });

  it("输入触发 onChange (Req 1.1)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PromptInput value="" onChange={onChange} onSubmit={vi.fn()} />,
    );
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "x");
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("Enter 提交并阻止默认换行,调 onSubmit (Req 1.2)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <PromptInput value="hi" onChange={onChange} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // 不应因 Enter 产生换行(不调用 onChange 追加 \n)。
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Shift+Enter 换行不提交 (Req 1.4)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptInput value="hi" onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("空内容按 Enter 不触发提交 (Req 1.3)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptInput value="" onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("仅空白内容按 Enter 不触发提交 (Req 1.3)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptInput value={"   \n  "} onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disabled 时按 Enter 不提交 (Req 1.3)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptInput
        value="hi"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        disabled
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
    textarea.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("渲染 toolbar/leftSlot/rightSlot 与 children 插槽位(由装配层注入子控件)(Req 1.1)", () => {
    render(
      <PromptInput
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        toolbar={<div data-testid="toolbar">toolbar</div>}
        leftSlot={<div data-testid="left">left</div>}
        rightSlot={<div data-testid="right">right</div>}
      >
        <div data-testid="children">children</div>
      </PromptInput>,
    );
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();
  });

  it("默认 placeholder 与 aria-label 可访问 (Req 11.5)", () => {
    render(<PromptInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("aria-label");
    expect(textarea).toHaveAttribute("placeholder");
  });
});

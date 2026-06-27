import { describe, it, expect, vi } from "vitest";
import * as React from "react";
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

  describe("光标接线 inputRef + onSelectionChange (completion-cursor-anchor R1.1)", () => {
    it("外部 inputRef 指向真实 textarea", () => {
      const ref = React.createRef<HTMLTextAreaElement>();
      render(
        <PromptInput
          value="hi"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          inputRef={ref}
        />,
      );
      expect(ref.current).toBe(screen.getByRole("textbox"));
    });

    it("输入时上报 selectionStart", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      function Controlled(): React.JSX.Element {
        const [v, setV] = React.useState("");
        return (
          <PromptInput
            value={v}
            onChange={setV}
            onSubmit={vi.fn()}
            onSelectionChange={onSelectionChange}
          />
        );
      }
      render(<Controlled />);
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "ab");
      // 末次上报为 selectionStart=2(光标在 "ab" 之后)。
      expect(onSelectionChange).toHaveBeenCalled();
      expect(onSelectionChange).toHaveBeenLastCalledWith(2);
    });

    it("点击/聚焦上报当前光标", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      render(
        <PromptInput
          value="hello"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onSelectionChange={onSelectionChange}
        />,
      );
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      await user.click(textarea);
      expect(onSelectionChange).toHaveBeenCalled();
    });
  });

  describe("suppressEnterSubmit 命令模式 Enter 让位 (Req 4.1/4.3/4.4)", () => {
    it("suppressEnterSubmit=true 时 Enter 不调用 onSubmit 且 preventDefault (Req 4.1)", () => {
      const onSubmit = vi.fn();
      const { getByRole } = render(
        <PromptInput
          value="/foo"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          suppressEnterSubmit
        />,
      );
      const textarea = getByRole("textbox");
      textarea.focus();
      const prevented = !textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(onSubmit).not.toHaveBeenCalled();
      expect(prevented).toBe(true);
    });

    it("suppressEnterSubmit=true 时 Shift+Enter 不调用 onSubmit (Req 4.4)", () => {
      const onSubmit = vi.fn();
      const { getByRole } = render(
        <PromptInput
          value="/foo"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          suppressEnterSubmit
        />,
      );
      const textarea = getByRole("textbox");
      textarea.focus();
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("suppressEnterSubmit=false(默认)时 Enter 照常调用 onSubmit (Req 4.3)", () => {
      const onSubmit = vi.fn();
      const { getByRole } = render(
        <PromptInput
          value="hello"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          suppressEnterSubmit={false}
        />,
      );
      const textarea = getByRole("textbox");
      textarea.focus();
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("suppressEnterSubmit prop 缺省时 Enter 照常调用 onSubmit (Req 4.3)", () => {
      const onSubmit = vi.fn();
      const { getByRole } = render(
        <PromptInput value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
      );
      const textarea = getByRole("textbox");
      textarea.focus();
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});

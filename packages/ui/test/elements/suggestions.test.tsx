import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Suggestions } from "../../src/elements/suggestions.js";
import type { Suggestion } from "@blksails/react";

/**
 * Suggestions 建议气泡测试(Req 10.1/10.2/10.3、11.4)。
 *
 * 无状态展示元件(不接 pi 数据):接收 items(Suggestion[],来自 useSuggestions)展示为
 * 气泡 button 列表(Req 10.1);点击按 mode 填入(fill→onFill(value))或发送(send→onSend(value))
 * (Req 10.2);items 为空返回 null 不渲染区域(Req 10.3)。气泡为可访问 button(Req 11.4)。
 */

const fillItem: Suggestion = {
  id: "cmd:help",
  label: "/help",
  value: "/help",
  mode: "fill",
};
const sendItem: Suggestion = {
  id: "preset:hi",
  label: "打个招呼",
  value: "你好",
  mode: "send",
};

describe("Suggestions 建议气泡", () => {
  it("渲染气泡列表:每个 item 渲染为可访问 button,显示 label (Req 10.1/11.4)", () => {
    render(
      <Suggestions items={[fillItem, sendItem]} onFill={vi.fn()} onSend={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "/help" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打个招呼" }),
    ).toBeInTheDocument();
  });

  it("点击 mode=fill 项:调 onFill(value) 且不调 onSend (Req 10.2)", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    const onSend = vi.fn();
    render(<Suggestions items={[fillItem]} onFill={onFill} onSend={onSend} />);
    await user.click(screen.getByRole("button", { name: "/help" }));
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledWith("/help");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("点击 mode=send 项:调 onSend(value) 且不调 onFill (Req 10.2)", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    const onSend = vi.fn();
    render(<Suggestions items={[sendItem]} onFill={onFill} onSend={onSend} />);
    await user.click(screen.getByRole("button", { name: "打个招呼" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("你好");
    expect(onFill).not.toHaveBeenCalled();
  });

  it("items 为空数组时返回 null 不渲染区域 (Req 10.3)", () => {
    const { container } = render(
      <Suggestions items={[]} onFill={vi.fn()} onSend={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatError } from "../../src/elements/chat-error.js";

/**
 * ChatError 错误提示元件测试(Req 1.2/2.4/4.2)。
 *
 * 无状态展示元件:`message` 为空(undefined 或空串)→ 不渲染(返回 null);
 * 非空 → 以 destructive 配色 + role="alert" 展示该 message 文本。
 */

afterEach(() => {
  cleanup();
});

describe("ChatError 错误提示元件", () => {
  it("message 为 undefined 时不渲染 (Req 4.2)", () => {
    const { container } = render(<ChatError message={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("message 为空串时不渲染 (Req 4.2)", () => {
    const { container } = render(<ChatError message="" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("message 非空时渲染 role=alert 且文本为该 message (Req 1.2/2.4)", () => {
    render(<ChatError message="连接已断开" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("连接已断开");
  });
});

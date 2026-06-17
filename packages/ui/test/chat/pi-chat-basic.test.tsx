import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiChatBasic } from "../../src/chat/pi-chat-basic.js";
import {
  mockSession,
  mockControls,
  mockExtensionUI,
  selectRequest,
} from "../fixtures/mock-session.js";

describe("PiChatBasic 装配", () => {
  it("渲染消息区与输入区", () => {
    render(<PiChatBasic session={mockSession()} showControls={false} />);
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("showControls 时渲染内置控制面板", () => {
    render(
      <PiChatBasic
        session={mockSession()}
        controls={mockControls()}
        showControls
      />,
    );
    expect(
      screen.getByRole("combobox", { name: /select model/i }),
    ).toBeInTheDocument();
  });

  it("extensionUI.current 存在时弹出权限弹窗", () => {
    render(
      <PiChatBasic
        session={mockSession()}
        extensionUI={mockExtensionUI({ current: selectRequest() })}
        showControls={false}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("渲染 header/footer/sidebar/messageActions 插槽", () => {
    render(
      <PiChatBasic
        session={mockSession()}
        showControls={false}
        slots={{
          header: <div data-testid="hdr">HEADER</div>,
          footer: <div data-testid="ftr">FOOTER</div>,
          sidebar: <div data-testid="sb">SIDEBAR</div>,
          messageActions: () => <div>actions</div>,
        }}
      />,
    );
    expect(screen.getByTestId("hdr")).toBeInTheDocument();
    expect(screen.getByTestId("ftr")).toBeInTheDocument();
    expect(screen.getByTestId("sb")).toBeInTheDocument();
  });

  it("缺省插槽不报错", () => {
    expect(() =>
      render(<PiChatBasic session={mockSession()} showControls={false} />),
    ).not.toThrow();
    expect(screen.queryByTestId("hdr")).not.toBeInTheDocument();
  });
});

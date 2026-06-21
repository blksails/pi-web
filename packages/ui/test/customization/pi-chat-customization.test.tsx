import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession } from "../fixtures/mock-session.js";
import type { WebExtension } from "@pi-web/web-kit";

function withMessages(msgs: UIMessage[]) {
  return mockSession({
    initialMessages: msgs,
  } as Partial<ReturnType<typeof mockSession>>);
}

function textMsg(id: string, role: string, text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] } as unknown as UIMessage;
}

beforeEach(() => vi.clearAllMocks());

describe("components 细粒度覆盖 (Req 5.1/10.1)", () => {
  it("自定义 SubmitButton 替换默认(空态输入区)", () => {
    render(
      <PiChat
        session={mockSession()}
        components={{
          SubmitButton: () => <button data-testid="custom-submit">go</button>,
        }}
      />,
    );
    expect(screen.getByTestId("custom-submit")).toBeInTheDocument();
  });

  it("按 role 覆盖 user,assistant 回退默认 (Req 5.3)", () => {
    render(
      <PiChat
        session={withMessages([
          textMsg("u1", "user", "hi"),
          textMsg("a1", "assistant", "hello"),
        ])}
        components={{
          Message: {
            user: ({ children }) => (
              <div data-testid="custom-user">{children}</div>
            ),
          },
        }}
      />,
    );
    expect(screen.getByTestId("custom-user")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("自定义 Reasoning 替换默认思考块 (Req 5.1)", () => {
    const reasoningMsg = {
      id: "r1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "secret thought", state: "done" }],
    } as unknown as UIMessage;
    render(
      <PiChat
        session={withMessages([reasoningMsg])}
        components={{
          Reasoning: ({ part }) => (
            <div data-testid="custom-reasoning">{part.text}</div>
          ),
        }}
      />,
    );
    expect(screen.getByTestId("custom-reasoning")).toBeInTheDocument();
  });

  it("null 移除可选控件 (Req 5.4/6.4)", () => {
    render(
      <PiChat session={mockSession()} components={{ SpeechInput: null }} />,
    );
    expect(document.querySelector("[data-pi-speech-input]")).toBeNull();
    expect(document.querySelector("[data-pi-speech-unsupported]")).toBeNull();
  });
});

describe("slots 扩展 (Req 4.1/4.2/9.1)", () => {
  it("slots.background 渲染于背景层", () => {
    render(
      <PiChat
        session={mockSession()}
        slots={{ background: <div data-testid="bg" /> }}
      />,
    );
    expect(document.querySelector("[data-pi-chat-background]")).not.toBeNull();
    expect(screen.getByTestId("bg")).toBeInTheDocument();
  });

  it("slots.empty 替换空态", () => {
    render(
      <PiChat
        session={mockSession()}
        slots={{ empty: <div data-testid="my-empty" /> }}
      />,
    );
    expect(screen.getByTestId("my-empty")).toBeInTheDocument();
  });

  it("slots.background 优先于 components.ConversationBackground (Req 9.1)", () => {
    render(
      <PiChat
        session={mockSession()}
        slots={{ background: <div data-testid="slot-bg" /> }}
        components={{
          ConversationBackground: () => <div data-testid="comp-bg" />,
        }}
      />,
    );
    expect(screen.getByTestId("slot-bg")).toBeInTheDocument();
    expect(screen.queryByTestId("comp-bg")).toBeNull();
  });
});

describe("layout 预设 (Req 7.2/10.4)", () => {
  it("wide 改变消息容器宽度类", () => {
    render(
      <PiChat
        session={withMessages([textMsg("a1", "assistant", "hi")])}
        layout="wide"
      />,
    );
    const container = document.querySelector("[data-pi-chat-messages]");
    expect(container?.className).toContain("max-w-5xl");
  });

  it("split 无让位区内容时不渲染空 aside(避免右侧空白浮动区域)", () => {
    // 仅设 layout="split" 而无 panelRight/artifact 等让位区内容:不应留出空 aside,
    // 否则 lg 视口下右侧出现一整列 384px 空白、内容被挤向左(回归:声明式扩展 split 空白)。
    render(<PiChat session={mockSession()} layout="split" />);
    expect(document.querySelector("[data-pi-chat-aside]")).toBeNull();
  });

  it("split + panelRight 让位区内容时渲染 aside", () => {
    const ext: WebExtension = {
      manifestId: "split-with-panel",
      slots: { panelRight: <div data-testid="split-panel" /> },
    };
    render(<PiChat session={mockSession()} layout="split" extension={ext} />);
    expect(document.querySelector("[data-pi-chat-aside]")).not.toBeNull();
    expect(screen.getByTestId("split-panel")).toBeInTheDocument();
  });
});

describe("icons 主题 (Req 8.1/8.3)", () => {
  it("替换发送图标且保留 aria-label", () => {
    render(
      <PiChat
        session={mockSession()}
        icons={{ send: () => <svg data-testid="brand-send" /> }}
      />,
    );
    expect(screen.getByTestId("brand-send")).toBeInTheDocument();
    expect(screen.getByLabelText("发送")).toBeInTheDocument();
  });
});

describe("向后兼容回归 (Req 1.1/10.5)", () => {
  it("不传任何新增定制入口时渲染默认外观", () => {
    render(
      <PiChat session={withMessages([textMsg("a1", "assistant", "hi")])} />,
    );
    expect(document.querySelector("[data-pi-chat-pro]")).not.toBeNull();
    expect(
      document.querySelector("[data-pi-chat-messages]")?.className,
    ).toContain("max-w-3xl");
    expect(screen.getByLabelText("发送")).toBeInTheDocument();
  });
});

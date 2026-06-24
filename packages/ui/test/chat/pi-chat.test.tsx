import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import {
  mockSession,
  mockControls,
  MockTransport,
} from "../fixtures/mock-session.js";

/**
 * PiChat(富装配,默认组件)集成冒烟测试(任务 4.1)。
 *
 * 覆盖:渲染富界面、发送文本(可含图片附件)消息、停止态点击触发 abort + stop、
 * 模型/建议/附件/分支控件的存在与交互、source data-part 渲染器注册、联网开关。
 *
 * 不触达真实后端;mock session/transport/controls 形状来自 @blksails/pi-web-react。
 */

describe("PiChat 装配(富)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染富界面:输入区(textarea)、发送按钮、联网开关、附件入口", () => {
    render(<PiChat session={mockSession()} controls={mockControls()} />);
    // 富 PromptInput textarea (Req 1.1)
    expect(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
    ).toBeInTheDocument();
    // 发送态按钮 (Req 2.1)
    expect(
      screen.getByRole("button", { name: /发送/ }),
    ).toBeInTheDocument();
    // 联网开关 (Req 6.1)
    expect(
      screen.getByRole("button", { name: /联网/ }),
    ).toBeInTheDocument();
    // 附件入口:工具条内 compact paperclip 按钮 (Req 3.1)
    expect(
      screen.getByRole("button", { name: /添加图片附件|附件|attach/i }),
    ).toBeInTheDocument();
  });

  it("空内容时发送按钮禁用,输入后启用 (Req 1.3)", async () => {
    const user = userEvent.setup();
    render(<PiChat session={mockSession()} controls={mockControls()} />);
    const send = screen.getByRole("button", { name: /发送/ });
    expect(send).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
      "hi",
    );
    expect(send).not.toBeDisabled();
  });

  it("输入文本并点击发送 → transport.sendMessages 被调用并携带文本 (Req 1.2)", async () => {
    const user = userEvent.setup();
    const transport = new MockTransport([
      { type: "start", messageId: "a1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "ok" },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]);
    const sendSpy = vi.spyOn(transport, "sendMessages");
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });
    render(<PiChat session={session} controls={mockControls()} />);
    const textarea = screen.getByRole("textbox", {
      name: /消息输入|message/i,
    });
    await user.type(textarea, "hello pi");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    const arg = (sendSpy.mock.calls[0] as unknown[])[0] as {
      messages: UIMessage[];
    };
    const lastUser = [...arg.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(text).toContain("hello pi");
  });

  it("带图片附件发送 → sendMessage body.images 经 transport 传入 (Req 3.2)", async () => {
    const user = userEvent.setup();
    const transport = new MockTransport([{ type: "finish" }]);
    const sendSpy = vi.spyOn(transport, "sendMessages");
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });
    const { container } = render(
      <PiChat session={session} controls={mockControls()} />,
    );

    // 经 file input 添加一张图片(useAttachments 编码为 dataUrl)。
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["imgdata"], "shot.png", { type: "image/png" });
    await user.upload(input, file);
    // chip 出现
    await screen.findByText("shot.png");

    await user.type(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
      "look",
    );
    await user.click(screen.getByRole("button", { name: /发送/ }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    const opts = (sendSpy.mock.calls[0] as unknown[])[0] as {
      body?: { images?: unknown[] };
    };
    expect(opts.body?.images).toBeDefined();
    expect(opts.body?.images?.length).toBe(1);
  });

  it("添加附件触发异步上传 → 提交携带正式 id 引用(attachmentIds)且保留 base64 images,不内联落库字节 (Req 5.3/3.5)", async () => {
    const user = userEvent.setup();
    const transport = new MockTransport([{ type: "finish" }]);
    const sendSpy = vi.spyOn(transport, "sendMessages");
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });

    // 注入 mock 上传:断言「添加触发上传」,并回传 server 铸造的正式公开 id 与展示 URL。
    const uploadAttachment = vi.fn(async (_b: string, _s: string, f: File) => ({
      attachment: {
        id: "att_minted123",
        name: f.name,
        mimeType: f.type,
        size: 7,
        origin: "upload" as const,
        sessionId: "sess-1",
        createdAt: "2026-06-21T00:00:00.000Z",
      },
      displayUrl: "/api/attachments/att_minted123/raw?exp=1&sig=abc",
    }));

    const { container } = render(
      <PiChat
        session={session}
        controls={mockControls()}
        uploadAttachment={uploadAttachment}
      />,
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["imgdata"], "shot.png", { type: "image/png" });
    await user.upload(input, file);

    // 添加 → 触发上传(异步上传 mock 被调用)。
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    await screen.findByText("shot.png");

    await user.type(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
      "look",
    );
    await user.click(screen.getByRole("button", { name: /发送/ }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    const opts = (sendSpy.mock.calls[0] as unknown[])[0] as {
      body?: { images?: unknown[]; attachmentIds?: unknown[] };
    };
    // 提交携带正式 id 引用(server 铸造的 att_…),不内联落库字节为身份。
    expect(opts.body?.attachmentIds).toEqual(["att_minted123"]);
    // 现状 vision base64 链路不回归:仍携带 images(裸 base64)。
    expect(opts.body?.images).toBeDefined();
    expect(opts.body?.images?.length).toBe(1);
  });

  it("会话就绪后调用 controls.getCommands 以填充建议 (Req 10.1)", async () => {
    const controls = mockControls();
    render(<PiChat session={mockSession()} controls={controls} />);
    await waitFor(() =>
      expect(controls.getCommands).toHaveBeenCalled(),
    );
  });

  it("建议气泡随 commands 渲染并点击填入输入框 (Req 10.2)", async () => {
    const user = userEvent.setup();
    const controls = mockControls({
      commands: [
        {
          name: "help",
          description: "Show help",
          source: "prompt",
          sourceInfo: {
            path: "/tmp",
            source: "builtin",
            scope: "project",
            origin: "top-level",
          },
        },
      ],
    });
    render(<PiChat session={mockSession()} controls={controls} />);
    const bubble = await screen.findByRole("button", { name: "/help" });
    await user.click(bubble);
    const textarea = screen.getByRole("textbox", {
      name: /消息输入|message/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toContain("/help");
  });

  it("流式态显示停止按钮,点击触发 controls.abort + useChat stop (Req 2.2/2.3)", async () => {
    const user = userEvent.setup();
    // 永不收束的脚本:进入 streaming 后保持。
    const transport = new MockTransport();
    transport.sendMessages = vi.fn(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "start", messageId: "a1" });
            controller.enqueue({ type: "text-start", id: "t1" });
            controller.enqueue({ type: "text-delta", id: "t1", delta: "..." });
            // 不 close,保持 streaming
          },
        }),
    ) as unknown as MockTransport["sendMessages"];
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });
    const controls = mockControls();
    render(<PiChat session={session} controls={controls} />);

    await user.type(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
      "go",
    );
    await user.click(screen.getByRole("button", { name: /发送/ }));

    const stop = await screen.findByRole("button", { name: /停止/ });
    await user.click(stop);
    await waitFor(() => expect(controls.abort).toHaveBeenCalledTimes(1));
  });

  it("经 registry 注册 source data-part 渲染器并渲染来源 (Req 9.3)", () => {
    const registry = createRendererRegistry();
    const transport = new MockTransport();
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });
    render(
      <PiChat
        session={session}
        controls={mockControls()}
        registry={registry}
      />,
    );
    // 装配应已向注入的 registry 注册 source data-part 渲染器。
    expect(registry.resolveDataPartRenderer("data-source")).toBeDefined();
  });

  it("透传 placeholder / className / slots", () => {
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        placeholder="问点什么…"
        className="custom-pro"
        slots={{ header: <div data-testid="hdr">H</div> }}
      />,
    );
    expect(screen.getByTestId("hdr")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("问点什么…"),
    ).toBeInTheDocument();
  });

  it("无 controls 时不报错(优雅降级)", () => {
    expect(() =>
      render(<PiChat session={mockSession()} />),
    ).not.toThrow();
  });
});

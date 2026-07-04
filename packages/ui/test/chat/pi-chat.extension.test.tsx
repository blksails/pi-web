import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as React from "react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import {
  mockSession,
  mockControls,
  MockTransport,
} from "../fixtures/mock-session.js";
import type { WebExtension, ConversationAccess } from "@blksails/pi-web-kit";

/**
 * PiChat 接入 WebExtension(任务 5.2):
 * - Tier1 区域插槽(panelRight/headerCenter)渲染在 chat 内指定位置;
 * - Tier2 渲染器并入 registry(extId 命名空间);
 * - 无 extension 时行为不变(向后兼容)。
 */
describe("PiChat × WebExtension", () => {
  it("渲染扩展声明的 panelRight 与 headerCenter 到指定区域", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: {
        panelRight: <div data-testid="ext-panel">领域面板</div>,
        headerCenter: <div data-testid="ext-header">标题</div>,
      },
    };
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} extension={ext} />,
    );
    expect(screen.getByTestId("ext-panel")).toHaveTextContent("领域面板");
    expect(screen.getByTestId("ext-header")).toHaveTextContent("标题");
    expect(container.querySelector("[data-pi-ext-panel-right]")).not.toBeNull();
  });

  it("扩展 Tier2 渲染器并入提供的 registry(extId 命名空间)", () => {
    const reg = createRendererRegistry();
    function CardRenderer(): null {
      return null;
    }
    const ext: WebExtension = {
      manifestId: "acme",
      renderers: { dataParts: { "data-card": CardRenderer } },
    };
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        registry={reg}
        extension={ext}
      />,
    );
    expect(reg.resolveDataPartRenderer("data-card")).toBe(CardRenderer);
  });

  it("无 extension 时不渲染扩展区域(向后兼容)", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} />,
    );
    expect(container.querySelector("[data-pi-ext-panel-right]")).toBeNull();
    expect(container.querySelector("[data-pi-ext-header]")).toBeNull();
  });

  it("panelRight 比例:初始 3:7 + 运行时切换 居中/2:1/3:7", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { panelRight: <div data-testid="ext-panel">领域面板</div> },
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    const aside = container.querySelector("[data-pi-chat-aside]");
    const sw = container.querySelector("[data-pi-panel-ratio-switch]");
    // 初始 3:7:aside 宽度 70%,切换器反映当前档位。
    expect(aside?.getAttribute("data-pi-panel-ratio")).toBe("3:7");
    expect((aside as HTMLElement).style.width).toBe("70%");
    expect(sw?.getAttribute("data-pi-panel-ratio-switch")).toBe("3:7");

    // 切到 2:1:宽度 33.333%。
    fireEvent.click(screen.getByText("2:1"));
    const aside21 = container.querySelector("[data-pi-chat-aside]") as HTMLElement;
    expect(aside21.getAttribute("data-pi-panel-ratio")).toBe("2:1");
    expect(aside21.style.width).toBe("33.333%");

    // 切到 居中:收起 aside(panelRight 不渲染),但切换器仍在场可切回。
    fireEvent.click(screen.getByText("居中"));
    expect(container.querySelector("[data-pi-chat-aside]")).toBeNull();
    expect(container.querySelector("[data-pi-ext-panel-right]")).toBeNull();
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).not.toBeNull();

    // 从 居中 切回 3:7:panelRight 重新挂载。
    fireEvent.click(screen.getByText("3:7"));
    expect(screen.getByTestId("ext-panel")).toBeInTheDocument();
  });

  it("无 panelRight 时不渲染比例切换器", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { headerCenter: <div data-testid="ext-header">标题</div> },
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).toBeNull();
  });
});

/**
 * PiChat 会话能力注入:conversation 能力对象 + 过渡别名 onSubmitPrompt(契约 §4.2,Req 6)。
 *
 * 断言两者由宿主经 SlotHost 同时注入 panelRight 组件,且共用同一 doSend 底座——以 transport
 * 观测两条注入项的可见产物等价(6.2),并覆盖 doSend 的显式 attachmentIds 合并/去重语义(6.4)。
 *
 * 说明:pi-chat 的 doSend 是内部闭包,不便直接单测;故在 PiChat 装配层以「注入项 → 可见的
 * transport.sendMessages 产物」间接观测其行为(与 pi-chat.test.tsx 既有 send 观测同范式)。
 */
describe("PiChat 会话能力注入与别名等价 (Req 6)", () => {
  /** 捕获宿主注入给 slot 组件的会话能力与过渡别名(供测试后续触发/比对)。 */
  interface Captured {
    conversation?: ConversationAccess;
    onSubmitPrompt?: (text: string) => void;
    mounts: number;
  }

  /** 造一个把注入 props 外泄到 sink 的 panelRight 扩展(生产范式 `as never` 挂载)。 */
  function captureExt(sink: Captured): WebExtension {
    function CapturePanel(props: {
      conversation?: ConversationAccess;
      onSubmitPrompt?: (text: string) => void;
    }): React.JSX.Element {
      sink.conversation = props.conversation;
      sink.onSubmitPrompt = props.onSubmitPrompt;
      sink.mounts += 1;
      return <div data-testid="capture-panel" />;
    }
    return { manifestId: "acme", slots: { panelRight: CapturePanel as never } };
  }

  /** MockTransport + spy 装配一个 PiChat,返回 sink 与 sendSpy。 */
  function renderWithCapture(): {
    sink: Captured;
    sendSpy: ReturnType<typeof vi.spyOn>;
  } {
    const transport = new MockTransport([{ type: "finish" }]);
    const sendSpy = vi.spyOn(transport, "sendMessages");
    const session = mockSession({
      transport: transport as unknown as ReturnType<
        typeof mockSession
      >["transport"],
    });
    const sink: Captured = { mounts: 0 };
    render(
      <PiChat
        session={session}
        controls={mockControls()}
        extension={captureExt(sink)}
      />,
    );
    return { sink, sendSpy };
  }

  /** 从一次 sendMessages 调用参数取末条 user 文本(镜像 pi-chat.test.tsx 提取)。 */
  function userTextOf(call: unknown[] | undefined): string {
    const arg = (call?.[0] ?? { messages: [] }) as {
      messages: { role: string; parts: { type: string; text?: string }[] }[];
    };
    const lastUser = [...arg.messages].reverse().find((m) => m.role === "user");
    return (lastUser?.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  /** 从一次 sendMessages 调用参数取 body(含可选 attachmentIds)。 */
  function bodyOf(
    call: unknown[] | undefined,
  ): { attachmentIds?: unknown[] } | undefined {
    return (call?.[0] as { body?: { attachmentIds?: unknown[] } } | undefined)
      ?.body;
  }

  it("宿主同时注入 conversation 能力对象与过渡别名 onSubmitPrompt (Req 6.1/6.2)", () => {
    const { sink } = renderWithCapture();
    // slot 组件确已挂载(panelRight 默认展示)。
    expect(screen.getByTestId("capture-panel")).toBeInTheDocument();
    // 两条注入项同时到达:能力对象(带 submitUserMessage)+ 过渡别名回调。
    expect(sink.conversation).toBeDefined();
    expect(typeof sink.conversation?.submitUserMessage).toBe("function");
    expect(typeof sink.onSubmitPrompt).toBe("function");
  });

  it("别名 onSubmitPrompt 与 conversation.submitUserMessage 同底座:可见产物等价 (Req 6.2)", async () => {
    const { sink, sendSpy } = renderWithCapture();

    // 先经过渡别名发一条。
    await act(async () => {
      sink.onSubmitPrompt?.("同一句话");
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));

    // 再经能力对象发同一句。
    await act(async () => {
      sink.conversation?.submitUserMessage("同一句话");
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));

    // 两条注入项各触发一次 doSend,产出的 user 文本与 body 完全一致(共用底座)。
    expect(userTextOf(sendSpy.mock.calls[0])).toBe("同一句话");
    expect(userTextOf(sendSpy.mock.calls[1])).toBe(
      userTextOf(sendSpy.mock.calls[0]),
    );
    expect(bodyOf(sendSpy.mock.calls[0])).toBeUndefined();
    expect(bodyOf(sendSpy.mock.calls[1])).toBeUndefined();
  });

  it("doSend 显式 attachmentIds 透传进 body;无 opts 路径不带 attachmentIds (Req 6.4)", async () => {
    const { sink, sendSpy } = renderWithCapture();

    // 无 opts:body 不含 attachmentIds(与本 spec 前行为一致,零回归)。
    await act(async () => {
      sink.conversation?.submitUserMessage("纯文本");
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    expect(bodyOf(sendSpy.mock.calls[0])).toBeUndefined();

    // 显式 ids(composer 无引用):合并追加即显式集本身,透传进 body.attachmentIds。
    await act(async () => {
      sink.conversation?.submitUserMessage("带引用", {
        attachmentIds: ["att_a", "att_b"],
      });
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
    expect(bodyOf(sendSpy.mock.calls[1])?.attachmentIds).toEqual([
      "att_a",
      "att_b",
    ]);
  });

  it("显式 ids 自身内部重复原样透传(去重仅针对 composer 引用,调用方负责自去重) (Req 6.4 锚)", async () => {
    const { sink, sendSpy } = renderWithCapture();
    // composerIds 为空 → filter 不剔除任何显式项 → 显式集内的重复原样保留。
    await act(async () => {
      sink.conversation?.submitUserMessage("重复引用", {
        attachmentIds: ["att_1", "att_1"],
      });
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    expect(bodyOf(sendSpy.mock.calls[0])?.attachmentIds).toEqual([
      "att_1",
      "att_1",
    ]);
  });

  it("空文本 + 显式 ids 但 composer 无附件 → 命中既有早退,不发消息 (Req 6.4 锚·现状固化)", async () => {
    const { sink, sendSpy } = renderWithCapture();
    // 显式 attachmentIds 不足以"救活"空提交:hasAttachments 只看 composer,空文本 + 空 composer → 早退。
    await act(async () => {
      sink.conversation?.submitUserMessage("", {
        attachmentIds: ["att_x"],
      });
    });
    // 给异步一个机会:确认始终未触达 transport(而非尚未触达)。
    await Promise.resolve();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

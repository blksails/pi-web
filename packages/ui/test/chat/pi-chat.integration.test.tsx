import type * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { UIMessage, ChatStatus } from "ai";
import type {
  UseModelsResult,
  UseAttachmentsResult,
  UseBranchesResult,
  UseSuggestionsResult,
  UseExtensionUIResult,
  ModelGroup,
  BranchInfo,
  Suggestion,
  PendingAttachment,
  ExtensionNotification,
  ExtensionWidget,
} from "@pi-web/react";

/**
 * PiChat 富交互集成测试(任务 5.2)。
 *
 * 与任务 4.1 的装配冒烟测试(真实 hooks + MockTransport)互补:这里按 design.md
 * 「Testing Strategy → Integration Tests」(「mock hooks」)mock `@ai-sdk/react` 的
 * useChat 与 `@pi-web/react` 数据 hooks,以**可控**地驱动 4.1 难以到达的富交互:
 *  - 模型选择器:打开(onOpen→ensureLoaded)/搜索过滤/选择(onSelect→useModels.select)(Req 4.2)
 *  - 分支控件:多版本时 Message 显示「第 N / 共 M」+ 切换调 useBranches.select(Req 8.1)
 *  - 思考折叠随流式增量:reasoning part state streaming→complete + text 增量实时反映(Req 9.1/9.2)
 *  - 来源折叠:source data-part 经注册的 Sources 渲染器折叠/展开(Req 9.3)
 *  - 附件 chip 增删(UI 层):useAttachments 提供 items → chip 渲染 + 移除回调(Req 3.1)
 *  - SubmitButton 随 useChat status 切换(ready/submitted/streaming/error)(Req 2.1/2.3)
 *  - 建议点击填入 + 提交文本(Req 10.2 / 1.2)
 *  - a11y:模型选择器 listbox / 分支按钮 aria-label / 折叠 aria-expanded(Req 11.4)
 *
 * mock 不触达真实后端;hook 形状取自 @pi-web/react 公共类型。
 */

// ---- useChat mock(可在每个用例前重置返回值) -------------------------------

/** sendMessage 的最小观测形状(PiChat 传 { text } 与可选 { body })。 */
interface SendMessageArg {
  readonly text?: string;
}
const sendMessageMock = vi.fn(
  async (_message?: SendMessageArg, _options?: unknown): Promise<void> =>
    undefined,
);
const stopMock = vi.fn(() => undefined);

interface ChatState {
  messages: UIMessage[];
  status: ChatStatus;
}

let chatState: ChatState = { messages: [], status: "ready" };

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatState.messages,
    status: chatState.status,
    sendMessage: sendMessageMock,
    stop: stopMock,
    // PiChat 仅用 messages/sendMessage/status/stop;其余以宽松占位满足类型。
    id: "chat-mock",
    error: undefined,
    setMessages: vi.fn(),
    regenerate: vi.fn(),
    resumeStream: vi.fn(),
    addToolResult: vi.fn(),
    addToolOutput: vi.fn(),
    clearError: vi.fn(),
  }),
}));

// ---- @pi-web/react hooks mock(逐用例覆盖返回值) ---------------------------

const ensureLoadedMock = vi.fn(async () => undefined);
const modelSelectMock = vi.fn(async () => undefined);
const branchSelectMock = vi.fn(async () => undefined);
const branchCreateMock = vi.fn(async () => undefined);
const attachRemoveMock = vi.fn(() => undefined);

let modelsResult: UseModelsResult;
let attachmentsResult: UseAttachmentsResult;
let branchesResult: UseBranchesResult;
let suggestionsResult: UseSuggestionsResult;

vi.mock("@pi-web/react", () => ({
  useModels: (): UseModelsResult => modelsResult,
  useAttachments: (): UseAttachmentsResult => attachmentsResult,
  useBranches: (): UseBranchesResult => branchesResult,
  useSuggestions: (): UseSuggestionsResult => suggestionsResult,
}));

// 被测组件须在 mock 声明之后导入(vi.mock 被提升,故静态导入亦安全;
// 显式延后引入以表达依赖顺序)。
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";

// ---- 默认 hook 结果工厂 -----------------------------------------------------

function makeModels(over: Partial<UseModelsResult> = {}): UseModelsResult {
  return {
    groups: [],
    current: undefined,
    available: false,
    pending: false,
    error: undefined,
    ensureLoaded: ensureLoadedMock,
    select: modelSelectMock,
    ...over,
  };
}

function makeAttachments(
  over: Partial<UseAttachmentsResult> = {},
): UseAttachmentsResult {
  return {
    items: [],
    supported: true,
    add: vi.fn(async () => ({ rejected: [] })),
    remove: attachRemoveMock,
    clear: vi.fn(() => undefined),
    toImageContents: vi.fn(() => []),
    ...over,
  };
}

function makeBranches(over: Partial<UseBranchesResult> = {}): UseBranchesResult {
  return {
    available: true,
    branchOf: () => undefined,
    createBranch: branchCreateMock,
    select: branchSelectMock,
    pending: false,
    error: undefined,
    ...over,
  };
}

function makeSuggestions(
  over: Partial<UseSuggestionsResult> = {},
): UseSuggestionsResult {
  return { items: [], pending: false, ...over };
}

const dismissNotificationMock = vi.fn((_id: string) => undefined);

/** ambient extensionUI 结果工厂(推送类切片默认空,可逐用例覆盖)。 */
function mockExtensionUI(
  over: Partial<UseExtensionUIResult> = {},
): UseExtensionUIResult {
  return {
    queue: [],
    current: undefined,
    respond: vi.fn(async () => undefined),
    error: undefined,
    pending: false,
    notifications: [],
    statuses: {},
    widgets: {},
    title: undefined,
    editorText: undefined,
    dismissNotification: dismissNotificationMock,
    ...over,
  };
}

// 一个最小的会话 prop:PiChat 仅读 transport/sessionId/client 接线 hooks;
// 这些 hooks 已被 mock,故此处只需结构占位。
function fakeSession(): React.ComponentProps<typeof PiChat>["session"] {
  return {
    sessionId: "sess-1",
    status: "open",
    transport: {} as React.ComponentProps<
      typeof PiChat
    >["session"]["transport"],
    connection: undefined,
    client: undefined,
    error: undefined,
    start: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatState = { messages: [], status: "ready" };
  modelsResult = makeModels();
  attachmentsResult = makeAttachments();
  branchesResult = makeBranches();
  suggestionsResult = makeSuggestions();
});

describe("PiChat 富交互(mock hooks)", () => {
  // -- 模型选择器:打开 / 搜索 / 选择 (Req 4.2, 11.4) -----------------------
  it("模型选择器打开触发 ensureLoaded,搜索过滤,选择触发 useModels.select", async () => {
    const user = userEvent.setup();
    const groups: ModelGroup[] = [
      {
        provider: "openai",
        models: [
          { provider: "openai", modelId: "gpt-4o", label: "GPT-4o" },
          { provider: "openai", modelId: "gpt-4o-mini", label: "GPT-4o mini" },
        ],
      },
      {
        provider: "anthropic",
        models: [
          { provider: "anthropic", modelId: "claude-3", label: "Claude 3" },
        ],
      },
    ];
    modelsResult = makeModels({ available: true, groups });

    render(<PiChat session={fakeSession()} />);

    // 会话就绪即主动加载一次(修复后);onOpen 仍可再次触发(幂等,不破坏)。
    const beforeOpen = ensureLoadedMock.mock.calls.length;
    expect(beforeOpen).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "模型" }));
    expect(ensureLoadedMock.mock.calls.length).toBeGreaterThan(beforeOpen);

    // 打开后 listbox 出现,三个模型项可见(a11y:role=option)。
    const list = screen.getByRole("listbox", { name: "模型" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);

    // 搜索 "claude" → 仅 anthropic 组的 Claude 3 命中。
    await user.type(screen.getByRole("searchbox"), "claude");
    const filtered = screen.getByRole("listbox", { name: "模型" });
    const opts = within(filtered).getAllByRole("option");
    expect(opts).toHaveLength(1);
    const claudeOption = within(filtered).getByRole("option", {
      name: /Claude 3/,
    });

    // 选择 → onSelect 透传 provider/modelId 给 useModels.select。
    await user.click(claudeOption);
    expect(modelSelectMock).toHaveBeenCalledWith("anthropic", "claude-3");
    // 选择后面板关闭。
    expect(
      screen.queryByRole("listbox", { name: "模型" }),
    ).not.toBeInTheDocument();
  });

  it("会话就绪后主动调用 models.ensureLoaded(无需先点开选择器,Req 4.1)", async () => {
    // 缺陷回归:available 初始为 false 时选择器隐藏,唯一触发 ensureLoaded 的
    // onOpen 永不可达 → 死锁。修复后装配应在会话就绪时主动拉取模型。
    const { waitFor } = await import("@testing-library/react");
    // 不点击任何东西:仅挂载即应触发一次主动加载。
    modelsResult = makeModels({ available: false });
    render(<PiChat session={fakeSession()} />);
    await waitFor(() => expect(ensureLoadedMock).toHaveBeenCalledTimes(1));
  });

  it("无 sessionId 时不主动调用 ensureLoaded(会话未就绪)", () => {
    modelsResult = makeModels({ available: false });
    const session = fakeSession();
    (session as { sessionId: string | undefined }).sessionId = undefined;
    render(<PiChat session={session} />);
    expect(ensureLoadedMock).not.toHaveBeenCalled();
  });

  it("非空 groups + available=true 时选择器渲染(可见、可开/选,Req 4.1/4.2/4.3)", async () => {
    const user = userEvent.setup();
    const groups: ModelGroup[] = [
      {
        provider: "openai",
        models: [{ provider: "openai", modelId: "gpt-4o", label: "GPT-4o" }],
      },
    ];
    modelsResult = makeModels({ available: true, groups });
    render(<PiChat session={fakeSession()} />);
    const trigger = screen.getByRole("button", { name: "模型" });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    expect(
      within(screen.getByRole("listbox", { name: "模型" })).getAllByRole(
        "option",
      ),
    ).toHaveLength(1);
  });

  it("模型不可用时选择器不渲染(降级,Req 4.4)", () => {
    modelsResult = makeModels({ available: false });
    render(<PiChat session={fakeSession()} />);
    expect(
      screen.queryByRole("button", { name: "模型" }),
    ).not.toBeInTheDocument();
  });

  // -- 分支控件:出现 / 切换 (Req 8.1, 11.4) --------------------------------
  it("多版本消息显示「第 N / 共 M」并点击切换调 useBranches.select", async () => {
    const user = userEvent.setup();
    chatState = {
      status: "ready",
      messages: [
        {
          id: "m-assistant",
          role: "assistant",
          parts: [{ type: "text", text: "answer v2" }],
        } as UIMessage,
      ],
    };
    const branch: BranchInfo = { entryId: "m-assistant", index: 1, total: 3 };
    branchesResult = makeBranches({
      branchOf: (id) => (id === "m-assistant" ? branch : undefined),
    });

    render(<PiChat session={fakeSession()} />);

    // 指示文本「第 2 / 共 3」(index 0-based → 显示 index+1)。
    expect(screen.getByText(/第\s*2\s*\/\s*共\s*3/)).toBeInTheDocument();

    // 上一个 → select(entryId, index-1)。
    await user.click(screen.getByRole("button", { name: "上一个版本" }));
    expect(branchSelectMock).toHaveBeenCalledWith("m-assistant", 0);

    // 下一个 → select(entryId, index+1)。
    await user.click(screen.getByRole("button", { name: "下一个版本" }));
    expect(branchSelectMock).toHaveBeenCalledWith("m-assistant", 2);
  });

  it("单版本消息(total<=1)不渲染分支控件(Req 8.4)", () => {
    chatState = {
      status: "ready",
      messages: [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
        } as UIMessage,
      ],
    };
    branchesResult = makeBranches({
      branchOf: () => ({ entryId: "m1", index: 0, total: 1 }),
    });
    render(<PiChat session={fakeSession()} />);
    expect(
      screen.queryByRole("button", { name: "上一个版本" }),
    ).not.toBeInTheDocument();
  });

  // -- 思考折叠随流式增量 (Req 9.1, 9.2) -----------------------------------
  it("reasoning 折叠默认折叠,展开后随流式增量实时更新且完成态停止指示", async () => {
    const user = userEvent.setup();

    function reasoningMessage(
      text: string,
      state: "streaming" | "done",
    ): UIMessage {
      return {
        id: "m-r",
        role: "assistant",
        parts: [{ type: "reasoning", text, state }],
      } as UIMessage;
    }

    chatState = {
      status: "streaming",
      messages: [reasoningMessage("思考中", "streaming")],
    };
    const { rerender } = render(<PiChat session={fakeSession()} />);

    // 默认折叠:内容不可见,折叠头 aria-expanded=false(Req 9.1)。
    const toggle = screen.getByRole("button", { name: /Reasoning/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("思考中")).not.toBeInTheDocument();
    // 流式进行中:Thinking 指示存在。
    expect(screen.getByRole("status", { name: "Thinking" })).toBeInTheDocument();

    // 展开 → 当前增量可见。
    await user.click(toggle);
    expect(screen.getByText("思考中")).toBeInTheDocument();

    // 流式增量追加:同一 part text 增长,展开块实时反映新增量(Req 9.2)。
    chatState = {
      status: "streaming",
      messages: [reasoningMessage("思考中…再想想", "streaming")],
    };
    rerender(<PiChat session={fakeSession()} />);
    expect(screen.getByText("思考中…再想想")).toBeInTheDocument();

    // 完成态:state 转 done,最终增量保留,Thinking 指示消失。
    chatState = {
      status: "ready",
      messages: [reasoningMessage("思考中…再想想…完成", "done")],
    };
    rerender(<PiChat session={fakeSession()} />);
    expect(screen.getByText("思考中…再想想…完成")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  it("无 reasoning/source 的消息不渲染折叠块(Req 9.4)", () => {
    chatState = {
      status: "ready",
      messages: [
        {
          id: "m-plain",
          role: "assistant",
          parts: [{ type: "text", text: "plain" }],
        } as UIMessage,
      ],
    };
    render(<PiChat session={fakeSession()} />);
    expect(
      screen.queryByRole("button", { name: /Reasoning/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sources/ }),
    ).not.toBeInTheDocument();
  });

  // -- 来源折叠:经注册的 Sources 渲染器 (Req 9.3) --------------------------
  it("source data-part 经注册的 Sources 渲染器折叠/展开", async () => {
    const user = userEvent.setup();
    const registry = createRendererRegistry();

    // 先以空消息挂载:装配的 useEffect 向注入注册表注册 source data-part 渲染器。
    chatState = { status: "ready", messages: [] };
    const { rerender } = render(
      <PiChat session={fakeSession()} registry={registry} />,
    );
    // 注册器已就位(模拟「来源在会话进行中到达」)。
    expect(registry.resolveDataPartRenderer("data-source")).toBeDefined();

    // 来源消息到达 → 经已注册的 Sources 渲染器渲染。
    chatState = {
      status: "ready",
      messages: [
        {
          id: "m-src",
          role: "assistant",
          parts: [
            {
              type: "data-source",
              data: {
                sources: [
                  { id: "s1", title: "Pi Docs", url: "https://example.com/a" },
                  { id: "s2", title: "Spec", url: "https://example.com/b" },
                ],
              },
            },
          ],
        } as UIMessage,
      ],
    };
    rerender(<PiChat session={fakeSession()} registry={registry} />);

    // 折叠头出现且默认折叠(Req 9.3);来源数=2。
    const srcToggle = screen.getByRole("button", { name: /Sources/ });
    expect(srcToggle).toHaveAttribute("aria-expanded", "false");
    expect(srcToggle).toHaveTextContent("2");
    // 默认折叠:链接不可见。
    expect(
      screen.queryByRole("link", { name: "Pi Docs" }),
    ).not.toBeInTheDocument();

    // 展开 → 来源链接列出(title + url)。
    await user.click(srcToggle);
    expect(srcToggle).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: "Pi Docs" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getByRole("link", { name: "Spec" })).toBeInTheDocument();
  });

  // -- 附件 chip 增删(UI 层) (Req 3.1, 3.3) -----------------------------
  it("useAttachments.items 渲染 chip 并点击移除调 remove", async () => {
    const user = userEvent.setup();
    const item: PendingAttachment = {
      id: "att-1",
      name: "shot.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    };
    attachmentsResult = makeAttachments({ items: [item] });

    render(<PiChat session={fakeSession()} />);

    // chip 显示文件名。
    expect(screen.getByText("shot.png")).toBeInTheDocument();

    // 点击移除按钮 → useAttachments.remove(id)。
    const removeBtn = screen.getByRole("button", { name: "移除附件 shot.png" });
    await user.click(removeBtn);
    expect(attachRemoveMock).toHaveBeenCalledWith("att-1");
  });

  // -- SubmitButton 随 useChat status 切换 (Req 2.1, 2.3) ------------------
  it("status=submitted/streaming 显示停止态,点击触发 useChat stop", async () => {
    const user = userEvent.setup();
    chatState = { status: "streaming", messages: [] };
    render(<PiChat session={fakeSession()} />);

    const stop = screen.getByRole("button", { name: /停止/ });
    expect(stop).toHaveAttribute("data-pi-submit-state", "stop");
    await user.click(stop);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("status=submitted 同样显示停止态", () => {
    chatState = { status: "submitted", messages: [] };
    render(<PiChat session={fakeSession()} />);
    expect(screen.getByRole("button", { name: /停止/ })).toHaveAttribute(
      "data-pi-submit-state",
      "stop",
    );
  });

  it("status=error 显示错误/重试态,有内容时可点击重试触发发送", async () => {
    const user = userEvent.setup();
    chatState = { status: "error", messages: [] };
    render(<PiChat session={fakeSession()} />);

    const retry = screen.getByRole("button", { name: /重试/ });
    expect(retry).toHaveAttribute("data-pi-submit-state", "error");
    // 空内容时禁用。
    expect(retry).toBeDisabled();

    // 输入内容后可重试。
    await user.type(
      screen.getByRole("textbox", { name: /消息输入|message/i }),
      "again",
    );
    const retry2 = screen.getByRole("button", { name: /重试/ });
    expect(retry2).not.toBeDisabled();
    await user.click(retry2);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  // -- 建议点击填入 + 提交文本 (Req 10.2, 1.2) ----------------------------
  it("建议(mode=fill)点击填入输入框,随后提交文本调 sendMessage", async () => {
    const user = userEvent.setup();
    const sugg: Suggestion = {
      id: "cmd:help",
      label: "/help",
      value: "/help",
      mode: "fill",
    };
    suggestionsResult = makeSuggestions({ items: [sugg] });

    render(<PiChat session={fakeSession()} />);

    await user.click(screen.getByRole("button", { name: "/help" }));
    const textarea = screen.getByRole("textbox", {
      name: /消息输入|message/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toContain("/help");

    // 提交 → sendMessage 携带文本(Req 1.2)。
    await user.click(screen.getByRole("button", { name: /发送/ }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]?.[0]?.text).toContain("/help");
  });

  it("建议(mode=send)点击直接发送", async () => {
    const user = userEvent.setup();
    suggestionsResult = makeSuggestions({
      items: [
        { id: "p1", label: "总结", value: "请总结", mode: "send" },
      ],
    });
    render(<PiChat session={fakeSession()} />);
    await user.click(screen.getByRole("button", { name: "总结" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]?.[0]?.text).toContain("请总结");
  });
});

// ---- ambient 面接线(Task 3.2) ---------------------------------------------

describe("PiChat ambient 面(extensionUI 接线)", () => {
  // -- 通知浮层 (Req 1.x / 8.4) ---------------------------------------------
  it("注入 notifications → toast 文本可见且根容器 relative", () => {
    const notifications: ExtensionNotification[] = [
      { id: "n1", message: "构建完成", notifyType: "info" },
      { id: "n2", message: "出错了", notifyType: "error" },
    ];
    const { container } = render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ notifications })}
        notificationsAutoDismissMs={0}
      />,
    );
    expect(screen.getByText("构建完成")).toBeInTheDocument();
    expect(screen.getByText("出错了")).toBeInTheDocument();
    // 根容器需 relative 定位(承载固定/绝对叠加层)。
    const root = container.querySelector("[data-pi-chat-pro]");
    expect(root?.className).toContain("relative");
  });

  // -- 状态条 (Req 2.x) -----------------------------------------------------
  it("注入 statuses → 状态项可见(StatusBar)", () => {
    render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({
          statuses: { branch: "main", env: "prod" },
        })}
      />,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
  });

  // -- widget 区上/下方 (Req 3.x) -------------------------------------------
  it("注入 widgets(above/below)→ widget 行可见且位置正确(空态)", () => {
    const widgets: Readonly<Record<string, ExtensionWidget>> = {
      top: { lines: ["above-line-1"], placement: "aboveEditor" },
      bottom: { lines: ["below-line-1"], placement: "belowEditor" },
    };
    const { container } = render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ widgets })}
      />,
    );
    expect(screen.getByText("above-line-1")).toBeInTheDocument();
    expect(screen.getByText("below-line-1")).toBeInTheDocument();
    expect(
      container.querySelector('[data-pi-widget-placement="aboveEditor"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-pi-widget-placement="belowEditor"]'),
    ).toBeInTheDocument();
  });

  it("注入 widgets 在会话态也渲染上/下方", () => {
    chatState = {
      status: "ready",
      messages: [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
        } as UIMessage,
      ],
    };
    const widgets: Readonly<Record<string, ExtensionWidget>> = {
      top: { lines: ["conv-above"], placement: "aboveEditor" },
      bottom: { lines: ["conv-below"], placement: "belowEditor" },
    };
    render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ widgets })}
      />,
    );
    expect(screen.getByText("conv-above")).toBeInTheDocument();
    expect(screen.getByText("conv-below")).toBeInTheDocument();
  });

  // -- 内部头部标题 (Req 4.1/4.2/4.3) ---------------------------------------
  it("注入 title → 头部标题文本可见", () => {
    render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ title: "My Session Title" })}
      />,
    );
    expect(screen.getByText("My Session Title")).toBeInTheDocument();
  });

  it("未设 title 且无 statuses → 不渲染内部扩展头部(Req 4.3)", () => {
    const { container } = render(
      <PiChat session={fakeSession()} extensionUI={mockExtensionUI()} />,
    );
    expect(
      container.querySelector("[data-pi-extension-header]"),
    ).not.toBeInTheDocument();
  });

  // -- set_editor_text → 输入框 (Req 5.1/5.2/5.4) ---------------------------
  it("注入 editorText → textarea 值变为该文本;提升 seq 取最新", () => {
    const { rerender } = render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ editorText: { text: "first", seq: 1 } })}
      />,
    );
    const textarea = screen.getByRole("textbox", {
      name: /消息输入|message/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("first");

    // 提升 seq + 新文本 → 取最新。
    rerender(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ editorText: { text: "second", seq: 2 } })}
      />,
    );
    expect(textarea.value).toBe("second");
  });

  it("同一 seq 重渲染不回灌:applied 后用户改了 input,相同 seq rerender 保留用户输入(Req 5.3/5.4)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ editorText: { text: "seed", seq: 1 } })}
      />,
    );
    const textarea = screen.getByRole("textbox", {
      name: /消息输入|message/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("seed");

    // 用户继续编辑。
    await user.type(textarea, "-edited");
    expect(textarea.value).toBe("seed-edited");

    // 相同 seq 重渲染:不应回灌覆盖用户输入。
    rerender(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({ editorText: { text: "seed", seq: 1 } })}
      />,
    );
    expect(textarea.value).toBe("seed-edited");
  });

  // -- 降级:无 extensionUI / 空 ambient (Req 6.1) --------------------------
  it("无 extensionUI → ambient 面不渲染,既有界面正常", () => {
    const { container } = render(<PiChat session={fakeSession()} />);
    expect(container.querySelector("[data-pi-notifications]")).toBeNull();
    expect(container.querySelector("[data-pi-status-bar]")).toBeNull();
    expect(container.querySelector("[data-pi-widgets]")).toBeNull();
    expect(container.querySelector("[data-pi-extension-header]")).toBeNull();
    // 既有界面仍渲染(空态欢迎)。
    expect(container.querySelector("[data-pi-chat-welcome]")).toBeInTheDocument();
  });

  it("空 ambient(全空切片)→ ambient 面不渲染(降级)", () => {
    const { container } = render(
      <PiChat session={fakeSession()} extensionUI={mockExtensionUI()} />,
    );
    expect(container.querySelector("[data-pi-notifications]")).toBeNull();
    expect(container.querySelector("[data-pi-status-bar]")).toBeNull();
    expect(container.querySelector("[data-pi-widgets]")).toBeNull();
  });

  // -- 推送面与交互对话框共存且互不阻塞 (Req 6.2, 6.4, 8.4) -----------------
  it("推送类 ambient 态与交互类 confirm 请求并存时:对话框正常弹出且推送面同时可见(未被阻塞)", () => {
    // 设计语义:推送类(notify/setStatus/setWidget/setTitle)不入交互队列,
    // 故 `current` 为交互类 confirm 请求时,PiPermissionDialog 应正常弹出,
    // 而 notifications / statuses 等推送面同时渲染——二者互不阻塞/不干扰。
    const confirmRequest = {
      type: "extension_ui_request" as const,
      id: "c1",
      method: "confirm" as const,
      title: "Proceed?",
      message: "ok?",
    };
    const notifications: ExtensionNotification[] = [
      { id: "n1", message: "构建完成", notifyType: "info" },
    ];
    const { container } = render(
      <PiChat
        session={fakeSession()}
        extensionUI={mockExtensionUI({
          // 交互类:current + queue 同时持有该 confirm 请求,respond 为 vi.fn。
          current: confirmRequest,
          queue: [confirmRequest],
          respond: vi.fn(async () => undefined),
          // 推送类 ambient:通知 + 状态 + 标题。
          notifications,
          statuses: { branch: "main" },
          title: "My Session Title",
        })}
        notificationsAutoDismissMs={0}
      />,
    );

    // 权限对话框可见(真实 PiPermissionDialog,根 data 属性 data-pi-permission-dialog)。
    // Radix Dialog 经 portal 渲染至 document.body,故经 document 而非 render container 查询。
    const dialog = document.querySelector("[data-pi-permission-dialog]");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // confirm 方法专属:确认 / 取消按钮可见,标题/消息渲染。
    expect(dialog?.getAttribute("data-pi-permission-method")).toBe("confirm");
    expect(screen.getByText("Proceed?")).toBeInTheDocument();
    expect(screen.getByText("ok?")).toBeInTheDocument();

    // 同时:推送面(通知浮层 + 状态条)可见 —— 未被交互对话框阻塞。
    expect(container.querySelector("[data-pi-notifications]")).toBeInTheDocument();
    expect(container.querySelector("[data-pi-status-bar]")).toBeInTheDocument();
    expect(screen.getByText("构建完成")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("My Session Title")).toBeInTheDocument();
  });
});

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
  ModelGroup,
  BranchInfo,
  Suggestion,
  PendingAttachment,
} from "@pi-web/react";

/**
 * PiChatPro 富交互集成测试(任务 5.2)。
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

/** sendMessage 的最小观测形状(PiChatPro 传 { text } 与可选 { body })。 */
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
    // PiChatPro 仅用 messages/sendMessage/status/stop;其余以宽松占位满足类型。
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
import { PiChatPro } from "../../src/chat/pi-chat-pro.js";
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

// 一个最小的会话 prop:PiChatPro 仅读 transport/sessionId/client 接线 hooks;
// 这些 hooks 已被 mock,故此处只需结构占位。
function fakeSession(): React.ComponentProps<typeof PiChatPro>["session"] {
  return {
    sessionId: "sess-1",
    status: "open",
    transport: {} as React.ComponentProps<
      typeof PiChatPro
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

describe("PiChatPro 富交互(mock hooks)", () => {
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

    render(<PiChatPro session={fakeSession()} />);

    // 打开 → onOpen 触发 ensureLoaded(懒加载)。
    await user.click(screen.getByRole("button", { name: "模型" }));
    expect(ensureLoadedMock).toHaveBeenCalledTimes(1);

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

  it("模型不可用时选择器不渲染(降级,Req 4.4)", () => {
    modelsResult = makeModels({ available: false });
    render(<PiChatPro session={fakeSession()} />);
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

    render(<PiChatPro session={fakeSession()} />);

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
    render(<PiChatPro session={fakeSession()} />);
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
    const { rerender } = render(<PiChatPro session={fakeSession()} />);

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
    rerender(<PiChatPro session={fakeSession()} />);
    expect(screen.getByText("思考中…再想想")).toBeInTheDocument();

    // 完成态:state 转 done,最终增量保留,Thinking 指示消失。
    chatState = {
      status: "ready",
      messages: [reasoningMessage("思考中…再想想…完成", "done")],
    };
    rerender(<PiChatPro session={fakeSession()} />);
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
    render(<PiChatPro session={fakeSession()} />);
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
      <PiChatPro session={fakeSession()} registry={registry} />,
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
    rerender(<PiChatPro session={fakeSession()} registry={registry} />);

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

    render(<PiChatPro session={fakeSession()} />);

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
    render(<PiChatPro session={fakeSession()} />);

    const stop = screen.getByRole("button", { name: /停止/ });
    expect(stop).toHaveAttribute("data-pi-submit-state", "stop");
    await user.click(stop);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("status=submitted 同样显示停止态", () => {
    chatState = { status: "submitted", messages: [] };
    render(<PiChatPro session={fakeSession()} />);
    expect(screen.getByRole("button", { name: /停止/ })).toHaveAttribute(
      "data-pi-submit-state",
      "stop",
    );
  });

  it("status=error 显示错误/重试态,有内容时可点击重试触发发送", async () => {
    const user = userEvent.setup();
    chatState = { status: "error", messages: [] };
    render(<PiChatPro session={fakeSession()} />);

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

    render(<PiChatPro session={fakeSession()} />);

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
    render(<PiChatPro session={fakeSession()} />);
    await user.click(screen.getByRole("button", { name: "总结" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]?.[0]?.text).toContain("请总结");
  });
});

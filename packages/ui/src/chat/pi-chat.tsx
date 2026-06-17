"use client";
/**
 * PiChat — 富聊天装配组件(默认聊天组件,对标 AI Elements 参考示例;原名 `PiChatPro`)。
 *
 * 最小组件已改名为 `PiChatBasic`;`PiChatPro` 现为指向本组件的废弃别名。
 * 用会话 transport 驱动 `useChat`,组合无状态元件层
 * (Conversation/Message/PromptInput/Attachments/ModelSelector/SpeechInput/WebSearchToggle/
 * SubmitButton/Suggestions)与 `@pi-web/react` 数据 hooks(useModels/useAttachments/
 * useBranches/useSuggestions),复用既有 `PartRenderer`/`PiReasoning`/`PiToolPart` 与渲染器
 * 注册表。所有能力接到 pi 真实 RPC,能力缺失时优雅降级。
 *
 * 接线要点(见 design.md「PiChatPro(装配)」与累积 Implementation Notes):
 *  - 建议:useSuggestions 不自动触发 getCommands —— 会话就绪后此处调 `controls.getCommands()`
 *    填充 commands(Req 10.1)。
 *  - 分支:Message 的 onPrev/onNext → `useBranches.select(entryId, index∓1)`;数据来自
 *    `useBranches.branchOf(entryId)`(Req 8.1/8.3)。完整分支消息回灌视图越界(useBranches/
 *    react 包),本组件仅接好控件与 N/M 指示,见 CONCERNS。
 *  - 停止/中断:SubmitButton onStop → `controls.abort()` + useChat `stop()`(Req 2.3)。
 *  - 附件:useAttachments 收集图片;发送时 `toImageContents()` 经 useChat `sendMessage` 的
 *    `body.images` 传入(transport 从 body.images 提取),发送后 `clear()`(Req 3.2)。
 *  - 模型:ModelSelector 接 useModels(onOpen→ensureLoaded,onSelect→select);available=false
 *    元件自身隐藏(Req 4)。
 *  - 联网开关:受控 state 在此持有;开启时把意图随消息以提示文本传达;pi 无能力则仅附加提示,
 *    不报错(Req 6.3/6.4)。
 *  - 来源/思考:经注册表注册 `source` data-part 渲染器用 Sources 元件(Req 9.3);reasoning 复用
 *    既有 PiReasoning(经 PartRenderer)(Req 9.1/9.2)。
 *
 * 本组件不实现任何 REST/SSE 传输逻辑。主题经宿主 shadcn CSS 变量(cn),无硬编码颜色。
 */
import * as React from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  type UsePiSessionResult,
  type UsePiControlsResult,
  type UseExtensionUIResult,
  type Suggestion,
  useModels,
  useAttachments,
  useBranches,
  useSuggestions,
} from "@pi-web/react";
import { PartRenderer } from "./part-renderer.js";
import type { PiChatSlots } from "./slots.js";
import { PiPermissionDialog } from "../dialog/pi-permission-dialog.js";
import {
  Conversation,
  Message,
  PromptInput,
  Attachments,
  ModelSelector,
  SpeechInput,
  WebSearchToggle,
  SubmitButton,
  Suggestions,
  Sources,
  type Source,
} from "../elements/index.js";
import {
  defaultRendererRegistry,
  type RendererRegistry,
  type DataPartRenderer,
} from "../registry/renderer-registry.js";
import { cn } from "../lib/cn.js";

export interface PiChatProps {
  /** 来自 usePiSession;提供绑定的 transport / sessionId / client / 连接态。 */
  readonly session: UsePiSessionResult;
  /** 来自 usePiControls;驱动 abort/setModel/getCommands 等。 */
  readonly controls?: UsePiControlsResult;
  /** 来自 useExtensionUI;驱动权限弹窗。 */
  readonly extensionUI?: UseExtensionUIResult;
  /** 可注入隔离的渲染器注册表(默认用模块级单例);source data-part 渲染器注册于此。 */
  readonly registry?: RendererRegistry;
  readonly slots?: PiChatSlots;
  /** 建议气泡预设(与 pi commands 合并)。 */
  readonly suggestionsPresets?: ReadonlyArray<Suggestion>;
  /** 输入框占位符,覆盖默认值(Req 1.5)。 */
  readonly placeholder?: string;
  /** 空态欢迎页主标题,覆盖默认值。 */
  readonly emptyTitle?: string;
  /** 空态欢迎页副标题,覆盖默认值。 */
  readonly emptySubtitle?: string;
  /**
   * 空态欢迎页的 starter 建议卡片(2×2 网格)。当真实 suggestions(commands∪presets)
   * 为空时展示这些可配置的起始提示。默认提供一组通用示例,可由调用方覆盖。
   */
  readonly starters?: ReadonlyArray<Suggestion>;
  readonly className?: string;
}

/** 联网意图随消息传达的提示前缀(pi 无对应能力时仅作提示,不报错,Req 6.3/6.4)。 */
const WEB_SEARCH_HINT = "[web-search] 请在回答前进行联网搜索。";

/** 默认占位符(空态/会话态输入框)。 */
const DEFAULT_PLACEHOLDER = "Ask anything…";
/** 默认空态欢迎文案。 */
const DEFAULT_EMPTY_TITLE = "What can I help with?";
const DEFAULT_EMPTY_SUBTITLE = "Ask a question, write code, or explore ideas.";

/** 默认 starter 建议卡片(可由 props.starters 覆盖);点击填入输入框(mode "fill")。 */
const DEFAULT_STARTERS: ReadonlyArray<Suggestion> = [
  {
    id: "starter-nextjs",
    label: "What are the advantages of using Next.js?",
    value: "What are the advantages of using Next.js?",
    mode: "fill",
  },
  {
    id: "starter-dijkstra",
    label: "Write code to demonstrate Dijkstra's algorithm",
    value: "Write code to demonstrate Dijkstra's algorithm",
    mode: "fill",
  },
  {
    id: "starter-essay",
    label: "Help me write an essay about Silicon Valley",
    value: "Help me write an essay about Silicon Valley",
    mode: "fill",
  },
  {
    id: "starter-weather",
    label: "What is the weather in San Francisco?",
    value: "What is the weather in San Francisco?",
    mode: "fill",
  },
];

/** 从 data-source(s) part 的 data 中规整出 Source[](展示元件不依赖 pi 协议形状)。 */
function sourcesFromData(data: unknown): Source[] {
  const raw = Array.isArray(data)
    ? data
    : data !== null && typeof data === "object" && "sources" in data
      ? (data as { sources?: unknown }).sources
      : data;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const result: Source[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const source: Source = {};
    if (typeof e.id === "string") (source as { id?: string }).id = e.id;
    if (typeof e.title === "string")
      (source as { title?: string }).title = e.title;
    else if (typeof e.url === "string")
      (source as { title?: string }).title = e.url;
    if (typeof e.url === "string") (source as { url?: string }).url = e.url;
    result.push(source);
  }
  return result;
}

/** Sources data-part 渲染器:把注册表 part.data 规整成 Source[] 交给 Sources 元件(Req 9.3)。 */
const SourcesDataPartRenderer: DataPartRenderer = ({ part }) => {
  const data = "data" in part ? part.data : undefined;
  const sources = sourcesFromData(data);
  return <Sources sources={sources} />;
};

export function PiChat({
  session,
  controls,
  extensionUI,
  registry = defaultRendererRegistry,
  slots,
  suggestionsPresets,
  placeholder,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  emptySubtitle = DEFAULT_EMPTY_SUBTITLE,
  starters = DEFAULT_STARTERS,
  className,
}: PiChatProps): React.JSX.Element {
  const transport = session.transport;
  const sessionId = session.sessionId;
  const client = session.client;

  // 注册 source 类 data-part 渲染器(承接 Sources 元件);幂等(覆盖语义)。
  // 注册而非修改注册表模块,符合任务边界。
  React.useEffect(() => {
    registry.registerDataPartRenderer("data-source", SourcesDataPartRenderer);
    registry.registerDataPartRenderer("data-sources", SourcesDataPartRenderer);
  }, [registry]);

  const chat = useChat(transport === undefined ? {} : { transport });
  const { messages, sendMessage, status, stop } = chat;

  const [input, setInput] = React.useState<string>("");
  const [webSearch, setWebSearch] = React.useState<boolean>(false);

  // 数据 hooks 接线。
  const models = useModels({
    sessionId,
    ...(client !== undefined ? { client } : {}),
    ...(controls !== undefined ? { controls } : {}),
  });
  const attachments = useAttachments();
  const branches = useBranches({
    sessionId,
    ...(client !== undefined ? { client } : {}),
    // fork/get_fork_messages 能力是否可用由会话决定;无 client 时不可用。
    available: client !== undefined,
  });
  const suggestions = useSuggestions({
    ...(controls !== undefined ? { controls } : {}),
    ...(suggestionsPresets !== undefined ? { presets: suggestionsPresets } : {}),
  });

  const [rejected, setRejected] = React.useState<ReadonlyArray<string>>([]);

  // 会话就绪后拉取 commands 填充建议(useSuggestions 不自动触发,Req 10.1)。
  const commandsLoadedRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (
      controls === undefined ||
      sessionId === undefined ||
      commandsLoadedRef.current === sessionId
    ) {
      return;
    }
    commandsLoadedRef.current = sessionId;
    void controls.getCommands().catch(() => undefined);
  }, [controls, sessionId]);

  // 会话就绪后主动加载可用模型(useModels 不自动触发;ModelSelector 在
  // available=false 时隐藏,而 onOpen 是唯一懒加载触发点 → 形成死锁,选择器永不渲染)。
  // 此处镜像 commandsLoadedRef 模式,每会话仅触发一次,使 available 反映真实模型可用性:
  // 有模型 → 选择器渲染并可交互;get_available_models 不可用/空 → 选择器仍隐藏(Req 4.4 降级)。
  // 加载幂等(useModels.loadedRef 已防重复),onOpen 仍可再次调用而不破坏。
  const modelsLoadedRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (sessionId === undefined || modelsLoadedRef.current === sessionId) {
      return;
    }
    modelsLoadedRef.current = sessionId;
    void models.ensureLoaded().catch(() => undefined);
  }, [sessionId, models]);

  const isBusy = status === "submitted" || status === "streaming";
  const canSubmit =
    transport !== undefined &&
    (input.trim().length > 0 || attachments.items.length > 0);

  const doSend = React.useCallback(
    (text: string): void => {
      if (transport === undefined) return;
      const trimmed = text.trim();
      const hasAttachments = attachments.items.length > 0;
      if (trimmed.length === 0 && !hasAttachments) return;

      // 联网开关开启时把意图随消息传达(以 prompt 提示形式;pi 无能力仅作提示,Req 6.3/6.4)。
      const outgoing = !webSearch
        ? trimmed
        : trimmed.length > 0
          ? `${trimmed}\n\n${WEB_SEARCH_HINT}`
          : WEB_SEARCH_HINT;

      const images = hasAttachments ? attachments.toImageContents() : [];

      void sendMessage(
        { text: outgoing },
        images.length > 0 ? { body: { images } } : undefined,
      );

      setInput("");
      if (hasAttachments) attachments.clear();
      setRejected([]);
    },
    [transport, attachments, webSearch, sendMessage],
  );

  const onSubmit = React.useCallback((): void => {
    doSend(input);
  }, [doSend, input]);

  const onStop = React.useCallback((): void => {
    // 优先经 pi 控制层中止;同时停止本地流(Req 2.3)。
    if (controls !== undefined) void controls.abort().catch(() => undefined);
    stop();
  }, [controls, stop]);

  const onAddAttachments = React.useCallback(
    (files: FileList | File[]): void => {
      void attachments.add(files).then((res) => {
        setRejected(res.rejected);
      });
    },
    [attachments],
  );

  const onSpeechTranscript = React.useCallback((text: string): void => {
    setInput((prev) => (prev.length > 0 ? `${prev} ${text}` : text));
  }, []);

  const onSuggestionFill = React.useCallback((value: string): void => {
    setInput((prev) => (prev.length > 0 ? `${prev} ${value}` : value));
  }, []);

  const onSuggestionSend = React.useCallback(
    (value: string): void => {
      doSend(value);
    },
    [doSend],
  );

  const isEmpty = messages.length === 0;
  // 空态网格优先展示真实 suggestions(commands∪presets);为空时回落到 starter 卡片。
  const gridItems = suggestions.items.length > 0 ? suggestions.items : starters;

  // 工具条:左 paperclip 附件(compact)+ 模型选择器 + 语音 + 联网开关,右侧发送按钮。
  const toolbar = (
    <>
      <Attachments
        variant="compact"
        items={attachments.items}
        supported={attachments.supported}
        onAdd={onAddAttachments}
        onRemove={attachments.remove}
        rejected={rejected}
      />
      <ModelSelector
        groups={models.groups}
        current={models.current}
        available={models.available}
        onOpen={() => void models.ensureLoaded()}
        onSelect={(provider, modelId) =>
          void models.select(provider, modelId).catch(() => undefined)
        }
      />
      <SpeechInput onTranscript={onSpeechTranscript} />
      <WebSearchToggle enabled={webSearch} onToggle={setWebSearch} />
      <div className="ml-auto">
        <SubmitButton
          status={status}
          canSubmit={canSubmit}
          onSubmit={onSubmit}
          onStop={onStop}
        />
      </div>
    </>
  );

  // 大圆角输入框(空态居中、会话态置底共用)。
  const promptInput = (
    <PromptInput
      value={input}
      onChange={setInput}
      onSubmit={onSubmit}
      disabled={transport === undefined}
      toolbar={toolbar}
      rows={3}
      placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
      className="rounded-3xl border-[hsl(var(--border))] px-4 py-3 shadow-sm"
      textareaClassName="px-2 text-base"
    />
  );

  return (
    <div
      className={cn(
        "flex h-full w-full gap-3 text-[hsl(var(--foreground))]",
        className,
      )}
      data-pi-chat-pro
      data-pi-chat-empty={isEmpty ? "true" : "false"}
    >
      {slots?.sidebar !== undefined ? (
        <aside className="shrink-0" data-pi-chat-sidebar>
          {slots.sidebar}
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {slots?.header !== undefined ? (
          <header data-pi-chat-header>{slots.header}</header>
        ) : null}

        {isEmpty ? (
          // 空态欢迎页:居中大标题 + 副标题 + 2×2 starter 卡片网格 + 大输入框。
          <div
            className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8"
            data-pi-chat-welcome
          >
            <div className="w-full max-w-3xl">
              <div className="mb-12 text-center">
                <h1 className="text-4xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                  {emptyTitle}
                </h1>
                <p className="mt-3 text-base text-[hsl(var(--muted-foreground))]">
                  {emptySubtitle}
                </p>
              </div>

              <div className="mb-4" data-pi-chat-suggestions>
                <Suggestions
                  items={gridItems}
                  layout="grid"
                  onFill={onSuggestionFill}
                  onSend={onSuggestionSend}
                />
              </div>

              {promptInput}
            </div>
          </div>
        ) : (
          // 会话态:滚动消息区 + 紧凑建议气泡 + 置底输入框。
          <>
            <Conversation className="flex-1">
              <div className="mx-auto w-full max-w-3xl space-y-4 py-3" data-pi-chat-messages>
                {messages.map((message: UIMessage) => {
                  const branch = branches.branchOf(message.id);
                  const branchProps =
                    branch !== undefined && branch.total > 1
                      ? {
                          branch,
                          onPrev: () =>
                            void branches
                              .select(message.id, branch.index - 1)
                              .catch(() => undefined),
                          onNext: () =>
                            void branches
                              .select(message.id, branch.index + 1)
                              .catch(() => undefined),
                        }
                      : {};
                  const copyText = message.parts
                    .map((part) =>
                      part.type === "text" && typeof part.text === "string"
                        ? part.text
                        : "",
                    )
                    .join("")
                    .trim();
                  return (
                    <Message
                      key={message.id}
                      role={message.role}
                      {...(copyText.length > 0 ? { copyText } : {})}
                      {...branchProps}
                    >
                      <div className="space-y-2">
                        {message.parts.map((part, i) => (
                          <PartRenderer
                            key={`${message.id}-${i}`}
                            part={part}
                            message={message}
                            registry={registry}
                          />
                        ))}
                        {slots?.messageActions !== undefined ? (
                          <div data-pi-message-actions>
                            {slots.messageActions(message)}
                          </div>
                        ) : null}
                      </div>
                    </Message>
                  );
                })}
              </div>
            </Conversation>

            <div className="mx-auto w-full max-w-3xl">
              {/* 建议气泡(Req 10):空则元件自身不渲染。 */}
              <div className="py-2" data-pi-chat-suggestions>
                <Suggestions
                  items={suggestions.items}
                  onFill={onSuggestionFill}
                  onSend={onSuggestionSend}
                />
              </div>

              {promptInput}
            </div>
          </>
        )}

        {slots?.footer !== undefined ? (
          <footer data-pi-chat-footer>{slots.footer}</footer>
        ) : null}
      </div>

      {extensionUI !== undefined ? (
        <PiPermissionDialog extensionUI={extensionUI} />
      ) : null}

      {/* isBusy 标记供宿主/测试观察流式态(也由 SubmitButton 反映)。 */}
      <span hidden data-pi-busy={isBusy ? "true" : "false"} />
    </div>
  );
}

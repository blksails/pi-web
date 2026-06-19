"use client";
/**
 * PiChat — 富聊天装配组件。四维定制(主题/slots/components/layout+icons)在装配点解析:
 * slots(整块) > components(细粒度) > 默认。缺省时与定制引入前行为一致。
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
  createUiRpcBus,
} from "@pi-web/react";
import { PartRenderer } from "./part-renderer.js";
import { PiUiPart } from "../parts/pi-ui-part.js";
import type { PiChatSlots } from "./slots.js";
import {
  ChatError,
  Conversation,
  Message,
  type MessageProps,
  PromptInput,
  Attachments,
  ModelSelector,
  SpeechInput,
  WebSearchToggle,
  SubmitButton,
  EmptyState,
  Sources,
  type Source,
  Notifications,
  StatusBar,
  Widgets,
  type WidgetItem,
  PiInteraction,
} from "../elements/index.js";
import { IconsProvider, type IconTheme } from "../customization/icons.js";
import {
  resolveComponent,
  type ComponentOverrides,
  type MessageRole,
} from "../customization/component-overrides.js";
import {
  layoutClassNames,
  type LayoutPreset,
} from "../customization/layout.js";
import { ThemeProvider, type ThemeMode } from "../theme/theme-provider.js";
import {
  defaultRendererRegistry,
  type RendererRegistry,
  type DataPartRenderer,
} from "../registry/renderer-registry.js";
import { PiCommandPalette } from "../controls/pi-command-palette.js";
import type { ExtensionCommandPolicy } from "../controls/pi-command-palette.js";
import { PiMentionPopover } from "../controls/pi-mention-popover.js";
import { PiAutocompletePopover } from "../controls/pi-autocomplete-popover.js";
import { cn } from "../lib/cn.js";
import type { WebExtension } from "@pi-web/web-kit";
import {
  SlotHost,
  applyExtensionRenderers,
} from "../web-ext/apply-extension.js";
import { ExtSlotRegion } from "../web-ext/extension-slots.js";
import { ArtifactSurface } from "../web-ext/artifact-surface.js";

export type ToolbarControl =
  | "attachments"
  | "model"
  | "speech"
  | "webSearch"
  | "submit";

export interface PiChatProps {
  readonly session: UsePiSessionResult;
  readonly controls?: UsePiControlsResult;
  readonly extensionUI?: UseExtensionUIResult;
  readonly registry?: RendererRegistry;
  /** agent source 加载的 UI 扩展(Tier1 区域插槽 + Tier2 渲染器),缺省即现行为。 */
  readonly extension?: WebExtension;
  /** 扩展产物基址(解析 artifact 等相对资源 URL);缺省不渲染需基址的资源。 */
  readonly extensionBaseUrl?: string;
  readonly slots?: PiChatSlots;
  readonly suggestionsPresets?: ReadonlyArray<Suggestion>;
  readonly placeholder?: string;
  readonly emptyTitle?: string;
  readonly emptySubtitle?: string;
  readonly starters?: ReadonlyArray<Suggestion>;
  readonly notificationsAutoDismissMs?: number;
  /** 细粒度组件覆盖表(Req 5)。 */
  readonly components?: ComponentOverrides;
  /** 图标主题(Req 8)。 */
  readonly icons?: IconTheme;
  /** 布局预设(Req 7);缺省等价现行版面。 */
  readonly layout?: LayoutPreset;
  /** 主题模式;提供时内部包裹 ThemeProvider(Req 2)。 */
  readonly theme?: ThemeMode;
  /** 工具条控件顺序(Req 6.2);缺省用默认顺序。 */
  readonly toolbarOrder?: ReadonlyArray<ToolbarControl>;
  /** 扩展命令补全可见策略(全局开关 + 白名单);默认隐藏所有扩展命令。 */
  readonly extensionCommands?: ExtensionCommandPolicy;
  readonly className?: string;
}

const WEB_SEARCH_HINT = "[web-search] 请在回答前进行联网搜索。";

const EMPTY_NOTIFICATIONS: UseExtensionUIResult["notifications"] = [];
const EMPTY_STATUSES: UseExtensionUIResult["statuses"] = {};

const DEFAULT_PLACEHOLDER = "Ask anything…";
const DEFAULT_EMPTY_TITLE = "What can I help with?";
const DEFAULT_EMPTY_SUBTITLE = "Ask a question, write code, or explore ideas.";

const DEFAULT_TOOLBAR_ORDER: ReadonlyArray<ToolbarControl> = [
  "attachments",
  "model",
  "speech",
  "webSearch",
  "submit",
];

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
  extension,
  extensionBaseUrl,
  slots,
  suggestionsPresets,
  placeholder,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  emptySubtitle = DEFAULT_EMPTY_SUBTITLE,
  starters = DEFAULT_STARTERS,
  notificationsAutoDismissMs,
  components,
  icons,
  layout,
  theme,
  toolbarOrder,
  extensionCommands,
  className,
}: PiChatProps): React.JSX.Element {
  const transport = session.transport;
  const sessionId = session.sessionId;
  const client = session.client;
  const connection = session.connection;

  // Tier3 ui-rpc 客户端总线(贡献点回 agent 的通道);会话/连接就绪时构造,卸载时释放。
  const uiRpc = React.useMemo(() => {
    if (client === undefined || sessionId === undefined || connection === undefined) {
      return undefined;
    }
    return createUiRpcBus({
      send: (req) => client.uiRpc(sessionId, req).then(() => undefined),
      subscribeResponse: connection.controlStore.onUiRpcResponse,
    });
  }, [client, sessionId, connection]);
  React.useEffect(() => {
    return () => uiRpc?.dispose();
  }, [uiRpc]);


  React.useEffect(() => {
    registry.registerDataPartRenderer("data-source", SourcesDataPartRenderer);
    registry.registerDataPartRenderer("data-sources", SourcesDataPartRenderer);
    registry.registerDataPartRenderer("data-pi-ui", PiUiPart);
  }, [registry]);

  // Tier2:把扩展渲染器并入 registry(extId 命名空间);卸载/换扩展时清理(Req 3.x)。
  React.useEffect(() => {
    if (extension === undefined) return;
    return applyExtensionRenderers(registry, extension);
  }, [registry, extension]);

  const chat = useChat(
    transport === undefined
      ? {}
      : {
          transport,
          ...(session.initialMessages !== undefined
            ? { messages: session.initialMessages }
            : {}),
        },
  );
  const { messages, sendMessage, status, stop, error } = chat;

  const errorMessage: string | undefined =
    error !== undefined
      ? error.message
      : status === "error"
        ? "An error occurred."
        : undefined;

  const [input, setInput] = React.useState<string>("");
  const [webSearch, setWebSearch] = React.useState<boolean>(false);

  const [dockHeight, setDockHeight] = React.useState<number>(0);
  const dockObserverRef = React.useRef<ResizeObserver | null>(null);
  const dockRef = React.useCallback((el: HTMLDivElement | null): void => {
    dockObserverRef.current?.disconnect();
    if (el === null) return;
    setDockHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setDockHeight(el.offsetHeight));
    ro.observe(el);
    dockObserverRef.current = ro;
  }, []);
  const [commandCapturing, setCommandCapturing] =
    React.useState<boolean>(false);

  const notifications = extensionUI?.notifications ?? EMPTY_NOTIFICATIONS;
  const statuses = extensionUI?.statuses ?? EMPTY_STATUSES;
  const ambientTitle = extensionUI?.title;
  const dismissNotification = extensionUI?.dismissNotification;

  const widgetItems = React.useMemo<WidgetItem[]>(() => {
    const map = extensionUI?.widgets;
    if (map === undefined) return [];
    return Object.entries(map).map(([key, widget]) => ({
      key,
      lines: widget.lines,
      placement: widget.placement,
    }));
  }, [extensionUI?.widgets]);

  const appliedEditorSeqRef = React.useRef<number | undefined>(undefined);
  const editorText = extensionUI?.editorText;
  React.useEffect(() => {
    if (editorText === undefined) return;
    if (appliedEditorSeqRef.current === editorText.seq) return;
    appliedEditorSeqRef.current = editorText.seq;
    setInput(editorText.text);
  }, [editorText]);

  const models = useModels({
    sessionId,
    ...(client !== undefined ? { client } : {}),
    ...(controls !== undefined ? { controls } : {}),
  });
  const attachments = useAttachments();
  const branches = useBranches({
    sessionId,
    ...(client !== undefined ? { client } : {}),
    available: client !== undefined,
  });
  const suggestions = useSuggestions({
    ...(controls !== undefined ? { controls } : {}),
    ...(suggestionsPresets !== undefined ? { presets: suggestionsPresets } : {}),
  });

  const [rejected, setRejected] = React.useState<ReadonlyArray<string>>([]);

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

  const modelsLoadedRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (sessionId === undefined || modelsLoadedRef.current === sessionId) {
      return;
    }
    modelsLoadedRef.current = sessionId;
    void models.ensureLoaded().catch(() => undefined);
  }, [sessionId, models]);

  const isBusy = status === "submitted" || status === "streaming";

  // 空闲期 Tier3 贡献点(slash/mention/autocomplete)需持久控制通道:per-prompt 消息流仅在发送时
  // 打开。故仅当**扩展声明了 contributions**(需 ui-rpc)且**空闲时**才另开一条「仅 ui-rpc」订阅
  // ——无贡献点的 agent 不开(零干扰),prompt 期关闭(由 per-prompt 流处理 control 帧),
  // 避免与 per-prompt 流并存导致流冲突。使 idle 输入 "/"/"@" 触发的 ui-rpc 回包能投递(R10/R11/R20)。
  const hasContributions = extension?.contributions !== undefined;
  React.useEffect(() => {
    if (connection === undefined || isBusy || !hasContributions) return;
    return connection.openControlOnlyStream();
  }, [connection, isBusy, hasContributions]);
  const canSubmit =
    transport !== undefined &&
    (input.trim().length > 0 || attachments.items.length > 0);

  const doSend = React.useCallback(
    (text: string): void => {
      if (transport === undefined) return;
      const trimmed = text.trim();
      const hasAttachments = attachments.items.length > 0;
      if (trimmed.length === 0 && !hasAttachments) return;

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
  const gridItems = suggestions.items.length > 0 ? suggestions.items : starters;

  const lay = layoutClassNames(layout);

  // 控件解析(components 覆盖 vs 默认;可移除控件支持 null)。
  const SubmitC = resolveComponent(components?.SubmitButton, SubmitButton);
  const AttachC = resolveComponent(components?.Attachments, Attachments);
  const ModelC = resolveComponent(components?.ModelSelector, ModelSelector);
  const SpeechC = resolveComponent(components?.SpeechInput, SpeechInput);
  const WebC = resolveComponent(components?.WebSearchToggle, WebSearchToggle);

  const controlNodes: Record<ToolbarControl, React.ReactNode> = {
    attachments:
      AttachC === null ? null : (
        <AttachC
          variant="compact"
          items={attachments.items}
          supported={attachments.supported}
          onAdd={onAddAttachments}
          onRemove={attachments.remove}
          rejected={rejected}
        />
      ),
    model:
      ModelC === null ? null : (
        <ModelC
          groups={models.groups}
          current={models.current}
          available={models.available}
          onOpen={() => void models.ensureLoaded()}
          onSelect={(provider, modelId) =>
            void models.select(provider, modelId).catch(() => undefined)
          }
        />
      ),
    speech:
      SpeechC === null ? null : <SpeechC onTranscript={onSpeechTranscript} />,
    webSearch:
      WebC === null ? null : (
        <WebC enabled={webSearch} onToggle={setWebSearch} />
      ),
    submit:
      SubmitC === null ? null : (
        <div className="ml-auto">
          <SubmitC
            status={status}
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            onStop={onStop}
          />
        </div>
      ),
  };

  const order = toolbarOrder ?? DEFAULT_TOOLBAR_ORDER;
  const toolbar = (
    <>
      {order.map((key) => (
        <React.Fragment key={key}>{controlNodes[key]}</React.Fragment>
      ))}
    </>
  );

  // inlineComplete ghost(R20):非 slash/mention 输入时经 ui-rpc 取后缀建议,Tab 接受。
  const inlineComplete = extension?.contributions?.inlineComplete;
  const [ghostSuffix, setGhostSuffix] = React.useState<string>("");
  React.useEffect(() => {
    const active =
      input.trim().length > 0 &&
      !input.startsWith("/") &&
      !/@\S*$/.test(input);
    if (inlineComplete === undefined || uiRpc === undefined || !active) {
      setGhostSuffix("");
      return;
    }
    let cancelled = false;
    void inlineComplete
      .complete(input, uiRpc)
      .then((s) => {
        if (!cancelled) setGhostSuffix(typeof s === "string" ? s : "");
      })
      .catch(() => {
        if (!cancelled) setGhostSuffix("");
      });
    return () => {
      cancelled = true;
    };
  }, [input, inlineComplete, uiRpc]);

  // keybindings(R20):扩展声明 combo→commandId;会话作用域 keydown 匹配后填充 /commandId(可见效果)。
  const keybindings = extension?.contributions?.keybindings;
  React.useEffect(() => {
    if (keybindings === undefined || keybindings.length === 0) return;
    const matches = (e: KeyboardEvent, combo: string): boolean => {
      const parts = combo.toLowerCase().split("+").map((p) => p.trim());
      const key = parts[parts.length - 1];
      const needMod =
        parts.includes("mod") ||
        parts.includes("ctrl") ||
        parts.includes("cmd") ||
        parts.includes("meta");
      const needShift = parts.includes("shift");
      const needAlt = parts.includes("alt");
      return (
        e.key.toLowerCase() === key &&
        needMod === (e.metaKey || e.ctrlKey) &&
        needShift === e.shiftKey &&
        needAlt === e.altKey
      );
    };
    const onKey = (e: KeyboardEvent): void => {
      for (const kb of keybindings) {
        if (matches(e, kb.combo)) {
          e.preventDefault();
          setInput(`/${kb.commandId} `);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keybindings]);

  const promptInput = (
    <PromptInput
      value={input}
      onChange={setInput}
      onSubmit={onSubmit}
      disabled={transport === undefined}
      toolbar={toolbar}
      rows={3}
      placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
      className="rounded-3xl border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-4 py-3 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/65"
      textareaClassName="px-2 text-base"
      suppressEnterSubmit={commandCapturing}
      ghostSuffix={ghostSuffix}
      onAcceptGhost={() => setInput(input + ghostSuffix)}
    />
  );

  const inputWithWidgets = (
    <div className="relative" data-pi-input-wrapper>
      {controls !== undefined ? (
        <div className="absolute bottom-full left-0 right-0 z-40">
          <PiCommandPalette
            controls={controls}
            value={input}
            onChange={setInput}
            onCaptureChange={setCommandCapturing}
            extensionCommands={extensionCommands}
            {...(extension?.contributions?.slash !== undefined
              ? { slashContribution: extension.contributions.slash }
              : {})}
            {...(uiRpc !== undefined ? { uiRpc } : {})}
          />
        </div>
      ) : null}
      {extension?.contributions?.mention !== undefined && uiRpc !== undefined ? (
        <div className="absolute bottom-full left-0 right-0 z-40">
          <PiMentionPopover
            value={input}
            onChange={setInput}
            contribution={extension.contributions.mention}
            uiRpc={uiRpc}
            onCaptureChange={setCommandCapturing}
          />
        </div>
      ) : null}
      {extension?.contributions?.autocomplete !== undefined &&
      uiRpc !== undefined ? (
        <div className="absolute bottom-full left-0 right-0 z-30">
          <PiAutocompletePopover
            value={input}
            onChange={setInput}
            contribution={extension.contributions.autocomplete}
            uiRpc={uiRpc}
          />
        </div>
      ) : null}
      {/* Tier1 保留插槽:编辑器上方配件(追加,不替换 Widgets)。 */}
      <ExtSlotRegion ext={extension} slot="accessoryAboveEditor" />
      <Widgets widgets={widgetItems} placement="aboveEditor" />
      {/* promptInput 装饰为绝对覆盖、不移除内核 textarea;inline 配件为绝对定位不挤压输入。 */}
      <div className="relative">
        <ExtSlotRegion
          ext={extension}
          slot="promptInput"
          className="pointer-events-none absolute inset-0 z-10"
        />
        <ExtSlotRegion
          ext={extension}
          slot="accessoryInlineLeft"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2"
        />
        <ExtSlotRegion
          ext={extension}
          slot="accessoryInlineRight"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2"
        />
        {promptInput}
      </div>
      <Widgets widgets={widgetItems} placement="belowEditor" />
      <ExtSlotRegion ext={extension} slot="accessoryBelowEditor" />
    </div>
  );

  const hasExtensionHeader =
    ambientTitle !== undefined || Object.keys(statuses).length > 0;
  const extensionHeader = hasExtensionHeader ? (
    <div
      data-pi-extension-header
      className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-2"
    >
      {ambientTitle !== undefined ? (
        <span
          data-pi-extension-title
          className="text-sm font-medium text-[hsl(var(--foreground))]"
        >
          {ambientTitle}
        </span>
      ) : null}
      <StatusBar statuses={statuses} />
    </div>
  ) : null;

  // 背景层:slots.background 优先,否则 components.ConversationBackground(Req 9.1)。
  const BgComp = components?.ConversationBackground;
  const backgroundLayer =
    slots?.background !== undefined ? (
      <div className="absolute inset-0 -z-10" data-pi-chat-background>
        {slots.background}
      </div>
    ) : BgComp !== undefined ? (
      <div className="absolute inset-0 -z-10" data-pi-chat-background>
        <BgComp />
      </div>
    ) : extension?.slots?.background !== undefined ? (
      // Tier1:扩展背景(宿主 slots/components 未提供时)。
      <div className="absolute inset-0 -z-10" data-pi-chat-background>
        <SlotHost ext={extension} slot="background" />
      </div>
    ) : null;
  // 是否有自定义会话背景(扩展/宿主提供)。决定底栏渐隐遮罩是否渲染:遮罩硬编码
  // fade 到不透明 hsl(var(--background)),在自定义背景上会露出一条违和的纯色矩形带。
  const hasCustomBackground = backgroundLayer !== null;

  // 空态:slots.empty 优先,否则 components.EmptyState ?? 默认 EmptyState(Req 4.2/9.1)。
  const EmptyComp = components?.EmptyState ?? EmptyState;
  const emptyBody =
    slots?.empty !== undefined ? (
      slots.empty
    ) : (
      <EmptyComp
        title={emptyTitle}
        subtitle={emptySubtitle}
        starters={gridItems}
        onFill={onSuggestionFill}
        onSend={onSuggestionSend}
        className={lay.content}
        {...(components?.StarterCard !== undefined
          ? { StarterCard: components.StarterCard }
          : {})}
        {...(extensionUI !== undefined
          ? { interaction: <PiInteraction extensionUI={extensionUI} /> }
          : {})}
        input={inputWithWidgets}
      />
    );

  const conversationBody = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Conversation className="flex-1">
        <div
          className={cn(lay.content, "space-y-4 pt-3")}
          data-pi-chat-messages
          style={{ paddingBottom: dockHeight + 16 }}
        >
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
            const MessageComp: React.ComponentType<MessageProps> =
              components?.Message?.[message.role as MessageRole] ?? Message;
            const body = (
              <div className="space-y-2">
                {message.parts.map((part, i) => (
                  <PartRenderer
                    key={`${message.id}-${i}`}
                    part={part}
                    message={message}
                    registry={registry}
                    {...(components?.Markdown !== undefined
                      ? { markdown: components.Markdown }
                      : {})}
                    {...(components?.Reasoning !== undefined
                      ? { reasoning: components.Reasoning }
                      : {})}
                  />
                ))}
                {slots?.messageActions !== undefined ? (
                  <div data-pi-message-actions>
                    {slots.messageActions(message)}
                  </div>
                ) : null}
              </div>
            );
            const messageProps: MessageProps = {
              role: message.role,
              children: body,
              ...(copyText.length > 0 ? { copyText } : {}),
              ...(components?.MessageActions !== undefined
                ? { messageActions: components.MessageActions }
                : {}),
              ...branchProps,
            };
            return <MessageComp key={message.id} {...messageProps} />;
          })}
          <ChatError message={errorMessage} />
          {extensionUI !== undefined ? (
            <PiInteraction extensionUI={extensionUI} />
          ) : null}
        </div>
      </Conversation>

      <div
        ref={dockRef}
        data-pi-input-dock
        className="pointer-events-none absolute inset-x-0 bottom-0"
      >
        {/* 渐隐遮罩:仅默认背景下渲染(fade 到不透明壳底色)。自定义背景在场时省略,
            否则不透明色带会盖住背景;输入框自身的 frosted backdrop-blur 已提供分隔。 */}
        {hasCustomBackground ? null : (
          <div
            aria-hidden="true"
            data-pi-input-dock-fade
            className="pointer-events-none h-10 bg-gradient-to-t from-[hsl(var(--background))] to-transparent"
          />
        )}
        <div className={cn("pointer-events-auto pb-2", lay.content)}>
          {inputWithWidgets}
        </div>
      </div>
    </div>
  );

  const tree = (
    <div
      className={cn(
        "relative flex h-full w-full gap-3 text-[hsl(var(--foreground))]",
        className,
      )}
      data-pi-chat-pro
      data-pi-chat-empty={isEmpty ? "true" : "false"}
    >
      {dismissNotification !== undefined ? (
        <div className="pointer-events-none absolute right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
          <div className="pointer-events-auto">
            <Notifications
              notifications={notifications}
              onDismiss={dismissNotification}
              {...(notificationsAutoDismissMs !== undefined
                ? { autoDismissMs: notificationsAutoDismissMs }
                : {})}
            />
          </div>
        </div>
      ) : null}

      {slots?.sidebar !== undefined ? (
        <aside className="shrink-0" data-pi-chat-sidebar>
          {slots.sidebar}
        </aside>
      ) : null}

      {/* Tier1 保留插槽:扩展左栏(独立于 basic sidebar)。 */}
      <ExtSlotRegion
        ext={extension}
        slot="sidebarLeft"
        as="aside"
        className="hidden shrink-0 md:block"
      />

      {/* isolate:建本列 stacking context,使 backgroundLayer 的 -z-10 限定于此(绘于
          app-shell 不透明壳底之上、内容之下);否则负 z-index 逃逸到根上下文被壳底遮挡。 */}
      <div className="relative isolate flex min-w-0 flex-1 flex-col">
        {backgroundLayer}

        {slots?.header !== undefined ? (
          <header data-pi-chat-header>{slots.header}</header>
        ) : extension?.slots?.headerCenter !== undefined ||
          extension?.slots?.headerLeft !== undefined ||
          extension?.slots?.headerRight !== undefined ? (
          // Tier1:扩展 header 三区。
          <header
            data-pi-chat-header
            data-pi-ext-header
            className="flex items-center gap-2 px-4 py-2"
          >
            <SlotHost ext={extension} slot="headerLeft" />
            <div className="flex-1">
              <SlotHost ext={extension} slot="headerCenter" />
            </div>
            <SlotHost ext={extension} slot="headerRight" />
          </header>
        ) : null}

        {extensionHeader}

        {/* Tier1 保留插槽:扩展状态栏(与 ambient StatusBar 共存)+ 工具条。 */}
        <ExtSlotRegion ext={extension} slot="statusBar" />
        <ExtSlotRegion ext={extension} slot="toolbar" />

        {isEmpty ? (
          <div
            className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8"
            data-pi-chat-welcome
          >
            {emptyBody}
            {/* Tier1 保留插槽:扩展空态(追加,不替换默认空态)。 */}
            <ExtSlotRegion ext={extension} slot="empty" />
          </div>
        ) : (
          conversationBody
        )}

        {/* Tier1 保留插槽:扩展 artifact 表面(独立于 panelRight artifact)。 */}
        <ExtSlotRegion ext={extension} slot="artifactSurface" />

        {slots?.footer !== undefined ? (
          <footer data-pi-chat-footer>{slots.footer}</footer>
        ) : extension?.slots?.footer !== undefined ? (
          <footer data-pi-chat-footer data-pi-ext-footer>
            <SlotHost ext={extension} slot="footer" />
          </footer>
        ) : null}
      </div>

      {extension?.slots?.panelRight !== undefined ||
      (extension?.artifact !== undefined && extensionBaseUrl !== undefined) ? (
        // Tier1 panelRight + Tier4 artifact(独立 origin sandbox iframe)。
        <aside
          className="hidden w-96 shrink-0 lg:block"
          data-pi-chat-aside
          {...(extension?.slots?.panelRight !== undefined
            ? { "data-pi-ext-panel-right": "" }
            : {})}
        >
          {extension?.slots?.panelRight !== undefined ? (
            <SlotHost ext={extension} slot="panelRight" />
          ) : null}
          {extension?.artifact !== undefined && extensionBaseUrl !== undefined ? (
            <ArtifactSurface
              src={`${extensionBaseUrl.replace(/\/$/, "")}/${extension.artifact.entry}`}
              {...(extension.artifact.initialHeight !== undefined
                ? { initialHeight: extension.artifact.initialHeight }
                : {})}
            />
          ) : null}
        </aside>
      ) : lay.hasAside ? (
        <aside className="hidden w-96 shrink-0 lg:block" data-pi-chat-aside />
      ) : null}

      {/* Tier1 保留插槽:扩展通知(与 ambient Notifications 共存)。 */}
      <ExtSlotRegion ext={extension} slot="notifications" />
      {/* Tier1 保留插槽:扩展对话框层(附加 overlay,不拦截 PiInteraction 的内核交互)。 */}
      <ExtSlotRegion
        ext={extension}
        slot="dialogLayer"
        className="pointer-events-none fixed inset-0 z-[60]"
      />

      {keybindings !== undefined && keybindings.length > 0 ? (
        <span
          hidden
          data-pi-keybindings={keybindings.map((k) => k.combo).join(",")}
        />
      ) : null}

      <span hidden data-pi-busy={isBusy ? "true" : "false"} />
    </div>
  );

  const withIcons =
    icons !== undefined ? <IconsProvider icons={icons}>{tree}</IconsProvider> : tree;

  return theme !== undefined ? (
    <ThemeProvider mode={theme}>{withIcons}</ThemeProvider>
  ) : (
    withIcons
  );
}

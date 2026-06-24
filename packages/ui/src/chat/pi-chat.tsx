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
  type SuggestionMerge,
  useModels,
  useAttachments,
  type UploadAttachmentFn,
  useBranches,
  useSuggestions,
  createUiRpcBus,
  createLogsStore,
  useLogs,
  type LogHistoryFetcher,
} from "@blksails/pi-web-react";
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
  type PanelRatio,
  PANEL_RATIOS,
  PANEL_RATIO_LABEL,
  PANEL_RATIO_ASIDE_WIDTH,
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
import { PiSessionStats } from "../controls/pi-session-stats.js";
import { LogsPanel } from "../logs/logs-panel.js";
import { PiCompletionPopover } from "../completion/index.js";
import { cn } from "../lib/cn.js";
import type { WebExtension } from "@blksails/pi-web-kit";
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
  /** suggestionsPresets 与 agent 命令的合并策略;默认 "append"(命令在前)。 */
  readonly suggestionsMerge?: SuggestionMerge;
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
  /**
   * panelRight 让位的「初始」比例(对话区 : 右侧面板);仅在扩展声明 panelRight 时生效。
   * 宿主据此渲染段控切换器,运行时可在 居中/2:1/3:7 间动态切换;缺省 `2:1`(≈现行 w-96)。
   */
  readonly panelRatio?: PanelRatio;
  /** 主题模式;提供时内部包裹 ThemeProvider(Req 2)。 */
  readonly theme?: ThemeMode;
  /** 工具条控件顺序(Req 6.2);缺省用默认顺序。 */
  readonly toolbarOrder?: ReadonlyArray<ToolbarControl>;
  /** 扩展命令补全可见策略(全局开关 + 白名单);默认隐藏所有扩展命令。 */
  readonly extensionCommands?: ExtensionCommandPolicy;
  /** 是否展示内核自有会话用量状态区(PiSessionStats);默认 true。 */
  readonly showSessionStats?: boolean;
  /** 是否展示日志面板(LogsPanel);默认 false。 */
  readonly showLogs?: boolean;
  /**
   * 是否根据 logging 配置的 outputs.panelVisible 控制日志面板可见性。
   * 当 panelVisible=false 时即使 showLogs=true 也不显示面板（Req 6.6）。
   * 默认 true（面板可见）。
   */
  readonly logsPanelVisible?: boolean;
  /**
   * 日志面板位置，对应 logging 配置的 outputs.panelPosition（Req 6.1/6.2）。
   * 默认 "bottom"（底部）；"right" 为右侧；"drawer" 为抽屉模式。
   * 本任务占位声明，渲染逻辑在 8.2 实现。
   */
  readonly logsPanelPosition?: "bottom" | "right" | "drawer";
  /** 附件上传/分发端点基址(如 `/api`);缺省为同源相对路径。 */
  readonly attachmentBaseUrl?: string;
  /** 可注入的附件上传函数(默认 `@blksails/pi-web-react` 的 `uploadAttachment`);测试用以 mock。 */
  readonly uploadAttachment?: UploadAttachmentFn;
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
  suggestionsMerge,
  placeholder,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  emptySubtitle = DEFAULT_EMPTY_SUBTITLE,
  starters = DEFAULT_STARTERS,
  notificationsAutoDismissMs,
  components,
  icons,
  layout,
  panelRatio: panelRatioInitial,
  theme,
  toolbarOrder,
  extensionCommands,
  showSessionStats = true,
  showLogs = false,
  logsPanelVisible = true,
  logsPanelPosition = "bottom",
  attachmentBaseUrl,
  uploadAttachment,
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


  // 日志面板:per-session logsStore + control:logs 帧接线（Req 3.4）。
  // 一个 useMemo 保证每次 sessionId 变更时重建 store（新会话新 store，不跨会话混日志）。
  const logsStore = React.useMemo(
    () => (showLogs ? createLogsStore() : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showLogs, sessionId],
  );

  // 订阅 control:logs 帧 → logsStore.applyLogsFrame（实时链路 3.2→3.4）。
  React.useEffect(() => {
    if (logsStore === undefined || connection === undefined) return;
    return connection.controlStore.onLogsFrame((entries) => {
      logsStore.applyLogsFrame(entries);
    });
  }, [logsStore, connection]);

  // getLogs 历史拉取器（4.2 链路），仅在 showLogs 且 client+sessionId 就绪时注入。
  // LogHistoryFetcher 的 level 是 string（宽类型）；client.getLogs 的 level 是 LogLevel
  // 严类型——做桥接时把 string 向下转型为 LogLevel（调用侧已从枚举传入，运行时安全）。
  const logsFetcher = React.useMemo((): LogHistoryFetcher | undefined => {
    if (!showLogs || client === undefined || sessionId === undefined) return undefined;
    const capturedClient = client;
    const capturedSessionId = sessionId;
    return (query) =>
      capturedClient.getLogs(capturedSessionId, query as Parameters<typeof capturedClient.getLogs>[1]);
  }, [showLogs, client, sessionId]);

  // useLogs：订阅 logsStore 快照供 LogsPanel 消费（仅 showLogs 时启用）。
  const logsResult = useLogs(
    logsStore !== undefined
      ? { store: logsStore, ...(logsFetcher !== undefined ? { fetcher: logsFetcher } : {}) }
      : { store: createLogsStore() },
  );

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

  // panelRight 让位比例:以扩展声明的初始值播种,运行时由段控切换器改写。
  // 换 source(扩展声明的初始比例变化)时重置回新声明值。
  const [panelRatio, setPanelRatio] = React.useState<PanelRatio>(
    panelRatioInitial ?? "2:1",
  );
  React.useEffect(() => {
    setPanelRatio(panelRatioInitial ?? "2:1");
  }, [panelRatioInitial]);

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

  // drawer 模式状态：仅 position="drawer" 时使用，控制日志抽屉是否打开。
  const [drawerOpen, setDrawerOpen] = React.useState<boolean>(false);

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
  // 附件摄入接异步上传:add 回调经 useAttachments 落库换正式 id(发消息只带引用)。
  const attachments = useAttachments({
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(attachmentBaseUrl !== undefined ? { baseUrl: attachmentBaseUrl } : {}),
    ...(uploadAttachment !== undefined ? { upload: uploadAttachment } : {}),
  });
  const branches = useBranches({
    sessionId,
    ...(client !== undefined ? { client } : {}),
    available: client !== undefined,
  });
  const suggestions = useSuggestions({
    ...(controls !== undefined ? { controls } : {}),
    ...(suggestionsPresets !== undefined ? { presets: suggestionsPresets } : {}),
    ...(suggestionsMerge !== undefined ? { merge: suggestionsMerge } : {}),
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

  // 内核用量区数据填充:服务端不主动推送 stats 控制帧,故按"重新拉取"策略
  // (需求 3.1)填充 controls.stats —— 会话就绪拉取一次,每轮回复结束
  // (streaming → idle)再拉取一次,保持用量(tokens/cost/messages/toolCalls)最新。
  const statsWasBusyRef = React.useRef<boolean>(false);
  const statsSessionRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (showSessionStats && controls !== undefined && sessionId !== undefined) {
      const firstForSession = statsSessionRef.current !== sessionId;
      const turnJustEnded = statsWasBusyRef.current && !isBusy;
      if (firstForSession || turnJustEnded) {
        statsSessionRef.current = sessionId;
        void controls.getStats().catch(() => undefined);
      }
    }
    statsWasBusyRef.current = isBusy;
  }, [showSessionStats, controls, sessionId, isBusy]);

  // 空闲期 Tier3 贡献点(slash/mention/autocomplete)需持久控制通道:per-prompt 消息流仅在发送时
  // 打开。故仅当**扩展声明了 contributions**(需 ui-rpc)且**空闲时**才另开一条「仅 ui-rpc」订阅
  // ——无贡献点的 agent 不开(零干扰),prompt 期关闭(由 per-prompt 流处理 control 帧),
  // 避免与 per-prompt 流并存导致流冲突。使 idle 输入 "/"/"@" 触发的 ui-rpc 回包能投递(R10/R11/R20)。
  const hasContributions = extension?.contributions !== undefined;
  // artifact 的 rpc 回调(iframe→agent)同样依赖空闲下行通道配对响应;与 contributions 同理需要
  // 持久控制流。原 prompt-流回归仅针对**完全不需要 ui-rpc** 的 agent(既无 contributions 也无
  // artifact),故对带 artifact 的 agent 开通是正确的,不重蹈该回归。
  const hasArtifactRpc =
    extension?.artifact !== undefined && extensionBaseUrl !== undefined;
  const needsIdleControl = hasContributions || hasArtifactRpc;
  React.useEffect(() => {
    if (connection === undefined || isBusy || !needsIdleControl) return;
    return connection.openControlOnlyStream();
  }, [connection, isBusy, needsIdleControl]);
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

      // vision 现状:仍按 base64 发图(toImageContents);不动 prompt({images}) 链路。
      const images = hasAttachments ? attachments.toImageContents() : [];
      // 引用提交:以 server 铸造的正式公开 id(att_…)作为附件标识(先落库后引用),
      // 发消息不要求把附件字节内联到列表/提交身份(Req 5.3/3.5)。仅 ready 项计入。
      const attachmentIds = hasAttachments
        ? (attachments.referenceIds?.() ?? [])
        : [];

      const body: Record<string, unknown> = {};
      if (images.length > 0) body.images = images;
      if (attachmentIds.length > 0) body.attachmentIds = attachmentIds;

      // 给乐观 user 消息挂上图片 file part,实时内联显示用户自己发的图(PartRenderer file 分支)。
      // 纯前端展示:上行仍只走 body.images/attachmentIds(transport 不序列化 parts);刷新后由
      // get_messages 历史重建图片 part。故无需会话序号对齐或 IndexedDB 暂存(见 toFileParts 注释)。
      const files = hasAttachments ? (attachments.toFileParts?.() ?? []) : [];

      void sendMessage(
        files.length > 0 ? { text: outgoing, files } : { text: outgoing },
        Object.keys(body).length > 0 ? { body } : undefined,
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

  // 对话 → artifact 推送(正向):取最新 assistant 文本,经 ArtifactSurface 的 push 通道
  // postMessage 进 iframe,使对话/LLM 输出实时驱动并修改 artifact 表面(流式逐帧更新)。
  const latestAssistantText = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role !== "assistant") continue;
      const text = m.parts
        .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
      return text.length > 0 ? text : undefined;
    }
    return undefined;
  }, [messages]);

  const lay = layoutClassNames(layout);

  // panelRight 让位比例解析:仅扩展声明 panelRight 时启用切换器;artifact-only aside 沿用固定 w-96。
  const hasPanelRight = extension?.slots?.panelRight !== undefined;
  const hasArtifactAside =
    extension?.artifact !== undefined && extensionBaseUrl !== undefined;
  const panelRatioActive = hasPanelRight;
  // centered 收起 panelRight(对话居中);artifact 永不被比例收起。
  const showPanelRight = hasPanelRight && panelRatio !== "centered";
  // 日志 right 位置：showLogs && logsPanelVisible && position="right" 时 aside 也需打开。
  const showLogsRight = showLogs && logsPanelVisible && logsPanelPosition === "right";
  const showAside = showPanelRight || hasArtifactAside || showLogsRight;
  const asideWidth = panelRatioActive
    ? PANEL_RATIO_ASIDE_WIDTH[panelRatio]
    : undefined;

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
      {/* core 触发符补全(平台级,知道 sessionId);接管 @ 等服务端 provider 触发符。 */}
      {client !== undefined && sessionId !== undefined ? (
        <div className="absolute bottom-full left-0 right-0 z-50">
          <PiCompletionPopover
            value={input}
            cursor={input.length}
            onChange={setInput}
            client={client}
            sessionId={sessionId}
            onCaptureChange={setCommandCapturing}
          />
        </div>
      ) : null}
      {/* webext 专属 mention:core 启用时让位(避免与 core 的 @ 双浮层,D-6)。 */}
      {extension?.contributions?.mention !== undefined &&
      uiRpc !== undefined &&
      !(client !== undefined && sessionId !== undefined) ? (
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
          className={cn(lay.content, "space-y-4 px-3 pt-3 md:px-0")}
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
                    {...(components?.ToolPart !== undefined
                      ? { toolPart: components.ToolPart }
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
        <div className={cn("pointer-events-auto px-3 pb-2 md:px-0", lay.content)}>
          {inputWithWidgets}
          {/* 内核自有会话用量条(非 webext slot):随输入 dock 底部固定,置于输入框下方,
              与输入框同宽同居中(共用 lay.content),不增列高、不溢出;与顶部 webext
              statusBar(:887)错开并存。 */}
          {showSessionStats && controls !== undefined ? (
            <div
              data-pi-session-stats-region
              className="mt-1.5 rounded-2xl bg-[hsl(var(--background))]/80 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/65"
            >
              <PiSessionStats controls={controls} />
            </div>
          ) : null}
          {/* bottom 位置（默认）：dock 下方渲染日志面板 */}
          {showLogs && logsPanelVisible && logsPanelPosition === "bottom" ? (
            <>
              <div
                data-pi-logs-region
                className="mt-1.5 rounded-2xl bg-[hsl(var(--background))]/80 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/65"
              >
                <LogsPanel logsResult={logsResult} />
              </div>
              {/* Tier1 保留插槽:扩展 logs 贡献（与内核 LogsPanel 并存，追加语义）。 */}
              <ExtSlotRegion ext={extension} slot="logs" />
            </>
          ) : null}
          {/* drawer 位置：toggle 按钮（showLogs && logsPanelVisible 门控）+ 底部抽屉覆盖层 */}
          {showLogs && logsPanelVisible && logsPanelPosition === "drawer" ? (
            <>
              <button
                type="button"
                data-pi-logs-drawer-toggle
                aria-label={drawerOpen ? "收起日志抽屉" : "展开日志抽屉"}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((v) => !v)}
                className="mt-1.5 text-xs px-2.5 py-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-md text-[hsl(var(--foreground))] opacity-70 hover:opacity-100 transition-opacity"
              >
                日志
              </button>
              {drawerOpen ? (
                <div
                  data-pi-logs-region
                  className="fixed inset-x-0 bottom-0 z-50 max-h-[40vh] flex flex-col bg-[hsl(var(--background))] border-t border-[hsl(var(--border))] shadow-lg overflow-hidden"
                >
                  <LogsPanel logsResult={logsResult} className="flex-1 min-h-0" />
                  {/* Tier1 保留插槽:扩展 logs 贡献（与内核 LogsPanel 并存，追加语义）。 */}
                  <ExtSlotRegion ext={extension} slot="logs" />
                </div>
              ) : null}
            </>
          ) : null}
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
        <div className="pointer-events-none absolute right-4 top-4 z-50 flex w-full max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-sm">
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

      {showAside ? (
        // Tier1 panelRight + Tier4 artifact(独立 origin sandbox iframe)。
        // panelRatioActive 时宽度由比例百分比驱动(对话列 flex-1 吃余量);否则沿用固定 w-96。
        <aside
          className={cn(
            "hidden shrink-0 lg:block",
            panelRatioActive ? "" : "w-96",
          )}
          {...(asideWidth !== undefined ? { style: { width: asideWidth } } : {})}
          data-pi-chat-aside
          {...(panelRatioActive
            ? { "data-pi-panel-ratio": panelRatio }
            : {})}
          {...(showPanelRight ? { "data-pi-ext-panel-right": "" } : {})}
        >
          {showPanelRight ? (
            <SlotHost ext={extension} slot="panelRight" />
          ) : null}
          {/* right 位置：日志面板作为 aside 内独立区块（与 panelRight/artifact 共存）*/}
          {showLogsRight ? (
            <div
              data-pi-logs-region
              className="p-2 overflow-y-auto"
            >
              <LogsPanel logsResult={logsResult} />
              {/* Tier1 保留插槽:扩展 logs 贡献（与内核 LogsPanel 并存，追加语义）。 */}
              <ExtSlotRegion ext={extension} slot="logs" />
            </div>
          ) : null}
          {extension?.artifact !== undefined && extensionBaseUrl !== undefined ? (
            <ArtifactSurface
              src={`${extensionBaseUrl.replace(/\/$/, "")}/${extension.artifact.entry}`}
              {...(extension.artifact.initialHeight !== undefined
                ? { initialHeight: extension.artifact.initialHeight }
                : {})}
              {...(uiRpc !== undefined ? { rpc: uiRpc } : {})}
              {...(latestAssistantText !== undefined
                ? {
                    push: {
                      name: "assistant-message",
                      data: { text: latestAssistantText },
                    },
                  }
                : {})}
            />
          ) : null}
        </aside>
      ) : null}

      {/* panelRight 比例切换器:有 panelRight 时常驻右下角(lg+),运行时在 居中/2:1/3:7 间切换。
          置于 aside 之外、tree(relative)内,使 centered 收起面板后仍可切回。 */}
      {panelRatioActive ? (
        <div
          data-pi-panel-ratio-switch={panelRatio}
          className="absolute bottom-4 right-4 z-40 hidden items-center gap-0.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 p-0.5 shadow-sm backdrop-blur lg:flex"
        >
          {PANEL_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              data-pi-ratio-option={r}
              data-active={r === panelRatio ? "true" : "false"}
              aria-pressed={r === panelRatio}
              onClick={() => setPanelRatio(r)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                r === panelRatio
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
              )}
            >
              {PANEL_RATIO_LABEL[r]}
            </button>
          ))}
        </div>
      ) : null}
      {/* split 让位区:仅在有实际内容(panelRight/artifact,见上)时渲染 aside。
          无内容时不再渲染空的占位 <aside> —— 否则 lg 视口下会留出一整列 384px 空白
          (内容被挤向左、右侧出现「分离的空白浮动区域」)。典型触发:声明式扩展仅设
          config.layout="split" 却无 panelRight 可填充让位区。split 缺内容时优雅退化为
          居中版面(content 宽度本就与 centered 同为 max-w-3xl),不留空白。 */}

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

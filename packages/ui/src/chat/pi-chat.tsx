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
  uploadAttachment as defaultUploadAttachment,
  useBranches,
  useSuggestions,
  createUiRpcBus,
  executeHostCommand,
  type CommandOutcome,
  createLogsStore,
  useLogs,
  type LogHistoryFetcher,
} from "@blksails/pi-web-react";
import { PartRenderer } from "./part-renderer.js";
import { registerBuiltinDataPartRenderers } from "./builtin-data-part-renderers.js";
import { BashResultRenderer } from "./bash-result-renderer.js";
import type { PiChatSlots } from "./slots.js";
import { PiQueuePanel } from "./pi-queue-panel.js";
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
import { useI18n } from "../i18n/index.js";
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
import { createPluginArgProvider } from "../controls/plugin-arg-provider.js";
import type { ExtensionCommandPolicy } from "../controls/pi-command-palette.js";
import type { RpcSlashCommand, CompletionItem } from "@blksails/pi-web-protocol";
import { PiMentionPopover } from "../controls/pi-mention-popover.js";
import { PiAutocompletePopover } from "../controls/pi-autocomplete-popover.js";
import { PiSessionStats } from "../controls/pi-session-stats.js";
import { LogsPanel } from "../logs/logs-panel.js";
import {
  PiCompletionPopover,
  PiMentionPreviews,
  removeAttachmentMention,
  type MentionPreview,
} from "../completion/index.js";
import { cn } from "../lib/cn.js";
import type { WebExtension, ConversationAccess } from "@blksails/pi-web-kit";
import { createWebExtStateAccess, createWebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { SurfaceCommandResultSchema } from "@blksails/pi-web-protocol";
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

/**
 * 宿主可达的附件 API(经 `attachmentsApiRef` 暴露)。让根应用/扩展把**已落库**的既有附件
 * 按 `att_` id 注入**当前 composer** 的待发引用集,从而随正常发送(`body.attachmentIds`)一并上行。
 * 典型场景:把素材抽屉里的已生成图拖进/`@` 引用进对话框作 `image_edit` 等工具的输入图。
 */
export interface PiChatAttachmentsApi {
  addReference(
    refs: ReadonlyArray<{
      readonly attachmentId: string;
      readonly displayUrl?: string;
      readonly name?: string;
      readonly mimeType?: string;
    }>,
  ): void;
}

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
  /**
   * 会话就绪握手门控(spec session-readiness-handshake)。开启时:在收到会话 `ready` 前禁用发送、
   * 呈现"连接中",并打开空闲控制流以接收粘性 session-status 帧;`error` 态呈现失败提示并保持禁用。
   * **默认 false**(向后兼容:不门控,既有行为不变)。需与服务端 readinessHandshake 一致由 app 接线开启。
   */
  readonly gateUntilReady?: boolean;
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
  /** harness 内置命令(source==="builtin");前置合流到命令面板(builtin-plugin-command)。 */
  readonly builtinCommands?: readonly RpcSlashCommand[];
  /**
   * 选中内置命令时的分派回调(执行 harness 逻辑,不进 LLM)。
   * @deprecated 统一命令层(unified-command-result-layer):内置命令改经 ui-rpc command 通道
   * 执行,结果经 `onCommandResult` 回调。仅在无 ui-rpc 总线/无 onCommandResult 时回退。
   */
  readonly onBuiltinSelect?: (command: RpcSlashCommand, rawValue: string) => void;
  /**
   * 内置/host 命令经统一命令通道执行后的结果回调(事件驱动 UI:面板/通知/刷新)。
   * 提供后,内置命令由 PiChat 经 ui-rpc 总线执行(point=command),不再走 onBuiltinSelect。
   */
  readonly onCommandResult?: (commandName: string, outcome: CommandOutcome) => void;
  /**
   * 装/卸插件命令(`/plugin`、`/reload-runtime`)提交时触发,供宿主驱动 webext 重载——
   * 装后即时双路生效之路②(spec plugin-system-unification,Req 7;路①为 runner reload)。
   */
  readonly onRuntimeReloadRequested?: () => void;
  /**
   * 一轮 agent 运行结束(submitted/streaming → idle 边沿)回调。宿主据此做「每轮收尾」副作用,
   * 典型为刷新会话历史列表:新会话镜像落库与 auto_title 自动标题持久化均在 `agent_end` 时完成,
   * 故每轮结束后重拉列表即可及时反映新会话与最新标题(与内核 stats 的「每轮结束重拉」同构)。
   */
  readonly onTurnEnd?: () => void;
  /** 是否展示内核自有会话用量状态区(PiSessionStats);默认 true。 */
  readonly showSessionStats?: boolean;
  /** 是否展示日志面板(LogsPanel);默认 false。 */
  readonly showLogs?: boolean;
  /**
   * 是否启用 bang(`!`)shell 命令的**前端体验**(spec bang-shell-command,Req 5.5/6.4);默认 false。
   * 开启时:输入以 `!`/`!!` 开头被识别为 bash 命令(经 client.bash 执行、不进 LLM),输入框显示
   * bash 模式视觉提示。关闭时:`!` 文本按普通消息发送给 LLM,且无视觉提示。
   * 注:这是体验开关;服务端权威门控独立(`PI_WEB_BASH_ENABLED`),关闭时端点返回 404。
   */
  readonly enableBash?: boolean;
  /**
   * 是否根据 logging 配置的 outputs.panelVisible 控制日志面板可见性。
   * 当 panelVisible=false 时即使 showLogs=true 也不显示面板（Req 6.6）。
   * 默认 true（面板可见）。
   */
  readonly logsPanelVisible?: boolean;
  /**
   * 日志面板位置，对应 logging 配置的 outputs.panelPosition（Req 6.1/6.2）。
   * 默认 "bottom"（底部）；"right" 为右侧；"drawer" 为抽屉模式；"top" 为顶部横条
   * (置于对话/空态之上,利用无 head 后的顶部空间)。
   */
  readonly logsPanelPosition?: "bottom" | "right" | "drawer" | "top";
  /** 附件上传/分发端点基址(如 `/api`);缺省为同源相对路径。 */
  readonly attachmentBaseUrl?: string;
  /** 可注入的附件上传函数(默认 `@blksails/pi-web-react` 的 `uploadAttachment`);测试用以 mock。 */
  readonly uploadAttachment?: UploadAttachmentFn;
  /**
   * 宿主附件 API 出口(命令式):PiChat 在挂载后把 `{ addReference }` 写入该 ref.current,
   * 卸载时置空。宿主据此把既有素材以引用形态注入当前 composer(见 {@link PiChatAttachmentsApi})。
   */
  readonly attachmentsApiRef?: React.RefObject<PiChatAttachmentsApi | null>;
  readonly className?: string;
}

// agent-slash-completion:"/" 触发符让 PiCommandPalette 单浮层独占,从 core 补全浮层
// (PiCompletionPopover)排除,避免双浮层冲突。模块级常量保证引用稳定(effect 依赖)。
const SLASH_EXCLUDED_TRIGGERS: readonly string[] = ["/"];
/** 稳定空队列引用(controls 缺失时的回退,避免每次渲染换引用)。 */
const EMPTY_QUEUE_VIEW: { steering: readonly string[]; followUp: readonly string[] } = {
  steering: [],
  followUp: [],
};

const EMPTY_NOTIFICATIONS: UseExtensionUIResult["notifications"] = [];
const EMPTY_STATUSES: UseExtensionUIResult["statuses"] = {};

const DEFAULT_TOOLBAR_ORDER: ReadonlyArray<ToolbarControl> = [
  "attachments",
  "model",
  "speech",
  "webSearch",
  "submit",
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

/** 从工具结果 content 里抽第一张内联 data:image URI(`![](data:image/…)`)。 */
function dataImageFromToolOutput(output: unknown): string | undefined {
  const content = (output as { content?: ReadonlyArray<{ text?: unknown }> } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  for (const c of content) {
    if (typeof c?.text === "string") {
      const m = /!\[[^\]]*\]\((data:image\/[^)\s]+)\)/.exec(c.text);
      if (m?.[1] !== undefined) return m[1];
    }
  }
  return undefined;
}

/**
 * 宿主转发:从**最近一条 assistant 消息**里抽正在流式(`preliminary`)的 AIGC 工具(image_generation/
 * image_edit)的内联 data:image 预览。图已随对话流到达浏览器(经 pi 稳健 RPC,非状态桥),故画布
 * 面板可零成本复用这张「由糊变清」渐进图,规避 surface 大帧经 fd1 损坏的问题(见画布域 schema)。
 */
function latestToolImagePreview(messages: readonly UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    const parts = m.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const p = parts[j] as {
        type?: string;
        state?: string;
        preliminary?: boolean;
        output?: unknown;
      };
      const t = p.type;
      const isAigcTool =
        typeof t === "string" &&
        (t.startsWith("tool-image_generation") ||
          t.startsWith("tool-image_edit") ||
          t === "dynamic-tool");
      if (!isAigcTool) continue;
      if (p.state !== "output-available" || p.preliminary !== true) continue;
      const url = dataImageFromToolOutput(p.output);
      if (url !== undefined) return url;
    }
    return undefined; // 仅看最近一条 assistant(当前轮)
  }
  return undefined;
}

export function PiChat({
  session,
  controls,
  extensionUI,
  registry = defaultRendererRegistry,
  extension,
  extensionBaseUrl,
  slots,
  gateUntilReady,
  suggestionsPresets,
  suggestionsMerge,
  placeholder,
  emptyTitle: emptyTitleProp,
  emptySubtitle: emptySubtitleProp,
  starters: startersProp,
  notificationsAutoDismissMs,
  components,
  icons,
  layout,
  panelRatio: panelRatioInitial,
  theme,
  toolbarOrder,
  extensionCommands,
  builtinCommands,
  onBuiltinSelect,
  onCommandResult,
  onRuntimeReloadRequested,
  onTurnEnd,
  showSessionStats = true,
  showLogs = false,
  enableBash = false,
  logsPanelVisible = true,
  logsPanelPosition = "bottom",
  attachmentBaseUrl,
  uploadAttachment,
  attachmentsApiRef,
  className,
}: PiChatProps): React.JSX.Element {
  const t = useI18n();
  const emptyTitle = emptyTitleProp ?? t("chat.empty.title");
  const emptySubtitle = emptySubtitleProp ?? t("chat.empty.subtitle");
  const defaultStarters = React.useMemo<ReadonlyArray<Suggestion>>(
    () => [
      {
        id: "starter-nextjs",
        label: t("chat.starter.nextjs"),
        value: t("chat.starter.nextjs"),
        mode: "fill",
      },
      {
        id: "starter-dijkstra",
        label: t("chat.starter.dijkstra"),
        value: t("chat.starter.dijkstra"),
        mode: "fill",
      },
      {
        id: "starter-essay",
        label: t("chat.starter.essay"),
        value: t("chat.starter.essay"),
        mode: "fill",
      },
      {
        id: "starter-weather",
        label: t("chat.starter.weather"),
        value: t("chat.starter.weather"),
        mode: "fill",
      },
    ],
    [t],
  );
  const starters = startersProp ?? defaultStarters;
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
  // 状态注入桥(state-injection-bridge):webext 共享状态接入,接到前端 ControlStore.states +
  // client.setState 写回。经 prop 透给 slot 组件(见 SlotHost.state)。会话/连接就绪时构造。
  const webextState = React.useMemo(() => {
    if (client === undefined || sessionId === undefined || connection === undefined) {
      return undefined;
    }
    const cs = connection.controlStore;
    const sid = sessionId;
    const c = client;
    return createWebExtStateAccess({
      read: (key) => cs.getSnapshot().states[key]?.value,
      subscribe: (listener) => cs.subscribe(listener),
      write: (key, value, op) =>
        c.setState(sid, { key, value, op }).then(() => undefined),
    });
  }, [client, sessionId, connection]);

  // 权威 surface 接入(agent-authoritative-surface):webext slot 经 prop 取得领域无关的
  // 命令上行(uiRpc bus,run)+ 状态读/订阅(ControlStore.states)+ 能力探针(controls.commands)。
  // domain 对宿主不透明(领域无关搬运);命令走 ui-rpc agent 转发路径(payload 无 name → 逃逸 host
  // 拦截 → 子进程 wireSurfaceBridge 派发)。会话/连接/总线就绪时构造。
  const surfaceAccess = React.useMemo(() => {
    if (uiRpc === undefined || connection === undefined) return undefined;
    const cs = connection.controlStore;
    const bus = uiRpc;
    return createWebExtSurfaceAccess({
      run: async (domain, action, args) => {
        const resp = await bus.request({
          point: "command",
          action: "execute",
          payload: { domain, action, args },
        });
        const parsed = SurfaceCommandResultSchema.safeParse(resp.result);
        if (parsed.success) return parsed.data;
        return {
          domain,
          action,
          ok: false,
          error: resp.error ?? {
            code: "invalid_result",
            message: "surface command result malformed",
          },
        };
      },
      read: (key) => cs.getSnapshot().states[key]?.value,
      subscribe: (listener) => cs.subscribe(listener),
      hasCommand: (name) => (controls?.commands ?? []).some((cmd) => cmd.name === name),
    });
  }, [uiRpc, connection, controls?.commands]);

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
    // pi-web 自定义 data-part(data-pi-ui)经单一真相源 PART_KINDS 遍历注册
    //(session-snapshot-authority STEP4):不可能漏注册,孤儿渲染器由契约测试静态排除(Req 6.4/6.5)。
    registerBuiltinDataPartRenderers(registry);
    // bang shell 命令结果卡片(spec bang-shell-command,Req 4.x)。
    registry.registerDataPartRenderer("data-bash-result", BashResultRenderer);
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
  // 宿主转发给 panelRight slot(如画布面板)的最新流式 AIGC 图像预览(由糊变清);仅当前轮 preliminary。
  const livePreviewImage = React.useMemo(
    () => latestToolImagePreview(messages),
    [messages],
  );
  // 注:不在 render 期解构 `chat.setMessages`(ai-sdk v5 的 useChat 返回对象上某些字段读取会
  // 触发额外重渲染,曾导致无限循环);/clear 的清空在 dispatchBuiltin 回调内按需访问 chat.setMessages。
  const chatRef = React.useRef(chat);
  chatRef.current = chat;

  const errorMessage: string | undefined =
    error !== undefined
      ? error.message
      : status === "error"
        ? t("chat.error.generic")
        : undefined;

  const [input, setInput] = React.useState<string>("");
  const [webSearch, setWebSearch] = React.useState<boolean>(false);

  // attachment-mention-preview:选中 `@` 附件候选时捕获其预览(id → name/previewUrl),
  // 供输入区 PiMentionPreviews 渲染缩略图。候选自带 previewUrl(见 pi-client getCompletion)。
  const [mentionPreviews, setMentionPreviews] = React.useState<
    ReadonlyMap<string, MentionPreview>
  >(new Map());
  const onCompletionAccept = React.useCallback((item: CompletionItem): void => {
    if (item.kind !== "attachment") return;
    setMentionPreviews((prev) => {
      const next = new Map(prev);
      next.set(item.id, {
        name: item.label,
        ...(item.previewUrl !== undefined ? { previewUrl: item.previewUrl } : {}),
      });
      return next;
    });
  }, []);
  const onRemoveMention = React.useCallback((id: string): void => {
    setInput((v) => removeAttachmentMention(v, id));
  }, []);

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

  // 真实光标接线(completion-cursor-anchor):inputRef 供 caret 测量/选区复位;cursor 为
  // textarea 当前 selectionStart,驱动 core 补全在文本任意位置激活与锚定。
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = React.useState<number>(0);

  // /plugin 子命令/参数补全 provider(plugin-subcommand-completion):有 client+sessionId 时
  // 构造,经现成 GET /extensions 与 install-sources 端点取候选。
  const commandArgProvider = React.useMemo(() => {
    if (client === undefined || sessionId === undefined) return undefined;
    return createPluginArgProvider({ baseUrl: client.baseUrl, sessionId });
  }, [client, sessionId]);

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
  // 宿主附件 API 出口:把 addReference 命令式暴露给宿主(挂载写入、卸载置空)。
  const addReference = attachments.addReference;
  React.useEffect(() => {
    if (attachmentsApiRef === undefined) return;
    attachmentsApiRef.current = { addReference };
    return () => {
      attachmentsApiRef.current = null;
    };
  }, [attachmentsApiRef, addReference]);
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

  // 权威 busy(session-snapshot-authority):有 session-state 快照时取服务端权威 busy
  //(纯投影,不再从 useChat.status 时序推断);无快照(legacy / 机制关闭)时回退到 status,
  // 行为完全不变。这一改根治「扩展命令不发 agent_end → 永久卡 busy」(busy 由轮次边界权威派生)。
  const isBusy =
    controls?.session !== undefined
      ? controls.busy
      : status === "submitted" || status === "streaming";

  // message-queue-ui:排队快照(纯投影自 control:queue)与派生的取回可用性 + 瞬态提示。
  const queue = controls?.queue ?? EMPTY_QUEUE_VIEW;
  const pendingCount = queue.steering.length + queue.followUp.length;
  const canRetrieve = pendingCount > 0;
  const [queueNotice, setQueueNotice] = React.useState<string | undefined>(
    undefined,
  );

  // 内核用量区数据填充:stats 的**读**单一取自权威快照(controls.stats,由 stats 帧 / session-state
  // 同步喂),不再双源 merge;此处仅以**事件驱动**(会话就绪一次 + 轮次结束一次,非定时轮询)
  // 触发 getStats 让 agent 刷新用量(随即经 session-state 广播给所有订阅者)。
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

  // 一轮运行结束(submitted/streaming → idle 边沿)→ 通知宿主做每轮收尾副作用(如刷新会话历史)。
  // 与上方 stats「每轮结束重拉」同构,但不受 showSessionStats 门控:无论是否展示用量区都广播。
  const turnEndWasBusyRef = React.useRef<boolean>(false);
  // panelRight slot 的轮末同步信号:每轮 idle 边沿递增,经 SlotHost 透给 slot 组件。
  // 画布画廊据此在 LLM 生图后 `run("sync")` 重建物化视图(否则 tool-output 图要等下次
  // 会话重连 hydrate 才进画廊——生图当场画廊不刷新)。领域无关:宿主只广播"一轮结束了"。
  const [panelSyncSignal, setPanelSyncSignal] = React.useState<number>(0);
  React.useEffect(() => {
    if (turnEndWasBusyRef.current && !isBusy) {
      onTurnEnd?.();
      setPanelSyncSignal((v) => v + 1);
    }
    turnEndWasBusyRef.current = isBusy;
  }, [isBusy, onTurnEnd]);

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
  // 注:host/内置命令结果走**同步 HTTP 响应体**(POST /ui-rpc 直接返回),不依赖空闲控制流,
  // 故此处不因内置命令开持久控制流(避免重蹈 prompt-流冲突回归)。
  // 就绪握手(spec session-readiness-handshake):仅当显式开启 gateUntilReady 且提供 controls 时门控
  //(handshake-off 消费者/测试不设此 prop,行为完全不变)。sessionReady 取自 control 旁路的 lifecycle。
  const lifecycle = controls?.lifecycle;
  const readinessGating = gateUntilReady === true && controls !== undefined;
  const sessionReady = !readinessGating || lifecycle?.state === "ready";
  const sessionReadinessError =
    readinessGating && lifecycle?.state === "error";
  // agent 扩展命令(registerCommand,如 /review、/plugin)经 fire-and-forget 投递、不开 per-prompt
  // 消息流(R15:命令是动作,无气泡、不进历史);其 ctx.ui 反馈(notify/setWidget)走控制帧,需有打开
  // 的下行流才能投递。故派发扩展命令时临时点亮此标志,在有界窗口内开「仅控制」流承载反馈,窗口后
  // 自动熄灭(不对所有 agent 常开,避免 prompt-流回归)。无 webext 的纯 registerCommand 扩展尤其需要
  // (否则 needsIdleControl 为 false,fire-and-forget 后 ctx.ui notify 会丢)。
  const [extCtrlActive, setExtCtrlActive] = React.useState(false);
  const extCtrlTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const armExtControlStream = React.useCallback((): void => {
    setExtCtrlActive(true);
    if (extCtrlTimerRef.current !== undefined) clearTimeout(extCtrlTimerRef.current);
    // 命令 + ctx.ui 通常数秒内完成(pi list 较慢约 10s+);给足窗口后熄灭。
    extCtrlTimerRef.current = setTimeout(() => setExtCtrlActive(false), 30_000);
  }, []);
  React.useEffect(
    () => () => {
      if (extCtrlTimerRef.current !== undefined) clearTimeout(extCtrlTimerRef.current);
    },
    [],
  );
  // panelRight slot 是唯一被注入 `surface`(WebExtSurfaceAccess)的槽(launcherRail 拿不到 surface,
  // 见画布域 web.config 注释)。agent-authoritative-surface / AIGC 画布域的 surface 命令在**空闲期**
  // 触发,其权威快照回流(control:"state",key=surface:<domain>)只能由空闲控制流承载并应用进
  // ControlStore.states——故声明 panelRight 的 webext 须在空闲期常开该流,否则命令后的快照更新丢失
  // (计数停初值 / 画廊新图不进廊)。与 contributions/artifact 同理需要持久下行通道;由 `!isBusy`
  // 门控保证仅空闲期开(prompt 期由 per-prompt 流处理 control 帧,不重蹈 prompt-流回归)。
  const hasSurfacePanel = extension?.slots?.panelRight !== undefined;
  // 空闲控制流开启条件:有贡献点(Tier3 回包)/ artifact rpc / panelRight surface 槽 / 就绪握手未就绪期
  //(接粘性 session-status)/ 扩展命令窗口(extCtrlActive,承载 fire-and-forget 命令的 ctx.ui 反馈)。
  const needsIdleControl =
    hasContributions ||
    hasArtifactRpc ||
    hasSurfacePanel ||
    (readinessGating && !sessionReady) ||
    extCtrlActive;
  React.useEffect(() => {
    if (connection === undefined || isBusy || !needsIdleControl) return;
    // 空闲控制流恒应用 ambient(notify/status/widget)帧。纯命令(无 agent_start)下服务端 busy 仍 false,
    // 故此流与 per-prompt chunk 流可能并存且都应用同一 notify 帧——由 controlStore 按帧 id **幂等去重**
    // 保证只显示一条(见 control-store.appendNotification),无需靠关流避免重复(关流会漏掉迟到 notify)。
    // (此前 gate 到 extCtrlActive 会令"有 contributions、流已 applyAmbient:false 打开"的扩展收不到
    //  session_start 等 ctx.ui notify——故恒 true,plugin-system-unification R10 修复。)
    return connection.openControlOnlyStream({ applyAmbient: true });
  }, [connection, isBusy, needsIdleControl]);
  const canSubmit =
    transport !== undefined &&
    sessionReady &&
    (input.trim().length > 0 || attachments.items.length > 0);

  const doSend = React.useCallback(
    (
      text: string,
      opts?: { followUp?: boolean; attachmentIds?: readonly string[] },
    ): void => {
      if (transport === undefined) return;
      const trimmed = text.trim();
      const hasAttachments = attachments.items.length > 0;
      if (trimmed.length === 0 && !hasAttachments) return;

      const webSearchHint = t("chat.webSearchHint");
      const outgoing = !webSearch
        ? trimmed
        : trimmed.length > 0
          ? `${trimmed}\n\n${webSearchHint}`
          : webSearchHint;

      // vision 现状:仍按 base64 发图(toImageContents);不动 prompt({images}) 链路。
      const images = hasAttachments ? attachments.toImageContents() : [];
      // 引用提交:以 server 铸造的正式公开 id(att_…)作为附件标识(先落库后引用),
      // 发消息不要求把附件字节内联到列表/提交身份(Req 5.3/3.5)。仅 ready 项计入。
      // composer 既有引用 + 调用方显式引用,合并追加并去重(bringToConversation 依此)。
      // 无显式 ids 时结果与原「仅 composer 引用」字节级一致(无 opts 路径零行为变化)。
      const composerIds = hasAttachments
        ? (attachments.referenceIds?.() ?? [])
        : [];
      const explicitIds = opts?.attachmentIds ?? [];
      const attachmentIds =
        explicitIds.length > 0
          ? [
              ...composerIds,
              ...explicitIds.filter((id) => !composerIds.includes(id)),
            ]
          : composerIds;

      // message-queue-ui:忙时按投递意图排队(Enter→steer / Alt+Enter→followUp),始终携带排队行为
      // (根治 pi SDK「streaming 缺 streamingBehavior」报错,Req 1.1/1.2/4.1)。空闲时走既有 prompt 链路
      // (含附件/补全,零回归,Req 1.3/5.3)。steer/follow_up 端点仅收 message+images,不收 att_ 引用:
      // 忙时带引用附件 → 阻止排队并提示(不静默丢弃,Req 5.2)。
      if (isBusy && controls !== undefined) {
        if (attachmentIds.length > 0) {
          setQueueNotice(t("chat.queue.attachmentUnsupported"));
          return;
        }
        const req =
          images.length > 0 ? { message: outgoing, images } : { message: outgoing };
        const enqueue = opts?.followUp ? controls.followUp : controls.steer;
        void enqueue(req)
          .then(() => {
            setInput("");
            if (hasAttachments) attachments.clear();
            setRejected([]);
            setQueueNotice(undefined);
          })
          .catch(() => {
            // 失败:可见反馈且不清输入(不丢用户输入,Req 4.2)。
            setQueueNotice(t("chat.queue.enqueueFailed"));
          });
        return;
      }

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
      setQueueNotice(undefined);
    },
    [transport, attachments, webSearch, sendMessage, t, isBusy, controls],
  );

  // 宿主会话能力对象(契约 §4.2;与 webextState / surfaceAccess 同族)。承载「经宿主 Prompt 通道提交
  // 用户消息」这一能力,经 SlotHost 注入 slot 组件,取代事件回调形态的裸注入项 onSubmitPrompt。
  // 领域无关:只搬运 text 与显式 attachmentIds,不解析、不改写内容。随 doSend 引用稳定,避免每渲染重建。
  const conversation = React.useMemo<ConversationAccess>(
    () => ({ submitUserMessage: (text, opts) => doSend(text, opts) }),
    [doSend],
  );

  // 统一命令层(unified-command-result-layer):内置/host 命令经 ui-rpc command 通道执行,
  // 结果经 onCommandResult 事件驱动 UI(不进 LLM)。无 bus/无 onCommandResult 时回退旧 onBuiltinSelect。
  const dispatchBuiltin = React.useCallback(
    (cmd: RpcSlashCommand, rawValue: string): void => {
      const argv = rawValue.replace(/^\/\S+\s*/, ""); // 去掉前导 "/<name> "
      if (client !== undefined && sessionId !== undefined) {
        const sid = sessionId;
        const c = client;
        void executeHostCommand((req) => c.uiRpcCommand(sid, req), cmd.name, argv).then(
          (outcome) => {
            // chat 级 UI effect 由 PiChat 自身应用(它持有 chat.setMessages):
            // clear-transcript → 清空聊天视图(与 agent 上下文清空一致,/clear)。
            if (outcome.ok && outcome.result?.effect === "clear-transcript") {
              chatRef.current.setMessages?.([]);
            }
            // app 级 effect(面板/通知等)交宿主处理。
            onCommandResult?.(cmd.name, outcome);
          },
        );
        return;
      }
      onBuiltinSelect?.(cmd, rawValue);
    },
    [client, sessionId, onCommandResult, onBuiltinSelect],
  );

  // bang shell 命令(spec bang-shell-command):执行 bash 并把命令+结果注入聊天流。
  // 走同步 HTTP 响应体(client.bash)+ chatRef.setMessages 注入,**不经 useChat / 不进 LLM**
  // (回显机制见 design;setMessages 仅在回调内经 chatRef 访问,避开 render 期解构无限循环坑)。
  const runBash = React.useCallback(
    async (command: string, excludeFromContext: boolean): Promise<void> => {
      if (client === undefined || sessionId === undefined) return;
      const prefix = excludeFromContext ? "!!" : "!";
      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: `${prefix}${command}` }],
      };
      const append = (card: UIMessage): void => {
        chatRef.current.setMessages?.((prev) => [...prev, userMsg, card]);
      };
      try {
        const result = await client.bash(sessionId, {
          command,
          excludeFromContext,
        });
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "data-bash-result",
              data: { command, excludeFromContext, ...result },
            },
          ],
        });
      } catch {
        // 失败(端点禁用 404 / 网络 / 服务端错误)→ 注入可见错误卡片(Req 7.1/7.2)。
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "data-bash-result",
              data: {
                command,
                excludeFromContext,
                output: t("chat.bash.failed"),
                // 非零退出码使卡片标红呈现失败态(避免误显示 exit 0)。
                exitCode: 1,
                cancelled: false,
                truncated: false,
              },
            },
          ],
        });
      }
    },
    [client, sessionId, t],
  );

  const onSubmit = React.useCallback((opts?: { followUp?: boolean }): void => {
    // bang shell 命令(spec bang-shell-command):前端体验开启且以 `!` 开头 → 作为 bash 命令分流,
    // 不发给 LLM;`!!` → 输出不进上下文。去前缀去空白后为空则忽略(不请求/不写消息,Req 1.3);
    // 提交即清空输入框(Req 7.4)。置于斜杠命令分支之前,使 `!` 与 `/` 互不干扰(Req 1.5)。
    if (
      enableBash &&
      client !== undefined &&
      sessionId !== undefined &&
      input.trimStart().startsWith("!")
    ) {
      const trimmedBang = input.trimStart();
      const excludeFromContext = trimmedBang.startsWith("!!");
      const command = trimmedBang.slice(excludeFromContext ? 2 : 1).trim();
      setInput("");
      if (command.length === 0) return;
      void runBash(command, excludeFromContext);
      return;
    }

    // 内置命令拦截:键入完整命令(如 "/clear")回车时,按 source=builtin 分派,
    // **绝不发给 LLM**(builtin-plugin-command Req 2.3/7.x)。匹配首段命令名。
    if (builtinCommands !== undefined && input.startsWith("/")) {
      const name = input.slice(1).split(/\s+/)[0]?.toLowerCase();
      const cmd =
        name !== undefined && name.length > 0
          ? builtinCommands.find((c) => c.name.toLowerCase() === name)
          : undefined;
      if (cmd !== undefined) {
        dispatchBuiltin(cmd, input);
        setInput("");
        return;
      }
    }

    // agent 扩展命令拦截(source==="extension",如 /review、/plugin):**不走 useChat**(R15)。
    // registerCommand 命令是**动作**而非对话:在 agent 进程内本地执行后提前返回,从不发任何 message
    // 生命周期帧(实测命令轮仅有 extension_ui_request);若经 useChat.sendMessage 发送,既会渲染一条
    // 不该有的用户气泡、又会永久等不到 finish 帧而卡 busy。故经 client.prompt fire-and-forget 直接投递
    // (agent 照常执行命令):**无气泡、不进消息历史**,反馈完全靠 ctx.ui(notify/status/widget 经独立
    // 控制流到达),输入区即时复位、不进 LLM、不卡 pending。(skills/template 不是 registerCommand,
    // 不命中此分支 → 仍走 doSend 正常进历史、有气泡。)
    if (
      input.startsWith("/") &&
      client !== undefined &&
      sessionId !== undefined &&
      controls?.commands !== undefined
    ) {
      const name = input.slice(1).split(/\s+/)[0]?.toLowerCase();
      const extCmd =
        name !== undefined && name.length > 0
          ? controls.commands.find(
            (c) => c.name.toLowerCase() === name && c.source === "extension",
          )
          : undefined;
      if (extCmd !== undefined) {
        // 先点亮控制流(承载命令的 ctx.ui 反馈),再 fire-and-forget 投递命令。
        armExtControlStream();
        void client.prompt(sessionId, { message: input }).catch(() => undefined);
        // 装/卸插件命令(/plugin、/reload-runtime)→ 驱动 webext 重载(双路生效路②)。
        if (name === "plugin" || name === "reload-runtime") {
          onRuntimeReloadRequested?.();
        }
        setInput("");
        return;
      }
    }

    doSend(input, opts);
  }, [
    doSend,
    input,
    builtinCommands,
    dispatchBuiltin,
    client,
    sessionId,
    controls?.commands,
    armExtControlStream,
    onRuntimeReloadRequested,
    enableBash,
    runBash,
  ]);

  const onStop = React.useCallback((): void => {
    if (controls !== undefined) void controls.abort().catch(() => undefined);
    stop();
  }, [controls, stop]);

  // message-queue-ui「取回」:把已排队消息取回编辑器(Esc / Alt+↑)。经 clearQueue 端点清空 agent
  // 队列并拿回文本;空框回填、非空追加(先 steering 后 followUp,换行连接,Req 3.2/3.3/3.4)。
  // 端点失败 → 提示且不改编辑器现有内容(Req 3.6)。
  const onRequestRetrieve = React.useCallback((): void => {
    if (controls === undefined) return;
    void controls
      .clearQueue()
      .then((cleared) => {
        const restored = [...cleared.steering, ...cleared.followUp].join("\n");
        if (restored.length === 0) return;
        setInput((prev) => (prev.length === 0 ? restored : `${prev}\n${restored}`));
        setQueueNotice(undefined);
      })
      .catch(() => {
        setQueueNotice(t("chat.queue.retrieveFailed"));
      });
  }, [controls, t]);

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
  // 日志面板位置安全降级:"right"(aside 布局)当前有未根治的 React #185 渲染循环
  // (LogsPanel 内 radix Select 在 aside 中 ref 抖动 → Maximum update depth → 整页崩),
  // 暂降级为 "bottom" 防崩;待右侧布局重构后恢复。详见 spec 报告/记忆。
  const effectiveLogsPosition = logsPanelPosition;
  // 日志 right 位置 aside(level 过滤已改原生 select,不再 #185)。
  const showLogsRight =
    showLogs && logsPanelVisible && effectiveLogsPosition === "right";
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
        <React.Fragment key={key}>
          {/* promptToolbar 槽:内核控件之后、发送键之前(source 挂领域快捷设置,宿主不认语义)。 */}
          {key === "submit" ? (
            <ExtSlotRegion
              ext={extension}
              slot="promptToolbar"
              as="span"
              className="flex items-center gap-1"
              {...(webextState !== undefined ? { state: webextState } : {})}
            />
          ) : null}
          {controlNodes[key]}
        </React.Fragment>
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

  // 就绪握手:未就绪/错误时改写占位符,门控期禁用输入(Req 3.1/3.2/4.3)。
  const readinessPlaceholder = sessionReadinessError
    ? `${t("chat.readiness.connectFailed")}${lifecycle?.detail ? `:${lifecycle.detail}` : ""}`
    : readinessGating && !sessionReady
      ? t("chat.readiness.connecting")
      : undefined;
  // bash 模式视觉提示(spec bang-shell-command,Req 6.x):仅前端体验开启且以 `!` 开头时点亮;
  // `!!` → 不进上下文态。关闭或非 `!` 前缀 → undefined(常规外观)。
  const bashMode: "bash" | "bash-no-context" | undefined =
    enableBash && input.trimStart().startsWith("!")
      ? input.trimStart().startsWith("!!")
        ? "bash-no-context"
        : "bash"
      : undefined;
  const promptInput = (
    <PromptInput
      value={input}
      onChange={setInput}
      onSubmit={onSubmit}
      mode={bashMode}
      disabled={transport === undefined || (readinessGating && !sessionReady)}
      toolbar={toolbar}
      rows={3}
      placeholder={readinessPlaceholder ?? placeholder ?? t("chat.placeholder")}
      className="rounded-3xl border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-4 py-3 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/65"
      textareaClassName="px-2 text-base"
      suppressEnterSubmit={commandCapturing}
      ghostSuffix={ghostSuffix}
      onAcceptGhost={() => setInput(input + ghostSuffix)}
      inputRef={inputRef}
      onSelectionChange={setCursor}
      canRetrieve={canRetrieve}
      {...(controls !== undefined ? { onRequestRetrieve } : {})}
    />
  );

  // 就绪状态指示(spec session-readiness-handshake):门控开启时,就绪前显示"连接中",error 显示失败。
  const readinessIndicator =
    readinessGating && !sessionReady ? (
      <div
        className={`mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sessionReadinessError
            ? "border-[hsl(var(--destructive))]/20 bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]"
            : "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))]"
          }`}
        data-pi-session-readiness={
          sessionReadinessError ? "error" : "connecting"
        }
        role="status"
      >
        <span
          className={
            sessionReadinessError
              ? ""
              : "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
          }
          aria-hidden="true"
        />
        <span>
          {sessionReadinessError
            ? `${t("chat.readiness.connectFailed")}${lifecycle?.detail ? `:${lifecycle.detail}` : t("chat.readiness.retryLater")}`
            : t("chat.readiness.connectingAgent")}
        </span>
      </div>
    ) : null;

  const inputWithWidgets = (
    <div className="relative" data-pi-input-wrapper>
      {readinessIndicator}
      {/* `/` 命令面板:与 `@` 补全一致,经 caret 锚定 fixed 定位(不再全宽贴顶)。 */}
      {controls !== undefined ? (
        <PiCommandPalette
          controls={controls}
          value={input}
          onChange={setInput}
          inputRef={inputRef}
          onCaptureChange={setCommandCapturing}
          extensionCommands={extensionCommands}
          {...(commandArgProvider !== undefined ? { commandArgProvider } : {})}
          {...(builtinCommands !== undefined ? { builtinCommands } : {})}
          {...(builtinCommands !== undefined
            ? { onBuiltinSelect: dispatchBuiltin }
            : {})}
          {...(extension?.contributions?.slash !== undefined
            ? { slashContribution: extension.contributions.slash }
            : {})}
          {...(uiRpc !== undefined ? { uiRpc } : {})}
          // agent-slash-completion:伪命令候选(/img-gen 等)经 completion 端点并入此单浮层。
          {...(client !== undefined ? { client } : {})}
          {...(sessionId !== undefined ? { sessionId } : {})}
        />
      ) : null}
      {/* core 触发符补全(平台级,知道 sessionId);接管 @ 等服务端 provider 触发符。
          浮层内部按 caret 像素坐标 fixed 锚定,故此挂载点不再约束尺寸/位置。 */}
      {client !== undefined && sessionId !== undefined ? (
        <PiCompletionPopover
          value={input}
          cursor={cursor}
          onChange={setInput}
          client={client}
          sessionId={sessionId}
          inputRef={inputRef}
          onCaptureChange={setCommandCapturing}
          // agent-slash-completion:"/" 归 PiCommandPalette 单浮层,避免双浮层冲突。
          excludeTriggers={SLASH_EXCLUDED_TRIGGERS}
          onAccept={onCompletionAccept}
        />
      ) : null}
      {/* webext 专属 mention:core 启用时让位(避免与 core 的 @ 双浮层,D-6)。
          与 @/`/` 一致,经 caret 锚定 fixed 定位(不再全宽贴顶)。 */}
      {extension?.contributions?.mention !== undefined &&
        uiRpc !== undefined &&
        !(client !== undefined && sessionId !== undefined) ? (
        <PiMentionPopover
          value={input}
          onChange={setInput}
          contribution={extension.contributions.mention}
          uiRpc={uiRpc}
          inputRef={inputRef}
          onCaptureChange={setCommandCapturing}
        />
      ) : null}
      {/* webext 通用 autocomplete:与 @/`/` 一致,经 caret 锚定 fixed 定位。 */}
      {extension?.contributions?.autocomplete !== undefined &&
        uiRpc !== undefined ? (
        <PiAutocompletePopover
          value={input}
          onChange={setInput}
          contribution={extension.contributions.autocomplete}
          uiRpc={uiRpc}
          cursor={cursor}
          inputRef={inputRef}
        />
      ) : null}
      {/* message-queue-ui:排队消息面板(control:queue 快照)+ 瞬态提示,置于编辑器上方。 */}
      <PiQueuePanel queue={queue} />
      {queueNotice !== undefined ? (
        <div
          data-pi-queue-notice
          role="status"
          className="mb-1 rounded-lg bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
        >
          {queueNotice}
        </div>
      ) : null}
      {/* Tier1 保留插槽:编辑器上方配件(追加,不替换 Widgets)。 */}
      <ExtSlotRegion ext={extension} slot="accessoryAboveEditor" />
      <Widgets widgets={widgetItems} placement="aboveEditor" />
      {/* attachment-mention-preview:被 `@` 引用附件的缩略图预览条(输入框上方)。 */}
      <PiMentionPreviews
        value={input}
        previews={mentionPreviews}
        onRemove={onRemoveMention}
      />
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
        <SlotHost ext={extension} slot="background" state={webextState} />
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
        className="pointer-events-none absolute inset-x-0 bottom-0 p-4"
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
          {showLogs && logsPanelVisible && effectiveLogsPosition === "bottom" ? (
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
          {showLogs && logsPanelVisible && effectiveLogsPosition === "drawer" ? (
            <>
              <button
                type="button"
                data-pi-logs-drawer-toggle
                aria-label={drawerOpen ? t("chat.logs.drawerCollapse") : t("chat.logs.drawerExpand")}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((v) => !v)}
                className="mt-1.5 text-xs px-2.5 py-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur-md text-[hsl(var(--foreground))] opacity-70 hover:opacity-100 transition-opacity"
              >
                {t("chat.logs.drawerToggle")}
              </button>
              {drawerOpen ? (
                <div
                  data-pi-logs-region
                  className="fixed inset-x-0 bottom-0 z-50 max-h-[40vh] flex flex-col bg-[hsl(var(--background))] border-t border-[hsl(var(--border))] shadow-lg overflow-hidden"
                >
                  <LogsPanel logsResult={logsResult} className="flex-1 min-h-0" fill />
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
            <SlotHost ext={extension} slot="headerLeft" state={webextState} />
            <div className="flex-1">
              <SlotHost ext={extension} slot="headerCenter" state={webextState} />
            </div>
            <SlotHost ext={extension} slot="headerRight" state={webextState} />
          </header>
        ) : null}

        {extensionHeader}

        {/* Tier1 保留插槽:扩展状态栏(与 ambient StatusBar 共存)+ 工具条。 */}
        <ExtSlotRegion ext={extension} slot="statusBar" />
        <ExtSlotRegion ext={extension} slot="toolbar" />

        {/* top 位置：对话/空态之上的横向日志条,利用无 head 后的顶部空间;与内容同宽居中,
            bounded 高度内滚动(不吃右侧列宽)。 */}
        {showLogs && logsPanelVisible && effectiveLogsPosition === "top" ? (
          <div
            data-pi-logs-region
            data-pi-logs-top=""
            className={cn(
              "flex max-h-56 min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]/70 px-0 pt-2 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/60",
              lay.content,
            )}
          >
            <LogsPanel logsResult={logsResult} className="min-h-0 flex-1" fill />
            {/* Tier1 保留插槽:扩展 logs 贡献（与内核 LogsPanel 并存，追加语义）。 */}
            <ExtSlotRegion ext={extension} slot="logs" />
          </div>
        ) : null}

        {isEmpty ? (
          <div
            className="pi-scrollbar-ghost flex flex-1 flex-col items-center justify-start overflow-y-auto px-4 pb-8 pt-[10vh]"
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
            <SlotHost ext={extension} slot="footer" state={webextState} />
          </footer>
        ) : null}
      </div>

      {showAside ? (
        // Tier1 panelRight + Tier4 artifact(独立 origin sandbox iframe)。
        // panelRatioActive 时宽度由比例百分比驱动(对话列 flex-1 吃余量);否则沿用固定 w-96。
        <aside
          className={cn(
            // flex-col + min-h-0:为 right 位置日志面板提供有界高度上下文(见下方 logs 区);
            // 仅含 panelRight/artifact 时,子项无 flex-1 仍按内容堆叠(等价原 block 视觉)。
            "hidden min-h-0 shrink-0 lg:flex lg:flex-col",
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
            <SlotHost
              ext={extension}
              slot="panelRight"
              state={webextState}
              surface={surfaceAccess}
              upload={uploadAttachment ?? defaultUploadAttachment}
              baseUrl={client?.baseUrl ?? ""}
              syncSignal={panelSyncSignal}
              {...(sessionId !== undefined ? { sessionId } : {})}
              // 宿主转发:当前轮流式 AIGC 图像预览(由糊变清)——图已随对话流到浏览器,slot 直接复用。
              {...(livePreviewImage !== undefined ? { livePreviewImage } : {})}
              // 会话能力对象(契约 §4.2 能力对象注入):slot 组件经 conversation.submitUserMessage
              // 把操作组装成用户消息发进对话流,由 LLM 调工具执行 —— 操作天然回流对话历史。
              conversation={conversation}
              // 过渡别名(@deprecated):onSubmitPrompt 与 conversation.submitUserMessage 等价,
              // 保留一个大版本供既有 slot 消费者零破坏(Req 6.2/6.4)。
              onSubmitPrompt={(text: string) => doSend(text)}
              // 领域中立注入:把当前已装载的扩展描述符以数组形态搬运给 slot 组件,slot 自行按需
              // 提取消费(宿主不解析)。当前宿主只持有单个 extension,故注入单元素数组;多扩展装载
              // 就绪时此处天然扩展为完整数组,注入面无需再改。
              extensions={extension !== undefined ? [extension] : []}
            />
          ) : null}
          {/* right 位置：日志面板作为 aside 内独立区块（与 panelRight/artifact 共存）。
              flex-1 + min-h-0 给有界高度,使 LogsPanel 内部 overflow 滚动在固定高度内进行。 */}
          {showLogsRight ? (
            <div
              data-pi-logs-region
              className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"
            >
              <LogsPanel logsResult={logsResult} className="flex-1 min-h-0" fill />
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
              {r === "centered" ? t("layout.ratio.centered") : PANEL_RATIO_LABEL[r]}
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

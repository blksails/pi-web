"use client";
/**
 * PiChat — 富聊天装配组件。四维定制(主题/slots/components/layout+icons)在装配点解析:
 * slots(整块) > components(细粒度) > 默认。缺省时与定制引入前行为一致。
 */
import * as React from "react";
import {
  PaneLoadingSkeleton,
  PanesHost,
  type PaneHostEvent,
} from "@blksails/pi-web-panes-kit/react";
import {
  definePanes,
  type PanesDefinition,
} from "@blksails/pi-web-panes-kit";
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
} from "@blksails/pi-web-react";
import { PartRenderer } from "./part-renderer.js";
import { registerBuiltinDataPartRenderers } from "./builtin-data-part-renderers.js";
import { BashResultRenderer } from "./bash-result-renderer.js";
import { InstallResultRenderer } from "./install-result-renderer.js";
import { PublishPreviewRenderer } from "./publish-preview-renderer.js";
import type { PiChatSlots } from "./slots.js";
import { PiQueuePanel } from "./pi-queue-panel.js";
import {
  ChatError,
  Conversation,
  ConversationImageGallery,
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
import { createLogger } from "@blksails/pi-web-logger";
import { useHostEnvironmentSignals } from "./host-signals.js";
import {
  mergePaneSources,
  type PaneMergeRejection,
  type PaneSource,
} from "@blksails/pi-web-panes-kit";
import { TurnAbortProvider } from "./turn-abort-context.js";
import {
  PromptTemplateCards,
  SkillPill,
  type ChatResourceConfig,
} from "./resource-controls.js";

/** pane 装载与合并的诊断出口(浏览器 sink → 总线 → 日志面板)。 */
const log = createLogger({ namespace: "ui:panes" });

type TauriTitleWindow = Window & {
  readonly __TAURI__?: {
    readonly window?: {
      readonly getCurrentWindow?: () => {
        readonly setTitle?: (title: string) => Promise<void>;
      };
    };
  };
};

function applyHostTitle(title: string): void {
  document.title = title;
  try {
    const hostWindow = (window as TauriTitleWindow).__TAURI__?.window?.getCurrentWindow?.();
    void hostWindow?.setTitle?.(title).catch(() => undefined);
  } catch {
    // 普通网页或旧版 Tauri 无窗口 API 时，document.title 已完成降级。
  }
}
import { runStopTurn, type StopTurnHandle } from "./stop-turn.js";
import { PiCommandPalette } from "../controls/pi-command-palette.js";
import { createPackageArgProvider } from "../controls/package-arg-provider.js";
import type { ExtensionCommandPolicy } from "../controls/pi-command-palette.js";
import type { RpcSlashCommand, CompletionItem } from "@blksails/pi-web-protocol";
import { PiMentionPopover } from "../controls/pi-mention-popover.js";
import { PiAutocompletePopover } from "../controls/pi-autocomplete-popover.js";
import { PiSessionStats } from "../controls/pi-session-stats.js";
import { createLogsPaneDocument, LOGS_PANE_ID } from "../logs/logs-pane-document.js";
import {
  PiCompletionPopover,
  PiMentionPreviews,
  scanAttachmentMentions,
  removeAttachmentMention,
  useCatalogMaterialize,
  type MentionPreview,
} from "../completion/index.js";
import { cn } from "../lib/cn.js";
import type {
  WebExtension,
  ConversationAccess,
  ConversationImageAsset,
} from "@blksails/pi-web-kit";
import { createWebExtStateAccess, createWebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { SurfaceCommandResultSchema, PUBLISH_PREVIEW_DATA_PART } from "@blksails/pi-web-protocol";
import {
  SlotHost,
  applyExtensionRenderers,
} from "../web-ext/apply-extension.js";
import { ExtSlotRegion } from "../web-ext/extension-slots.js";
import { ArtifactSurface } from "../web-ext/artifact-surface.js";

type IdleFrameTask = {
  readonly id: number;
  readonly kind: "idle" | "frame";
};

type IdleFrameWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { readonly timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function scheduleIdleFrame(callback: () => void): IdleFrameTask {
  const idleWindow = window as IdleFrameWindow;
  if (idleWindow.requestIdleCallback !== undefined) {
    return {
      id: idleWindow.requestIdleCallback(callback, { timeout: 120 }),
      kind: "idle",
    };
  }
  return { id: requestAnimationFrame(callback), kind: "frame" };
}

function cancelIdleFrame(task: IdleFrameTask): void {
  const idleWindow = window as IdleFrameWindow;
  if (task.kind === "idle") idleWindow.cancelIdleCallback?.(task.id);
  else cancelAnimationFrame(task.id);
}

export type ToolbarControl =
  | "attachments"
  | "model"
  | "speech"
  | "webSearch"
  | "skills"
  | "submit";

type UiFilePart = UIMessage["parts"][number] & {
  readonly type: "file";
  readonly url?: unknown;
  readonly mediaType?: unknown;
  readonly filename?: unknown;
  readonly attachmentId?: unknown;
};

function attachmentIdFromImageUrl(url: string): string | undefined {
  const match = /\/attachments\/([^/?#]+)\/raw(?:[?#]|$)/.exec(url);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function isImageFilePart(part: UIMessage["parts"][number]): part is UiFilePart {
  if (part.type !== "file") return false;
  const file = part as UiFilePart;
  return (
    typeof file.url === "string" &&
    file.url !== "" &&
    typeof file.mediaType === "string" &&
    file.mediaType.startsWith("image/")
  );
}

function conversationImagesOf(message: UIMessage): ConversationImageAsset[] {
  if (message.role !== "assistant") return [];
  return message.parts.flatMap((part, index) => {
    if (!isImageFilePart(part)) return [];
    const attachmentId =
      typeof part.attachmentId === "string" && part.attachmentId !== ""
        ? part.attachmentId
        : attachmentIdFromImageUrl(part.url as string);
    return [{
      id: `${message.id}:image:${index}`,
      url: part.url as string,
      mediaType: part.mediaType as string,
      ...(typeof part.filename === "string" && part.filename !== ""
        ? { filename: part.filename }
        : {}),
      ...(attachmentId !== undefined ? { attachmentId } : {}),
    }];
  });
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
   * 宿主内置 pane 来源(spec host-builtin-panes,Req 1.1)。
   *
   * 提供它即让右侧面板对**任何** agent 可用 —— 面板的启用判据不再是「agent 是否声明了
   * panelRight 槽」。本组件对 pane 内容**零认知**:只把它与 agent 的声明合并后交给 PanesHost,
   * 不知道里面是文件浏览器还是会话信息。领域内容留在 app 层(SES-H1 宿主中立线的同类纪律)。
   *
   * 不传、或其 panes 为空 → 行为与本特性实施前逐字一致(Req 1.7)。
   */
  readonly hostPaneSource?: PaneSource;
  /**
   * 宿主 realm 的具名信号,透传给 PanesHost(承载会话信息等)。
   * 语义是最后值即真值;pane 晚连、重连、刷新重建都不丢。
   */
  readonly paneSignals?: Readonly<Record<string, unknown>>;
  /** 合并期的拒绝记录回调(诊断出口);不传则内部按 warn 级输出。 */
  readonly onPaneMergeRejections?: (rejections: readonly PaneMergeRejection[]) => void;
  /**
   * panelRight 让位的「初始」比例(对话区 : 右侧面板);扩展声明 panelRight 或宿主提供内置
   * pane 时生效。宿主据此渲染段控切换器,运行时可在 居中/2:1/3:7 间动态切换;缺省 `2:1`。
   */
  readonly panelRatio?: PanelRatio;
  /**
   * panelRight 连续宽度(全受控):传入即启用连续拖拽模式(替离散 panelRatio 档),
   * number 视 px、string 原样入 style.width。仅在扩展声明 panelRight 时生效。
   * 详见 spec 2026-07-16-panelright-resizable-width。
   */
  readonly panelWidth?: number | string;
  /** 拖拽结束回传目标宽度(px);拖动中 PiChat 以 rAF 预览外壳，panel 内容不重排。 */
  readonly onPanelWidthChange?: (widthPx: number) => void;
  /** 宿主控制的 Pane 侧栏收起动作；入口渲染于 Pane 标签栏最左。 */
  readonly onPanelClose?: () => void;
  /** 宿主控制的 Pane 侧栏展开动作；对话图片等外部动作触发 Pane 前调用。 */
  readonly onPanelOpen?: () => void;
  /** 受权 Pane 事件交宿主处理。 */
  readonly onPaneEvent?: (topic: string, payload: unknown) => boolean | void | Promise<boolean | void>;
  /** 连续模式拖拽下界(px),缺省 240。 */
  readonly minPanelWidth?: number;
  /** 连续模式拖拽上界(px);最终仍受容器宽度 70% 的宿主保护线约束。 */
  readonly maxPanelWidth?: number;
  /** 连续模式拖拽上界占聊天容器比例；缺省 70%。 */
  readonly maxPanelWidthRatio?: number;
  /** 主题模式;提供时内部包裹 ThemeProvider(Req 2)。 */
  readonly theme?: ThemeMode;
  /** 工具条控件顺序(Req 6.2);缺省用默认顺序。 */
  readonly toolbarOrder?: ReadonlyArray<ToolbarControl>;
  /** 原生 Skill / Prompt Template 交互；提供后启用工具栏技能 pill 与模板快捷卡片。 */
  readonly resources?: ChatResourceConfig;
  /** 扩展命令补全可见策略(全局开关 + 白名单);默认隐藏所有扩展命令。 */
  readonly extensionCommands?: ExtensionCommandPolicy;
  /** harness 内置命令(source==="builtin");前置合流到命令面板(builtin-plugin-command)。 */
  readonly builtinCommands?: readonly RpcSlashCommand[];
  /**
   * 内置命令名 → 结果卡片 data part 类型(如 `{install:"data-install-result"}`),对应
   * `BuiltinCommandSpec.resultDataPart`(`RpcSlashCommand` 是 pi 原生派生形状,不携带此
   * UI 专属字段,故经此单独映射传入)。声明了该命令名的结果(`data`/`message`)才会作为消息
   * 追加进聊天流(bang 命令同型);未声明 ⇒ 只驱动 effect,不进消息流(如 `/clear`)。
   */
  readonly builtinResultDataParts?: Readonly<Record<string, string>>;
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
  /**
   * 会话**活跃态变化**回调(spec session-meta-index, Req 8.1-8.3)。
   *
   * 与 `onTurnEnd` 的区别、以及为何非它不可:`onTurnEnd` 只在忙→闲的**下降**边沿触发,
   * 于是「会话刚开始干活」这一刻列表**没有**任何刷新触发点 —— 转圈往往等到它已经不忙了
   * 才出现,体验上会被当成 bug。本回调在以下三种边沿都触发,供宿主重拉会话列表:
   *   ① 忙态上升(轮次开始) ② 忙态下降(轮次结束) ③ 交互挂起数 0↔非0(开始/结束等用户回应)
   *
   * `onTurnEnd` 的触发条件**刻意不动**(另有消费者依赖其「轮末」语义,如画廊物化视图重建)。
   */
  readonly onActivityChange?: () => void;
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
   * 服务端权威日志门控是否开启;透传给 {@link LogsPanel},使「已关闭」与「暂无日志」
   * 在 UI 上可区分(两者此前都只是一片空白)。undefined = 加载中。
   */
  readonly loggingEnabled?: boolean;
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
  "skills",
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
  hostPaneSource,
  paneSignals,
  onPaneMergeRejections,
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
  panelWidth,
  onPanelWidthChange,
  onPanelClose,
  onPanelOpen,
  onPaneEvent,
  minPanelWidth,
  maxPanelWidth,
  maxPanelWidthRatio = 0.7,
  theme,
  toolbarOrder,
  resources,
  extensionCommands,
  builtinCommands,
  builtinResultDataParts,
  onBuiltinSelect,
  onCommandResult,
  onRuntimeReloadRequested,
  onTurnEnd,
  onActivityChange,
  showSessionStats = true,
  showLogs = false,
  enableBash = false,
  logsPanelVisible = true,
  attachmentBaseUrl,
  uploadAttachment,
  className,
}: PiChatProps): React.JSX.Element {
  const t = useI18n();
  const [paneHostEvent, setPaneHostEvent] = React.useState<PaneHostEvent>();
  const paneHostEventSequence = React.useRef(0);
  const publishPaneEvent = React.useCallback((topic: string, payload?: unknown): void => {
    onPanelOpen?.();
    paneHostEventSequence.current += 1;
    setPaneHostEvent({
      id: paneHostEventSequence.current,
      topic,
      ...(payload !== undefined ? { payload } : {}),
    });
  }, [onPanelOpen]);
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
  const startSession = session.start;
  const pendingConversationSubmissions = React.useRef<Array<{
    readonly text: string;
    readonly options?: Parameters<ConversationAccess["submitUserMessage"]>[1];
  }>>([]);

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


  // 日志仅以声明式 Guest Pane 存在：不再把宿主 React 节点注入 Pane。
  // 明确的空 initialPaneIds 保证进入 Agent 时不自动打开日志，避免首帧闪烁。
  // ★ webext 的 `panes` 有两种实际形态，两者都必须支持：
  //    - 两层：`{ definition: PanesDefinition, config }` —— agent 需要同时给出 definition 与
  //      运行期 panesConfig 时的写法（aigc-agent 的 web.config.tsx 即如此），
  //      `packages/panes-kit/src/merge.ts` 读的正是 `source.definition.panes`；
  //    - 扁平：`PanesDefinition` 本身（`definePanes()` 的直接返回值）。
  //  只读扁平的 `.panes.panes` 时，遇两层形态该值为 undefined —— 补一个可选链只是把白屏
  //  换成**判定静默失效**（logsPaneHosted 恒 false，声明了日志 pane 的 agent 拿不到数据链路）。
  //  故统一为「先取 definition，取不到再当扁平用」，并对数组做防御。
  // 名字避开下方 `panesDefinition`(宿主合成后的最终定义) —— 此处是**扩展原始声明**的归一结果。
  const extensionPanesSource =
    (extension?.panes as { readonly definition?: { readonly panes?: unknown } } | undefined)?.definition ??
    (extension?.panes as { readonly panes?: unknown } | undefined);
  const declaredPanes = (extensionPanesSource as { readonly panes?: unknown } | undefined)?.panes;
  const logsPaneHosted = Array.isArray(declaredPanes)
    ? declaredPanes.some(
        (pane) => typeof pane === "object" && pane !== null &&
          (pane as { readonly id?: unknown }).id === LOGS_PANE_ID,
      )
    : false;
  const logsPaneEnabled = showLogs && logsPanelVisible;
  const logsStore = React.useMemo(
    () => (logsPaneHosted || logsPaneEnabled ? createLogsStore() : undefined),
    [logsPaneEnabled, logsPaneHosted, sessionId],
  );
  React.useEffect(() => {
    if (logsStore === undefined || connection === undefined) return;
    return connection.controlStore.onLogsFrame((entries) => logsStore.applyLogsFrame(entries));
  }, [connection, logsStore]);
  // Guest 只得授权路由返回值；宿主在此把 REST 历史与 SSE / browser bus 汇入的条目合并。
  const sessionLogs = React.useCallback(async (query: Readonly<Record<string, string>>): Promise<unknown> => {
    if (client === undefined || sessionId === undefined) {
      return logsStore?.getSnapshot().entries ?? [];
    }
    const history = await client.getLogs(sessionId, {
      ...(query.level === "debug" || query.level === "info" || query.level === "warn" || query.level === "error"
        ? { level: query.level }
        : {}),
      ...(query.limit !== undefined && Number.isFinite(Number(query.limit))
        ? { limit: Number(query.limit) }
        : {}),
      ...(query.since !== undefined && Number.isFinite(Number(query.since))
        ? { since: Number(query.since) }
        : {}),
    });
    if (logsStore === undefined) return history;
    logsStore.mergeHistory(history);
    return logsStore.getSnapshot().entries;
  }, [client, logsStore, sessionId]);

  React.useEffect(() => {
    registry.registerDataPartRenderer("data-source", SourcesDataPartRenderer);
    registry.registerDataPartRenderer("data-sources", SourcesDataPartRenderer);
    // pi-web 自定义 data-part(data-pi-ui)经单一真相源 PART_KINDS 遍历注册
    //(session-snapshot-authority STEP4):不可能漏注册,孤儿渲染器由契约测试静态排除(Req 6.4/6.5)。
    registerBuiltinDataPartRenderers(registry);
    // bang shell 命令结果卡片(spec bang-shell-command,Req 4.x)。
    registry.registerDataPartRenderer("data-bash-result", BashResultRenderer);
    // /agent 与 /plugin host 命令结果卡片(spec agent-plugin-commands;part 名沿用
    // data-install-result —— 结果数据形状未变,卡片自带 action/kind 可自证归属)。
    registry.registerDataPartRenderer("data-install-result", InstallResultRenderer);
    // publish 预览卡片(spec publish-host-command):形状与安装类不同,故独立渲染器。
    // handler 经 `CommandResult.dataPart` 指定它,不走按命令名查表。
    registry.registerDataPartRenderer(PUBLISH_PREVIEW_DATA_PART, PublishPreviewRenderer);
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
        ...(sessionId !== undefined ? { id: sessionId } : {}),
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
  // agent-attachment-catalog:换写状态机的 getValue 读最新 input(避免 onAccept 闭包捕获旧值,
  // 物化是异步的,完成时用户可能已继续输入)。
  const inputValueRef = React.useRef(input);
  inputValueRef.current = input;

  // attachment-mention-preview:选中 `@` 附件候选时捕获其预览(id → name/previewUrl),
  // 供输入区 PiMentionPreviews 渲染缩略图。候选自带 previewUrl(见 pi-client getCompletion)。
  const [mentionPreviews, setMentionPreviews] = React.useState<
    ReadonlyMap<string, MentionPreview>
  >(new Map());

  // agent-attachment-catalog:accept 异步换写状态机的失败反馈(撤 token 后的瞬态提示,
  // queueNotice 同 UX 模式,自动消隐)。
  const [catalogNotice, setCatalogNotice] = React.useState<string | undefined>(
    undefined,
  );
  React.useEffect(() => {
    if (catalogNotice === undefined) return;
    const timer = setTimeout(() => setCatalogNotice(undefined), 4000);
    return () => clearTimeout(timer);
  }, [catalogNotice]);
  const catalogMaterialize = useCatalogMaterialize({
    ...(client !== undefined ? { client } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    getValue: () => inputValueRef.current,
    onChange: setInput,
    onMaterialized: (attachmentId, attachment, displayUrl) => {
      setMentionPreviews((prev) => {
        const next = new Map(prev);
        next.set(attachmentId, { name: attachment.name, previewUrl: displayUrl });
        return next;
      });
    },
    onError: () => setCatalogNotice(t("chat.catalog.materializeFailed")),
  });

  // agent-attachment-catalog:`control:"attachment"` 事件(agent 主动 publish)→ 递增刷新信号,
  // 传给 PiCompletionPopover 强制重查当前 token(浮层开启时立即感知新条目,Req 4.2/4.3)。
  // 非粘性:仅当次订阅期间收到的事件才计数,不回放历史(打开会话时本就全量枚举)。
  const [attachmentRefreshSignal, setAttachmentRefreshSignal] =
    React.useState<number>(0);
  React.useEffect(() => {
    if (connection === undefined) return;
    return connection.controlStore.onAttachmentEvent(() => {
      setAttachmentRefreshSignal((v) => v + 1);
    });
  }, [connection]);

  const onCompletionAccept = React.useCallback(
    (item: CompletionItem): void => {
      if (item.kind === "catalog") {
        catalogMaterialize.materialize(item);
        return;
      }
      if (item.kind !== "attachment") return;
      setMentionPreviews((prev) => {
        const next = new Map(prev);
        next.set(item.id, {
          name: item.label,
          ...(item.previewUrl !== undefined ? { previewUrl: item.previewUrl } : {}),
        });
        return next;
      });
    },
    [catalogMaterialize],
  );
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

  // panelRight 连续宽度:Pane 外壳按 rAF 跟手；对话列冻结，空闲帧才一次提交重排。
  const panelResizeTreeRef = React.useRef<HTMLDivElement | null>(null);
  const panelConversationColumnRef = React.useRef<HTMLDivElement | null>(null);
  const panelAsideRef = React.useRef<HTMLElement | null>(null);
  const panelDraggingRef = React.useRef(false);
  const panelResizeFrameRef = React.useRef<number | undefined>(undefined);
  const panelResizeIdleRef = React.useRef<IdleFrameTask | undefined>(undefined);
  const panelPendingWidthRef = React.useRef<number | undefined>(undefined);
  const panelResizeStartXRef = React.useRef<number | undefined>(undefined);
  const panelResizeStartWidthRef = React.useRef<number | undefined>(undefined);
  const panelResizeMovedRef = React.useRef(false);
  const [panelDragging, setPanelDragging] = React.useState(false);
  const [panelConversationWidth, setPanelConversationWidth] = React.useState<number>();
  React.useEffect(
    () => () => {
      if (panelResizeFrameRef.current !== undefined) {
        cancelAnimationFrame(panelResizeFrameRef.current);
      }
      if (panelResizeIdleRef.current !== undefined) {
        cancelIdleFrame(panelResizeIdleRef.current);
      }
    },
    [],
  );
  // 拖拽中只预览侧栏宽；对话列按下时冻结，松手后一次提交。
  // content-well 几何由 ResizeObserver 单路 rAF 合并上报（见 publishTauriContentWellMetrics），
  // 此处不再额外 dispatch sync，避免「拖拽 rAF + RO + sync」三层插帧。
  const applyAsideWidthPreview = React.useCallback((asideWidthPx: number): void => {
    const aside = panelAsideRef.current;
    if (aside === null) return;
    aside.style.width = `${asideWidthPx}px`;
  }, []);
  const onPanelResizeMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!panelDraggingRef.current) return;
      if (Math.abs(e.clientX - (panelResizeStartXRef.current ?? e.clientX)) < 2) return;
      const firstMove = !panelResizeMovedRef.current;
      panelResizeMovedRef.current = true;
      // 仅真正位移后冻结布局；单击分隔线不触发侧栏脱离 flex。
      if (firstMove) {
        setPanelConversationWidth(
          panelConversationColumnRef.current?.getBoundingClientRect().width,
        );
        setPanelDragging(true);
      }
      const rect = panelResizeTreeRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const availableMax = rect.width * maxPanelWidthRatio;
      const min = Math.min(minPanelWidth ?? 240, availableMax);
      const max = Math.max(
        min,
        Math.min(maxPanelWidth ?? Number.POSITIVE_INFINITY, availableMax),
      );
      const raw = rect.right - e.clientX;
      // 1px 迟滞，边界处不因亚像素/重排来回夹紧而颤动。
      const next = Math.max(min, Math.min(max, raw));
      const prev = panelPendingWidthRef.current;
      if (prev !== undefined && Math.abs(prev - next) < 1) return;
      panelPendingWidthRef.current = next;
      // 同帧合并：只保留最后一次 pointer 样点，一帧写一次 aside 宽。
      if (panelResizeFrameRef.current !== undefined) return;
      panelResizeFrameRef.current = requestAnimationFrame(() => {
        panelResizeFrameRef.current = undefined;
        const width = panelPendingWidthRef.current;
        if (width !== undefined) applyAsideWidthPreview(width);
      });
    },
    [applyAsideWidthPreview, minPanelWidth, maxPanelWidth, maxPanelWidthRatio],
  );
  const onPanelResizeDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (panelResizeIdleRef.current !== undefined) {
        cancelIdleFrame(panelResizeIdleRef.current);
        panelResizeIdleRef.current = undefined;
      }
      panelDraggingRef.current = true;
      panelResizeStartXRef.current = e.clientX;
      panelResizeMovedRef.current = false;
      const measuredWidth = panelAsideRef.current?.getBoundingClientRect().width;
      const currentWidth =
        measuredWidth !== undefined && measuredWidth > 0
          ? measuredWidth
          : typeof panelWidth === "number"
            ? panelWidth
            : undefined;
      panelPendingWidthRef.current = currentWidth;
      panelResizeStartWidthRef.current = currentWidth;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom / 无 pointer capture 环境:降级为不捕获(功能不依赖)。
      }
    },
    [panelWidth],
  );
  const onPanelResizeUp = React.useCallback(
    (e: React.PointerEvent) => {
      panelDraggingRef.current = false;
      if (panelResizeFrameRef.current !== undefined) {
        cancelAnimationFrame(panelResizeFrameRef.current);
        panelResizeFrameRef.current = undefined;
      }
      const width = panelPendingWidthRef.current;
      panelPendingWidthRef.current = undefined;
      const startWidth = panelResizeStartWidthRef.current;
      panelResizeStartWidthRef.current = undefined;
      panelResizeStartXRef.current = undefined;
      const moved = panelResizeMovedRef.current;
      panelResizeMovedRef.current = false;
      const shouldCommit =
        moved &&
        width !== undefined &&
        (startWidth === undefined || Math.abs(width - startWidth) >= 1);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // 同上。
      }
      if (!shouldCommit) {
        setPanelDragging(false);
        setPanelConversationWidth(undefined);
        return;
      }
      if (width !== undefined) applyAsideWidthPreview(width);
      // 松手后 idle 帧才提交受控宽并解冻对话列，避免拖中 chat 重排。
      panelResizeIdleRef.current = scheduleIdleFrame(() => {
        panelResizeIdleRef.current = undefined;
        if (width !== undefined) onPanelWidthChange?.(width);
        setPanelDragging(false);
        setPanelConversationWidth(undefined);
        window.dispatchEvent(new Event("pi-panes-content-well-sync"));
      });
    },
    [applyAsideWidthPreview, onPanelWidthChange],
  );

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

  // /agent 与 /plugin 的子命令/参数补全 provider(spec agent-plugin-commands,任务 3.4):
  // 有 client+sessionId 时构造,经现成 GET /extensions、/agent-sources、install-sources 端点
  // 按域分道取候选。面板只接受**单个** provider,故由它同时认两条命令。
  const commandArgProvider = React.useMemo(() => {
    if (client === undefined || sessionId === undefined) return undefined;
    return createPackageArgProvider({ baseUrl: client.baseUrl, sessionId });
  }, [client, sessionId]);


  const notifications = extensionUI?.notifications ?? EMPTY_NOTIFICATIONS;
  const statuses = extensionUI?.statuses ?? EMPTY_STATUSES;
  const ambientTitle = extensionUI?.title ?? controls?.session?.title;
  const dismissNotification = extensionUI?.dismissNotification;

  React.useEffect(() => {
    if (ambientTitle === undefined || ambientTitle.length === 0) return;
    const previous = document.title;
    applyHostTitle(ambientTitle);
    return () => applyHostTitle(previous);
  }, [ambientTitle]);

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

  // 活跃态变化(spec session-meta-index, Req 8.1-8.3):忙态**双向**边沿 + 交互挂起数
  // 0↔非0 边沿都通知宿主重拉列表。上升边沿是改造前缺失的那个触发点。
  // 只在**边沿**通知(不是每次渲染),故用 ref 记上一拍的判据。
  // 交互挂起数取 `extensionUI.queue`(useExtensionUI 已只放交互类;推送类走 ambient 切片,
  // 不进此队列)—— 与服务端 deriveActivity 的 method 过滤同一语义。
  const awaitingCount = extensionUI?.queue.length ?? 0;
  const activityWasBusyRef = React.useRef<boolean>(false);
  const activityWasAwaitingRef = React.useRef<boolean>(false);
  React.useEffect(() => {
    const awaiting = awaitingCount > 0;
    if (
      activityWasBusyRef.current !== isBusy ||
      activityWasAwaitingRef.current !== awaiting
    ) {
      activityWasBusyRef.current = isBusy;
      activityWasAwaitingRef.current = awaiting;
      onActivityChange?.();
    }
  }, [isBusy, awaitingCount, onActivityChange]);

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
  // ───────────────────────────────────────────────────────────────────────────
  // 宿主内置 panes(spec host-builtin-panes,Req 1.x/2.x/3.x/5.x)
  //
  // 装载分派的**唯一**判定处,下面的 hasSurfacePanel / hasPanelRight 都从这里派生。
  // 三态而非二态:
  //   legacy-slot → agent 自带 panelRight 槽渲染器,走旧路径,内置 panes 让位(Req 1.2)
  //   host-panes  → 由本组件渲染 PanesHost,定义 = 内置 ⊕ agent 声明
  //   none        → 两者都没有,面板整体不渲染(Req 1.7,逐字回到本特性实施前)
  //
  // ★ 合并是**渲染期纯计算**,不放进 effect —— 否则首帧无定义,PanesHost 会以空定义建连,
  //   产生一次无效握手(既有 pane 时序缺陷的同一症状族)。
  // ★ 与上方 `logsPaneHosted` 同一归一化：webext 的 `panes` 既可能是两层
  //   `{ definition, config }`（agent 需同时给出运行期 panesConfig 时的写法），也可能是
  //   `definePanes()` 直接返回的扁平 `PanesDefinition`。这里若不先剥掉外层，
  //   `mergePaneSources` 拿到的 `source.definition.panes` 就是 undefined，
  //   `merge.ts` 里的 `for...of` 直接抛 "is not iterable"，整个 <PiChat> 崩成白屏。
  const rawAgentPanes = extension?.panes as
    | { readonly definition?: unknown; readonly panes?: unknown }
    | undefined;
  const agentPaneDecl =
    rawAgentPanes?.definition !== undefined ? rawAgentPanes.definition : rawAgentPanes;
  const paneMerge = React.useMemo(() => {
    const sources: PaneSource[] = [];
    if (hostPaneSource !== undefined) sources.push(hostPaneSource);
    if (agentPaneDecl !== undefined) {
      sources.push({
        kind: "agent",
        origin: extension?.manifestId ?? "agent",
        // agent 侧声明键是 panes-kit 定义的**最小结构镜像**(两包刻意无依赖边),此处交由
        // mergePaneSources → definePanes 做真正的校验。镜像与 canonical 的双向可赋值断言
        // 落在本层的测试里(见任务 6.2)。
        definition: agentPaneDecl as PaneSource["definition"],
      });
    }
    if (sources.length === 0) return undefined;
    return mergePaneSources(sources);
  }, [hostPaneSource, agentPaneDecl, extension?.manifestId]);
  const mergedPanes = paneMerge?.definition;
  // 日志只作为声明式 Guest Pane 注入，不把宿主 React 节点渲染进 pane。
  // 空 initialPaneIds 保证进入 Agent 时不自动打开日志，免首帧闪烁。
  const panesDefinition = React.useMemo((): PanesDefinition | undefined => {
    const logsPane = {
      id: LOGS_PANE_ID,
      title: "日志",
      icon: "scroll-text",
      document: createLogsPaneDocument(),
      capabilities: {
        routes: [{ name: "session.logs", methods: ["GET" as const], maxResponseBytes: 2 * 1024 * 1024 }],
      },
    };
    if (!logsPaneEnabled || logsPaneHosted) return mergedPanes;
    if (mergedPanes === undefined) {
      return definePanes({ id: "pi-web-core", initialPaneIds: [], panes: [logsPane] });
    }
    return definePanes({
      ...mergedPanes,
      panes: [...mergedPanes.panes, logsPane],
    });
  }, [logsPaneEnabled, logsPaneHosted, mergedPanes]);
  // agent 声明的 pane 交互配置(交互模式/tab 重排/命令面板/事件目标):领域中立地原样透传。
  // 迁移到声明键之前这是 agent 自己给 PanesHost 的 prop —— 不透传就会静默丢失那些能力。
  // ★ 从**未剥层**的原始声明取 `config`：两层形态下它是外层字段（与 definition 平级），
  //   扁平形态下则整个对象上没有 config。剥层后的 `agentPaneDecl` 上取不到它。
  const agentPaneConfig = (rawAgentPanes as { readonly config?: unknown } | undefined)?.config as
    | React.ComponentProps<typeof PanesHost>["config"]
    | undefined;
  // 拒绝记录在**会话装载期**上报,不推迟到用户点开 pane(Req 3.4)。
  const paneRejections = paneMerge?.rejections;
  React.useEffect(() => {
    if (paneRejections === undefined || paneRejections.length === 0) return;
    if (onPaneMergeRejections !== undefined) {
      onPaneMergeRejections(paneRejections);
      return;
    }
    for (const rejection of paneRejections) {
      log.warn("pane source rejected", {
        origin: rejection.origin,
        kind: rejection.kind,
        scope: rejection.scope,
        paneIds: rejection.paneIds,
        reason: rejection.reason,
        detail: rejection.detail,
      });
    }
  }, [paneRejections, onPaneMergeRejections]);

  // panelRight 区域是唯一被注入 `surface`(WebExtSurfaceAccess)的区域(launcherRail 拿不到 surface,
  // 见画布域 web.config 注释)。agent-authoritative-surface / AIGC 画布域的 surface 命令在**空闲期**
  // 触发,其权威快照回流(control:"state",key=surface:<domain>)只能由空闲控制流承载并应用进
  // ControlStore.states——故承载 surface 的面板须在空闲期常开该流,否则命令后的快照更新丢失
  // (计数停初值 / 画廊新图不进廊)。与 contributions/artifact 同理需要持久下行通道;由 `!isBusy`
  // 门控保证仅空闲期开(prompt 期由 per-prompt 流处理 control 帧,不重蹈 prompt-流回归)。
  //
  // ★ 宿主内置 panes 同样经该区域注入 surface,故判据必须一并涵盖 —— 漏掉会表现为
  //   「pane 起来了、能力也对,但 agent 快照永不更新」,而那极易被误判成 agent 没发快照。
  const hasSurfacePanel = mergedPanes !== undefined;
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

  React.useEffect(() => {
    if (transport === undefined) return;
    const timer = window.setTimeout(() => {
      const pending = pendingConversationSubmissions.current.splice(0);
      for (const { text, options } of pending) doSend(text, options);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [doSend, transport]);

  // 宿主会话能力对象(契约 §4.2;与 webextState / surfaceAccess 同族)。承载「经宿主 Prompt 通道提交
  // 用户消息」这一能力,经 SlotHost 注入 slot 组件,取代事件回调形态的裸注入项 onSubmitPrompt。
  // 领域无关:只搬运 text 与显式 attachmentIds,不解析、不改写内容。随 doSend 引用稳定,避免每渲染重建。
  const conversation = React.useMemo<ConversationAccess>(
    () => ({
      stageUserMessage: (text, options) => {
        setInput((current) => {
          const mentioned = new Set(scanAttachmentMentions(current));
          const tokens = (options?.attachmentIds ?? [])
            .filter((id) => !mentioned.has(id))
            .map((id) => `@attachment:${id}`);
          const staged = [text.trim(), ...tokens].filter((part) => part.length > 0).join(" ");
          if (staged.length === 0) return current;
          return current.trim().length === 0 ? staged : `${current.trimEnd()} ${staged}`;
        });
        window.requestAnimationFrame(() => inputRef.current?.focus());
      },
      submitUserMessage: (text, options) => {
        if (transport === undefined) {
          pendingConversationSubmissions.current.push({ text, options });
          startSession();
          return;
        }
        doSend(text, options);
      },
    }),
    [doSend, startSession, transport],
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
            // 通用卡片追加(spec install-host-command,任务 3.1):仅对声明了 resultDataPart 的
            // 词条(如 /agent、/plugin)生效——bang 命令同型,追加一条 assistant 消息。result.data 存在
            // → data part 卡片;仅 message(用法/帮助等无 data 的结果)→ 纯文本 part。
            // 卡片类型:**服务端逐次指定优先**,缺省才按命令名查表(spec publish-host-command)。
            // 按命令名查表意味着一个命令只能有一种结果卡片,而 `/agent install` 与
            // `/agent publish` 的结果形状完全不同 —— 故由 handler 经 `result.dataPart` 指定。
            // ★ `dataPart` 只来自服务端第一方 handler,不来自用户输入;未知取值不匹配任何
            //   渲染器 → 静默不渲染(fail-soft),不构成注入面。
            const partType = outcome.result?.dataPart ?? builtinResultDataParts?.[cmd.name];
            if (partType !== undefined && outcome.ok) {
              const result = outcome.result;
              if (result?.data !== undefined) {
                const card: UIMessage = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  parts: [{ type: partType, data: result.data } as UIMessage["parts"][number]],
                };
                chatRef.current.setMessages?.((prev) => [...prev, card]);
              } else if (result?.message !== undefined) {
                const text: UIMessage = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  parts: [{ type: "text", text: result.message }],
                };
                chatRef.current.setMessages?.((prev) => [...prev, text]);
              }
            }
            // app 级 effect(面板/通知等)交宿主处理。
            onCommandResult?.(cmd.name, outcome);
          },
        );
        return;
      }
      onBuiltinSelect?.(cmd, rawValue);
    },
    [client, sessionId, onCommandResult, onBuiltinSelect, builtinResultDataParts],
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

  // 停止本轮的兜底定时器句柄(spec tool-abort-terminal-state);卸载时取消,避免定时器泄漏。
  const stopHandleRef = React.useRef<StopTurnHandle | undefined>(undefined);
  React.useEffect(() => {
    return () => stopHandleRef.current?.cancelFallback();
  }, []);

  /**
   * 停止本轮。决策逻辑在 {@link runStopTurn}(独立可测),这里只做接线。
   *
   * ★ 关键:abort 成功时**不**本地停止 —— 本地停止会当场切断 SSE 流,后端随后推送的
   * 「工具已取消」终态帧就收不到,工具卡永久停在 Running(真机观测计时器走到 1:31)。
   * 让终态由后端帧驱动;本地停止仅作三种兜底,详见 stop-turn.ts。
   */
  const onStop = React.useCallback((): void => {
    stopHandleRef.current?.cancelFallback();
    stopHandleRef.current = runStopTurn({
      ...(controls !== undefined ? { abortTurn: () => controls.abort() } : {}),
      localStop: stop,
    });
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
  //
  // ★ 判据取 `panesDefinition` 而**不是** `mergedPanes` —— 二者只差一项:宿主在
  //   `showLogs && logsPanelVisible` 时注入的日志 pane。取 mergedPanes 会漏掉「只有注入的
  //   日志 pane、没有任何内置/agent pane」这一情形,后果是 aside 虽被 keepPanesHostAlive
  //   挂住,却因 showPanelRight=false 而 `aria-hidden` + 宽 0 —— 日志 pane 声明了却永远
  //   点不开(连「新开 Pane」按钮都摸不到)。
  //
  // ★ 与上方 `hasSurfacePanel` 在此**刻意分岔**,勿再合并成同一判据:那一个问的是「有没有
  //   承载 agent surface 的面板」(注入的日志 pane 不承载 surface,不该让它开启空闲控制流),
  //   这一个问的是「右侧面板要不要可见」。语义不同,取值来源自然不同。
  const hasPanelRight = panesDefinition !== undefined;

  /**
   * 宿主装载路径下 pane 可见的具名信号。
   *
   * 旧槽路径有 `syncSignal` / `livePreviewImage` 两个专有 prop,而 PanesHost 的接口里没有 ——
   * 它只有统一的具名信号通道。故此处把两者**并入信号**,使两条路径的注入面语义等价。
   * 这不是可选的细节:轮末同步信号缺失曾直接表现为「LLM 生了图,画廊不更新」。
   *
   * 宿主保留 `host:` 前缀命名信号;调用方经 `paneSignals` 传入的键原样保留(后写覆盖,
   * 使 app 层可按需覆盖宿主默认值)。
   */
  // 宿主环境信号族(spec panes-only-right-panel 任务 1.4):主题与对话流焦点。
  // 只在真的会渲染 pane 时启用 —— 无人消费就不该往文档上挂监听、打样式钩子。
  const environmentSignals = useHostEnvironmentSignals(mergedPanes !== undefined);

  const hostPaneSignals = React.useMemo<Readonly<Record<string, unknown>>>(
    () => ({
      ...environmentSignals,
      "host:syncSignal": panelSyncSignal,
      ...(livePreviewImage !== undefined ? { "host:livePreviewImage": livePreviewImage } : {}),
      ...(paneSignals ?? {}),
    }),
    [environmentSignals, panelSyncSignal, livePreviewImage, paneSignals],
  );
  const hasArtifactAside =
    extension?.artifact !== undefined && extensionBaseUrl !== undefined;
  const panelRatioActive = hasPanelRight;
  // centered 收起 panelRight(对话居中);artifact 永不被比例收起。
  const showPanelRight = hasPanelRight && panelRatio !== "centered";
  // native child 生命周期只由 PanesHost 上 observePanesHostPresence 驱动
  // （挂载/可见 → restore，收起 → hide，卸载 → destroy），PiChat 不主动 hide。
  // 有 panes 时 aside 保持挂载（宽 0 / 不可见），PanesHost 不卸载 → webview 只隐藏不销毁。
  const keepPanesHostAlive = panesDefinition !== undefined;
  const showAside =
    showPanelRight || hasArtifactAside || keepPanesHostAlive;
  // 连续宽度(全受控):宿主传 panelWidth 即启用,替离散 panelRatio 档。
  const resizablePanel = hasPanelRight && panelWidth !== undefined;
  // 宽度解析:连续模式 number→px、string 原样;否则离散档取预设宽;再否则不设(沿用 w-96 类)。
  let asideWidth: string | undefined;
  if (!showPanelRight && keepPanesHostAlive) {
    asideWidth = "0px";
  } else if (resizablePanel) {
    asideWidth =
      typeof panelWidth === "number"
        ? `${panelWidth}px`
        : panelWidth;
  } else if (panelRatioActive) {
    asideWidth = PANEL_RATIO_ASIDE_WIDTH[panelRatio];
  }

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
    skills:
      resources === undefined ? null : (
        <SkillPill config={resources} value={input} onInsert={setInput} />
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
          // agent-attachment-catalog:agent 主动推送后强制重查当前 token(Req 4.2/4.3)。
          refreshSignal={attachmentRefreshSignal}
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
      {/* agent-attachment-catalog:accept 异步换写失败的瞬态提示(撤 token 后,queueNotice 同 UX)。 */}
      {catalogNotice !== undefined ? (
        <div
          data-pi-catalog-notice
          role="status"
          className="mb-1 rounded-lg bg-[hsl(var(--destructive))]/10 px-3 py-1.5 text-xs text-[hsl(var(--destructive))]"
        >
          {catalogNotice}
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
      {resources !== undefined && messages.length === 0 ? (
        <PromptTemplateCards config={resources} onSelect={setInput} />
      ) : null}
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

  const extensionStatusBar = (
    <StatusBar
      statuses={statuses}
      className="border-b border-[hsl(var(--border))] px-4 py-2"
    />
  );

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

  // 「终止本轮」能力下发给工具卡(spec aigc-tool-abort UI 扩展):让用户在卡片上就地停止,
  // 不必跑回输入框 —— 图像生成常耗时 20~60s,视线一直在卡片上。
  // 仅在本轮运行中(isBusy)提供;否则传 undefined,工具卡据此**不渲染**停止按钮,
  // 而不是渲染一个点了没反应的按钮。
  const abortTurnForTools = isBusy ? onStop : undefined;

  const conversationBody = (
    <TurnAbortProvider onAbortTurn={abortTurnForTools}>
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Conversation
        className="flex-1"
        controlsBottom={dockHeight + 8}
        controlsClassName={lay.content}
        userMessageNavigation={messages.flatMap((message, index) => {
          if (message.role !== "user") return [];
          const label = message.parts
            .map((part) =>
              part.type === "text" && typeof part.text === "string"
                ? part.text
                : "",
            )
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return [{
            id: message.id,
            label: label === "" ? `用户输入 ${index + 1}` : label,
          }];
        })}
      >
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
            const conversationImages = conversationImagesOf(message);
            const firstConversationImagePart = message.parts.findIndex(isImageFilePart);
            const body = (
              <div className="space-y-2">
                {message.parts.map((part, i) => {
                  if (message.role === "assistant" && isImageFilePart(part)) {
                    return i === firstConversationImagePart ? (
                      <ConversationImageGallery
                        key={`${message.id}-completed-images`}
                        assets={conversationImages}
                        actions={extension?.conversationImageActions}
                        publishPaneEvent={publishPaneEvent}
                      />
                    ) : null;
                  }
                  return (
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
                  );
                })}
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
            return (
              <div
                key={message.id}
                data-pi-message-id={message.id}
                data-pi-message-role={message.role}
              >
                <MessageComp {...messageProps} />
              </div>
            );
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
        </div>
      </div>
    </div>
    </TurnAbortProvider>
  );

  const tree = (
    <div
      className={cn(
        "relative flex h-full w-full px-1 text-[hsl(var(--foreground))]",
        className,
      )}
      ref={panelResizeTreeRef}
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
      <div
        ref={panelConversationColumnRef}
        className="relative isolate flex min-w-0 flex-1 flex-col"
        data-pi-chat-conversation-column
        {...(panelConversationWidth !== undefined
          ? {
              style: {
                width: panelConversationWidth,
                flex: `0 0 ${panelConversationWidth}px`,
              },
            }
          : {})}
      >
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

        {extensionStatusBar}

        {/* Tier1 保留插槽:扩展状态栏(与 ambient StatusBar 共存)+ 工具条。 */}
        <ExtSlotRegion ext={extension} slot="statusBar" />
        <ExtSlotRegion ext={extension} slot="toolbar" />

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
          ref={panelAsideRef}
          className={cn(
            // relative:为连续模式拖拽分隔条(absolute left)提供定位上下文。
            // flex-col + min-h-0:为 right 位置日志面板提供有界高度上下文(见下方 logs 区);
            // 仅含 panelRight/artifact 时,子项无 flex-1 仍按内容堆叠(等价原 block 视觉)。
            "relative hidden min-h-0 shrink-0 lg:flex lg:flex-col",
            // 常显 1px 左边线；可拖宽时 resizer 只作命中层（默认透明）。
            showPanelRight
              ? "border-l border-[hsl(var(--border))]"
              : "overflow-hidden border-0",
            panelRatioActive || keepPanesHostAlive ? "" : "w-96",
          )}
          {...(asideWidth !== undefined
            ? {
                style: {
                  width: asideWidth,
                  ...(resizablePanel && showPanelRight
                    ? { maxWidth: `${maxPanelWidthRatio * 100}%` }
                    : {}),
                  ...(panelDragging
                    ? { position: "absolute" as const, insetBlock: 0, right: 0, zIndex: 20 }
                    : {}),
                },
              }
            : {})}
          data-pi-chat-aside
          data-pi-panel-open={showPanelRight ? "true" : "false"}
          {...(panelRatioActive && !resizablePanel
            ? { "data-pi-panel-ratio": panelRatio }
            : {})}
          {...(showPanelRight ? { "data-pi-ext-panel-right": "" } : {})}
        >
          {/* 命中条叠在 border 上；视觉线宽度保持原样，点击不提交宽度。 */}
          {resizablePanel && showPanelRight ? (
            <div
              data-pi-panel-resizer
              data-panes-host-slot-resizer
              role="separator"
              aria-orientation="vertical"
              className={cn(
                "absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none lg:block",
                panelDragging
                  ? "bg-[hsl(var(--border))]"
                  : "bg-transparent hover:bg-[hsl(var(--border))]",
              )}
              onPointerDown={onPanelResizeDown}
              onPointerMove={onPanelResizeMove}
              onPointerUp={onPanelResizeUp}
              onPointerCancel={onPanelResizeUp}
            />
          ) : null}
          {/*
            侧栏收起(showPanelRight=false)时仍挂载 PanesHost，仅 CSS 隐藏：
            native webview 走 host-fullscreen 隐藏，再开侧栏复用同一批实例，不销毁。
          */}
          {(showPanelRight || panesDefinition !== undefined) ? (
            <div
              className={cn(
                "min-h-0 flex-1 overflow-hidden",
                !showPanelRight && "pointer-events-none absolute inset-0 opacity-0",
              )}
              data-pi-panel-content-viewport
              data-pi-panel-collapsed={showPanelRight ? "false" : "true"}
              aria-hidden={!showPanelRight}
            >
              <div
                className="ml-auto h-full shrink-0"
                data-pi-panel-content
                style={{ width: "100%" }}
              >
                {/*
                  右侧面板的**唯一**机制(spec panes-only-right-panel):定义 = 宿主内置 ⊕
                  agent 声明键。旧的具名槽分派已删除 —— 它收的是宿主同 realm 的渲染物,
                  与 pane 的隔离模型不可兼容,且它的存在迫使内置 pane 在声明了该槽的 agent 下
                  整体让位。
                */}
                {readinessGating && !sessionReady ? (
                  <PaneLoadingSkeleton label={t("chat.readiness.connectingAgent")} />
                ) : (
                  <PanesHost
                  definition={panesDefinition!}
                  surface={surfaceAccess}
                  upload={uploadAttachment ?? defaultUploadAttachment}
                  baseUrl={client?.baseUrl ?? ""}
                  {...(sessionId !== undefined ? { sessionId } : {})}
                  sessionLogs={sessionLogs}
                  conversation={conversation}
                  {...(onPanelClose !== undefined ? { onRequestClose: onPanelClose } : {})}
                  {...(onPaneEvent !== undefined ? { onEvent: onPaneEvent } : {})}
                  {...(paneHostEvent !== undefined ? { hostEvent: paneHostEvent } : {})}
                  // 共享状态接入:宿主访问器与 pane 侧接口形状一致(读/订阅/写/删),直接透传。
                  // 授权在 pane 定义里逐键声明,这里不做任何放宽。
                  {...(webextState !== undefined ? { state: webextState } : {})}
                  // ★ 轮末同步信号与流式预览图以**具名信号**并入 —— pane 接口没有这两个专有 prop。
                  // 少任何一项都是静默失效面:轮末同步缺失曾表现为「LLM 生了图,画廊不更新」。
                  signals={hostPaneSignals}
                  {...(agentPaneConfig !== undefined ? { config: agentPaneConfig } : {})}
                  onHostError={(error) => {
                    log.error("pane host error", { code: error.code, message: error.message });
                  }}
                  />
                )}
              </div>
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
      {panelRatioActive && !resizablePanel ? (
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

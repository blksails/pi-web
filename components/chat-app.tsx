"use client";

import * as React from "react";
import {
  PiProvider,
  usePiSession,
  usePiControls,
  useExtensionUI,
  createPiClient,
  type UsePiSessionResult,
  type CommandOutcome,
} from "@blksails/pi-web-react";
import {
  PiChat,
  SessionListPanel,
  LauncherRail,
  SlotHost,
  resolveSlot,
  useI18n,
  type ExtensionCommandPolicy,
  type ComponentOverrides,
  type PiChatSlots,
  AgentSourcePicker,
} from "@blksails/pi-web-ui";
import type {
  CreateSessionRequest,
  AgentSourceItem,
} from "@blksails/pi-web-protocol";
import { BUILTIN_COMMANDS } from "@blksails/pi-web-tool-kit/commands";
import { toRpcSlashCommand } from "@/lib/app/plugin-command/to-rpc-command.js";

import { ThemeToggleButton, LocaleToggleButton } from "@/src/theme-controls.js";
import { resolveExtensionForSource } from "@/lib/app/webext-registry.js";
import { getPiWebDesktopBridge } from "@/lib/app/desktop-bridge.js";
import { useRuntimeWebext } from "@/lib/app/webext-load-client.js";
import {
  getRuntimeFeatures,
  type RuntimeFeatures,
} from "@/lib/app/runtime-features.js";
import { ChatReasoning } from "./chat-reasoning.js";
import { LoggingConfigLoader } from "./logging-config-loader.js";
import { AccountBar } from "./auth/account-bar.js";
import {
  IdentityStateProvider,
  identityListKey,
  useIdentity,
} from "./auth/use-identity.js";
import { IdentityGate } from "./auth/login-page.js";
import {
  IDENTITY_REVISION_SIGNAL_NAME,
  builtinPaneSource,
  buildSessionSignals,
} from "../lib/app/builtin-panes/index.js";

/** 侧栏折叠/展开图标(内联,避免在 app 层引入 lucide 依赖)。 */
/** Pane 收起态展开钮：与 prototype 右侧分栏符号一致（线在右）。 */
function PanelToggleIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  );
}

/** 侧栏折叠箭头：方向始终指向下一步动作。ui-redesign:图标 16px。 */
function PanelArrowIcon({
  direction,
}: {
  readonly direction: "left" | "right";
}): React.JSX.Element {
  const right = direction === "right";
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={right ? "M9 6 15 12 9 18" : "M15 6 9 12 15 18"} />
      <path d={right ? "M4 12h11" : "M20 12H9"} />
    </svg>
  );
}

function SwitchAgentIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h13l-3-3" />
      <path d="m17 7-3 3" />
      <path d="M20 17H7l3 3" />
      <path d="m7 17 3-3" />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </svg>
  );
}

type LogsPanelConfig = {
  /** 服务端权威门控是否开启;undefined = 配置尚未取到(加载中)。 */
  readonly loggingEnabled?: boolean;
  readonly panelVisible: boolean;
  readonly panelPosition: "bottom" | "right" | "drawer" | "top";
};

/**
 * useLogsPanelConfig — fetches logging.outputs.panelVisible and
 * logging.outputs.panelPosition from the config API in a single request.
 *
 * Returns safe defaults until the config loads. Silently falls back to
 * defaults on any error so a broken config endpoint never hides the log panel
 * when the user expects it (Req 6.6).
 */
function useLogsPanelConfig(): LogsPanelConfig {
  const [config, setConfig] = React.useState<LogsPanelConfig>({
    panelVisible: true,
    panelPosition: "bottom",
  });

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/config/logging", { method: "GET" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          values?: {
            enabled?: boolean;
            outputs?: {
              panelVisible?: boolean;
              panelPosition?: "bottom" | "right" | "drawer" | "top";
            };
          };
        };
        const outputs = json.values?.outputs;
        const loggingEnabled = json.values?.enabled;
        setConfig((prev) => {
          const panelVisible =
            typeof outputs?.panelVisible === "boolean"
              ? outputs.panelVisible
              : prev.panelVisible;
          const panelPosition =
            outputs?.panelPosition === "bottom" ||
            outputs?.panelPosition === "right" ||
            outputs?.panelPosition === "drawer" ||
            outputs?.panelPosition === "top"
              ? outputs.panelPosition
              : prev.panelPosition;
          return {
            panelVisible,
            panelPosition,
            ...(typeof loggingEnabled === "boolean" ? { loggingEnabled } : {}),
          };
        });
      } catch {
        // Silent fallback: keep safe defaults.
      }
    })();
  }, []);

  return config;
}

/**
 * 细粒度组件覆盖:用 AI Elements 风格的 Reasoning(流式自动展开 + "Thought for Ns")
 * 替换默认 PiReasoning。模块级常量(引用稳定,避免每渲染新对象使下游 useMemo 失效)。
 */
const PI_CHAT_COMPONENTS: ComponentOverrides = { Reasoning: ChatReasoning };

/**
 * desktop-directory-picker:读取桌面壳注入的原生目录选择能力,供 AgentSourcePicker 的
 * `onBrowseDirectory`(首屏 picker + 会话内 dialog picker 共用)。仅在挂载后读取,避免 SSR
 * 与首帧客户端渲染不一致(服务端无 window ⇒ 无「浏览」按钮)导致水合错配。浏览器态恒为 undefined。
 */
function useDesktopPickDirectory():
  | (() => Promise<string | undefined>)
  | undefined {
  const [pick, setPick] = React.useState<
    (() => Promise<string | undefined>) | undefined
  >(undefined);
  React.useEffect(() => {
    const fn = getPiWebDesktopBridge()?.pickDirectory;
    // 存函数须用更新函数式包裹,否则 setState 会把函数当 updater 调用。
    if (fn !== undefined) setPick(() => fn);
  }, []);
  return pick;
}

/**
 * ChatApp — the client-side assembly: pick source → create session → render
 * the rich chat UI <PiChat> (default rich component; formerly <PiChat>) with
 * controls + permission dialog.
 *
 * Until a session is created it renders <AgentSourcePicker>. On submit it builds
 * a CreateSessionRequest (source + default cwd/model) and drives the connection
 * via @blksails/pi-web-react hooks pointed at this site's `/api/sessions`. Controls and
 * the permission dialog ride hook side-channels — they never enter the message
 * stream (Req 6.4). Both custom-agent and general-CLI modes reuse this same
 * page (Req 9.3).
 *
 * URL resume: when `resumeId` is provided (via the `/session/[id]` route) the
 * app skips the picker and resumes that session, loading its history. On any
 * new session the browser address is synced to `/session/:id` (history
 * replaceState — no full navigation), so the URL always reflects the session.
 */
export interface ChatAppProps {
  readonly defaultSource: string | undefined;
  /** Optional model override; when undefined, the agent uses ~/.pi/agent settings.json. */
  readonly defaultModel: string | undefined;
  readonly defaultCwd: string;
  /** When set, resume this existing session (cold-resume + continue) instead of picking a source. */
  readonly resumeId?: string;
  /**
   * Recovered agent source for a resumed session (= the session's persisted
   * agent cwd). Lets the build-time webext registry re-resolve the source's UI
   * extension on cold load / reload of `/session/:id`; without it `create.source`
   * would fall back to `"."` and the extension (region slots, background, …)
   * would silently vanish after refresh.
   */
  readonly resumeSource?: string;
  /**
   * When true, auto-create a session from `defaultSource` on mount and skip the
   * agent-source picker. Set by the CLI which has already determined the source.
   * The user can still leave via "切换源" (onReset) to reach the picker.
   */
  readonly autoStart?: boolean;
}

interface ActiveSession {
  readonly create: CreateSessionRequest;
  /** Present only when this session is a resume of an existing one. */
  readonly resumeId?: string;
}

/** Build the create request from props + a resolved source. */
function buildCreate(props: ChatAppProps, source: string): CreateSessionRequest {
  return {
    source,
    cwd: props.defaultCwd,
    // Only force a model when explicitly configured; otherwise the agent
    // process honors ~/.pi/agent/settings.json defaultModel/defaultProvider.
    ...(props.defaultModel !== undefined && props.defaultModel.length > 0
      ? { model: props.defaultModel }
      : {}),
  };
}

/**
 * 门控派生值的惰性求值 + 记忆化。
 *
 * 迁移前这些是**模块级常量**(`process.env.NEXT_PUBLIC_*` 由 Next 构建期内联)。SPA 下门控
 * 改由 `GET /api/bootstrap` 在运行时下发,经 `setRuntimeFeatures()` 注入 —— 那发生在模块
 * 求值**之后**、首次渲染**之前**。故求值必须推迟到首次读取。
 *
 * 记忆化保留了原本「引用稳定」的性质(下游 `useMemo` 依赖这些对象):门控在一次页面生命周期
 * 内不变,首次求值后即固定。
 */
function memoizeFeature<T>(derive: (f: RuntimeFeatures) => T): () => T {
  let cached: { readonly value: T } | undefined;
  return (): T => {
    cached ??= { value: derive(getRuntimeFeatures()) };
    return cached.value;
  };
}

/**
 * 扩展(source==="extension")命令在命令补全里的可见策略。
 *
 * 默认隐藏所有扩展命令:它们在 web 端会让该轮永久卡 pending(扩展命令本地执行后提前
 * 返回、不发 agent_end,详见 PiCommandPalette 文件头)。可经环境变量覆盖(经 bootstrap
 * 下发,运行时生效):
 *   NEXT_PUBLIC_PI_EXTENSION_COMMANDS=all        → 放行所有扩展命令(谨慎,可能卡死)
 *   NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST=foo,bar   → 仅按名放行(逗号分隔),其余仍隐藏
 */
const extensionCommandPolicy = memoizeFeature(
  (f): ExtensionCommandPolicy => ({
    enabled: f.extensionCommands === "all",
    allowlist: [
      // 平台内置「扩展管理扩展」命令默认放行(spec extension-install-agent-tools):
      // 它们在 web 端不卡 pending —— PiChat onSubmit 识别 source==="extension" 命令后经
      // client.prompt fire-and-forget 执行(不进 useChat)。旧 agent 侧 `/plugin` 命令已摘除
      // (spec install-host-command,任务 4.1/4.2):装/卸/列/更新改由 host 通道 `/install`
      // 承接(builtin,见 extensionCommandPolicy 之外的 builtinCommands 合流),故此处不再放行
      // "plugin"。
      "reload-runtime",
      // 视觉识别命令(spec image-vision-tool,Req 6.1):`/img_vision` 看会话内最近一张图。
      // 与 /plugin 同理不卡 pending(fire-and-forget),结论经 ctx.ui 通知呈现、不进消息历史。
      // 仅按名放行本命令 —— 绝不打开 `enabled: true`(那会放行全部扩展命令,多数在 web 端会卡死)。
      "img_vision",
      ...f.extensionAllowlist
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ],
  }),
);

/**
 * 会话列表(sessions-list)宿主配置:
 *   sessionsGlobal → 显示「全部」(系统/全机器)Tab(默认关闭)
 *   sessionsSlot   → 展示位置 sidebar|header|footer|empty(默认 sidebar)
 * 与后端门控同名,两端对系统视图是否启用保持一致。
 */

// session-list-item-actions:会话项管理写操作(删除/重命名/收藏)是否启用。默认启用;
// 关闭时隐藏写入口(与后端同名门控两端一致:服务端亦拒绝写请求)。
const sessionsManageEnabled = memoizeFeature((f) => f.sessionsManage);

// agent-sources-list:是否在源选择器中展示"可浏览的源列表"。
// 后端未配来源时端点返回空列表,两端一致表现为"无列表可浏览"(Req 6.4)。
const sourcePickerEnabled = memoizeFeature((f) => f.sourcePicker);

// sidebar-launcher-rail:是否在侧栏会话列表之上渲染启动导航区(搜索/新建/收藏锚点/webext槽)。
// 未启用时侧栏退化为仅会话列表(Req 1.4/6.1)。
const launcherRailEnabled = memoizeFeature((f) => f.launcherRail);

/** 允许的宿主插槽子集(PiChatSlots 中可承载块级面板的 key)。 */
type SessionsSlotKey = "sidebar" | "header" | "footer" | "empty";
const ALLOWED_SESSIONS_SLOTS: readonly SessionsSlotKey[] = [
  "sidebar",
  "header",
  "footer",
  "empty",
];
const sessionsSlot = memoizeFeature((f): SessionsSlotKey =>
  (ALLOWED_SESSIONS_SLOTS as readonly string[]).includes(f.sessionsSlot)
    ? (f.sessionsSlot as SessionsSlotKey)
    : "sidebar",
);

// 就绪握手(spec session-readiness-handshake):默认开启,与服务端 readinessHandshake 一致;
// 经公开 env 关闭(须与服务端 PI_WEB_DISABLE_READINESS_HANDSHAKE 同步)。
const gateUntilReady = memoizeFeature((f) => !f.disableReadinessHandshake);

// bang shell 命令的前端体验开关(spec bang-shell-command,Req 5.5/5.6/5.7)。
// 非用户可写 Settings;服务端权威门控独立。
const bashEnabled = memoizeFeature((f) => f.bashEnabled);

// Tier4 隔离表面基址(spec agent-web-extension)。空 → 不传,<ArtifactSurface> 不挂载
// (记忆 webext-artifact-base-url-gate:无 iframe 是正确门控,非 bug)。
const extensionBaseUrl = memoizeFeature((f) => f.extensionBaseUrl);

/** 把会话列表面板放入选定的宿主插槽(类型安全;默认 sidebar)。 */
function sessionListSlots(node: React.ReactNode): PiChatSlots {
  switch (sessionsSlot()) {
    case "header":
      return { header: node };
    case "footer":
      return { footer: node };
    case "empty":
      return { empty: node };
    case "sidebar":
    default:
      return { sidebar: node };
  }
}

/** 声明式 layout preset 白名单收窄(R27);返回类型绑定到 PiChat 的 layout prop。 */
const LAYOUT_PRESETS: readonly string[] = ["centered", "wide", "full", "split"];
type LayoutPresetValue = NonNullable<
  React.ComponentProps<typeof PiChat>["layout"]
>;
function narrowLayoutPreset(
  v: string | undefined,
): LayoutPresetValue | undefined {
  return v !== undefined && LAYOUT_PRESETS.includes(v)
    ? (v as LayoutPresetValue)
    : undefined;
}

/**
 * 从 agent source 派生默认标签页标题:取路径/URL 末段名(去尾斜杠与 `.git` 后缀)。
 * 源为空或裸 cwd("." )时返回 undefined —— 没有有意义的名字,保留宿主默认标题。
 * 仅作 `config.documentTitle` 未显式声明时的回落。
 */
function deriveSourceTitle(source: string): string | undefined {
  if (source.length === 0 || source === ".") return undefined;
  const trimmed = source.replace(/[/\\]+$/, "");
  const base = (trimmed.split(/[/\\]/).pop() ?? trimmed).replace(/\.git$/, "");
  return base.length > 0 ? base : undefined;
}

/** 比较 source 路径/id(Windows 斜杠与尾斜杠不敏感)。 */
function sameAgentSource(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** 侧栏/标题展示名:元数据 title > name > 路径末段。 */
function displayAgentLabel(
  meta: Pick<AgentSourceItem, "title" | "name"> | null | undefined,
  source: string,
): string {
  const titled = meta?.title?.trim();
  if (titled !== undefined && titled.length > 0) return titled;
  const named = meta?.name?.trim();
  if (named !== undefined && named.length > 0) return named;
  return deriveSourceTitle(source) ?? "Agent";
}

export function ChatApp(props: ChatAppProps): React.JSX.Element {
  // IdentityStateProvider:AccountBar 与 agent-sources 刷新共享同一身份态(不可各挂 useIdentity)。
  // IdentityGate:登录门禁。★ 它**只在登录确实可用时**才拦(云端未配置 → 直接放行),
  // 判定见 auth/login-page.tsx 顶部表格 —— 拦错会把纯本地用法整个废掉。
  return (
    <IdentityStateProvider>
      <IdentityGate>
        <ChatAppBody {...props} />
      </IdentityGate>
    </IdentityStateProvider>
  );
}

function ChatAppBody(props: ChatAppProps): React.JSX.Element {
  // Logging panel config (Req 6.6 + 6.1/6.2): defaults until config loads.
  const logsPanelConfig = useLogsPanelConfig();

  // agent-sources-list:源选择器的只读列表数据源(注入 PiClient.listAgentSources)。
  // 与 SessionListPanel 同构的注入式接线——组件不持接线,便于测试。
  const pickerClient = React.useMemo(() => createPiClient("/api"), []);

  // desktop-hybrid-agent-sources:身份变化后重拉 /agent-sources(与 AccountBar 同 Provider)。
  const identity = useIdentity();
  const authListIdentity = identityListKey(identity.state);
  const [agentSourcesRefreshKey, setAgentSourcesRefreshKey] = React.useState(0);
  const [identityRevision, setIdentityRevision] = React.useState(0);
  const identityRevisionInitialized = React.useRef(false);
  React.useEffect(() => {
    setAgentSourcesRefreshKey((n) => n + 1);
    if (identityRevisionInitialized.current) setIdentityRevision((n) => n + 1);
    else identityRevisionInitialized.current = true;
  }, [authListIdentity]);

  // sidebar-launcher-rail:收藏集合(供选择器星标高亮 + 切换)。选择器(session===undefined)
  // 与侧栏导航区(SessionView 内)是互斥视图,故此处仅服务选择器的星标态;导航区锚点由
  // LauncherRail 自身经 listFavorites 拉取。
  const [favoriteSources, setFavoriteSources] = React.useState<Set<string>>(
    () => new Set(),
  );
  // desktop-directory-picker:桌面壳注入的原生目录选择能力(首屏 picker 用;dialog picker 同源)。
  const desktopPickDirectory = useDesktopPickDirectory();
  // 返回选择器时 bump(onReset)→ 重拉收藏,反映在会话内(LauncherRail)对收藏的增删,
  // 避免选择器星标态陈旧(reviewer 反馈)。
  const [favoritesReloadKey, setFavoritesReloadKey] = React.useState(0);
  React.useEffect(() => {
    if (!launcherRailEnabled()) return;
    let live = true;
    void pickerClient
      .listFavorites()
      .then((res) => {
        if (live) setFavoriteSources(new Set(res.favorites.map((f) => f.source)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pickerClient, favoritesReloadKey]);
  const onToggleFavorite = React.useCallback(
    (item: AgentSourceItem): void => {
      setFavoriteSources((prev) => {
        const next = new Set(prev);
        if (next.has(item.source)) next.delete(item.source);
        else next.add(item.source);
        return next;
      });
      // 读当前收藏 → 计算下一状态 → 持久化(全量替换)。存 title/avatar 供锚点展示。
      void pickerClient
        .listFavorites()
        .then((res) => {
          const exists = res.favorites.some((f) => f.source === item.source);
          const next = exists
            ? res.favorites.filter((f) => f.source !== item.source)
            : [
                ...res.favorites,
                {
                  source: item.source,
                  name: item.name,
                  ...(item.title !== undefined ? { title: item.title } : {}),
                  ...(item.avatar !== undefined ? { avatar: item.avatar } : {}),
                },
              ];
          return pickerClient.setFavorites({ favorites: next });
        })
        .then((res) =>
          setFavoriteSources(new Set(res.favorites.map((f) => f.source))),
        )
        .catch(() => {});
    },
    [pickerClient],
  );

  // Resume mode (resumeId) or CLI autostart (source already determined): enter
  // SessionView immediately and skip the picker.
  const [session, setSession] = React.useState<ActiveSession | undefined>(
    props.resumeId !== undefined
      ? {
          create: buildCreate(
            props,
            props.resumeSource ?? props.defaultSource ?? ".",
          ),
          resumeId: props.resumeId,
        }
      : props.autoStart
        ? { create: buildCreate(props, props.defaultSource ?? ".") }
        : undefined,
  );
  // 新建会话计数:onSubmit 时 bump 以变更 SessionView 的 key,强制重挂得到全新会话
  // (即便选中同一 source)。
  const [nonce, setNonce] = React.useState<number>(0);

  // 切源/新建/恢复会话:先隐藏旧 pane webview 再销毁。销毁(cleanup)为异步 IPC,remount
  // 骨架屏渲染期间未销毁完的旧 webview 会残留一帧旧内容;先发 hide_all 可立即遮蔽该闪帧。
  const hideThenDestroyPaneWebviews = React.useCallback((): void => {
    const bridge = getPiWebDesktopBridge();
    void bridge?.hidePaneWebviews?.();
    void bridge?.destroyPaneWebviews?.();
  }, []);

  const onSubmit = (source: string): void => {
    const resolved = source.length > 0 ? source : (props.defaultSource ?? ".");
    // 换源 / 新建会话：先隐藏再销毁旧 pane webview（非隐藏）。
    hideThenDestroyPaneWebviews();
    // New session: no resumeId. bump nonce 强制 SessionView 重挂 —— 使侧栏「新建聊天」
    // 即便选中当前同一 source 也得到全新会话(usePiSession 不响应 create 变化重建,须靠
    // key 重挂)。原顶栏「新建会话」按钮已移除,同源新建统一由「新建聊天」承担。
    setSession({ create: buildCreate(props, resolved) });
    setNonce((n) => n + 1);
  };

  const onReset = (): void => {
    // 退出会话回源选择：先隐藏再销毁 pane。
    hideThenDestroyPaneWebviews();
    setSession(undefined);
    // 返回选择器:重拉收藏,反映会话内导航区对收藏的增删(避免星标态陈旧)。
    setFavoritesReloadKey((n) => n + 1);
    // Drop back to the picker URL so a refresh does not re-resume.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  };

  // pane webview 生命周期：由 panes-kit observePanesHostPresence 统一驱动
  // （host 卸载 destroy / 不可见 hide），此处不主动 hide，避免与公共能力分叉。

  // 同源新建:保持当前 agent source、丢弃 resumeId,bump nonce 变更 SessionView 的 key 强制
  // 重挂,得到同一 source 的全新会话。仅 rail 关闭态账户区仍提供此入口(rail 开启时由
  // 侧栏「新建聊天」承担,见 SessionView 账户区)。
  const onNewByAgentSource = (): void => {
    hideThenDestroyPaneWebviews();
    setSession((s) => (s === undefined ? s : { create: s.create }));
    setNonce((n) => n + 1);
  };

  return (
    <PiProvider baseUrl="/api">
      {/* 日志配置加载器：mount 时拉取 /api/config/logging → configureLogger（Req 6.4/6.5/6.6）*/}
      <LoggingConfigLoader />
      {session === undefined ? (
        <AgentSourcePicker
          onSubmit={onSubmit}
          defaultSource={props.defaultSource}
          enableSourceList={sourcePickerEnabled()}
          listAgentSources={pickerClient.listAgentSources}
          refreshSignal={agentSourcesRefreshKey}
          {...(launcherRailEnabled()
            ? { favoriteSources, onToggleFavorite }
            : {})}
          {...(desktopPickDirectory !== undefined
            ? { onBrowseDirectory: desktopPickDirectory }
            : {})}
        />
      ) : (
        <SessionView
          key={`${session.create.source}#${nonce}`}
          create={session.create}
          {...(session.resumeId !== undefined
            ? { resumeId: session.resumeId }
            : {})}
          onReset={onReset}
          onNewByAgentSource={onNewByAgentSource}
          onLaunchSource={onSubmit}
          agentSourcesRefreshKey={agentSourcesRefreshKey}
          identityRevision={identityRevision}
          onAgentSourcesRefresh={() =>
            setAgentSourcesRefreshKey((n) => n + 1)
          }
          logsPanelVisible={logsPanelConfig.panelVisible}
          logsPanelPosition={logsPanelConfig.panelPosition}
          loggingEnabled={logsPanelConfig.loggingEnabled}
        />
      )}
    </PiProvider>
  );
}

function SessionView({
  create,
  resumeId,
  onReset,
  onNewByAgentSource,
  onLaunchSource,
  agentSourcesRefreshKey: parentAgentSourcesRefreshKey = 0,
  identityRevision = 0,
  onAgentSourcesRefresh,
  logsPanelVisible,
  logsPanelPosition,
  loggingEnabled,
}: {
  readonly create: CreateSessionRequest;
  readonly resumeId?: string;
  readonly onReset: () => void;
  /** 同源新建(仅 rail 关闭态账户区使用;rail 开启时由侧栏「新建聊天」承担)。 */
  readonly onNewByAgentSource: () => void;
  /** sidebar-launcher-rail:以某 source 新建会话(收藏锚点点击)。 */
  readonly onLaunchSource: (source: string) => void;
  /** 父级登录/登出触发的 agent-sources 刷新信号。 */
  readonly agentSourcesRefreshKey?: number;
  /** 身份切换后通知已挂载 pane 重取宿主侧数据；不含凭据。 */
  readonly identityRevision?: number;
  /** install 成功等会话内事件需要再 bump 父级刷新信号。 */
  readonly onAgentSourcesRefresh?: () => void;
  /** Controls LogsPanel visibility per logging config (Req 6.6). */
  readonly logsPanelVisible?: boolean;
  /** 服务端权威日志门控;透传给 LogsPanel 以区分「已关闭」与「暂无日志」。 */
  readonly loggingEnabled?: boolean;
  /** Controls LogsPanel position per logging config (Req 6.1/6.2). Default "bottom". */
  readonly logsPanelPosition?: "bottom" | "right" | "drawer" | "top";
}): React.JSX.Element {
  const t = useI18n();
  // desktop-directory-picker:会话内「切换源」dialog picker 同样注入桌面原生目录选择能力。
  const desktopPickDirectory = useDesktopPickDirectory();
  // 侧栏折叠:折叠后保留 w-14 icon rail;展开态 240px(ui-redesign 232-248)。
  // localStorage 持久化;SSR 安全:初值 false,挂载后读偏好。
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("pi-web:sidebar-collapsed") === "1")
      setSidebarCollapsed(true);
  }, []);
  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined")
        window.localStorage.setItem(
          "pi-web:sidebar-collapsed",
          next ? "1" : "0",
        );
      return next;
    });
  }, []);
  const session: UsePiSessionResult = usePiSession({
    create,
    ...(resumeId !== undefined ? { resumeId } : {}),
    // Sync the browser address to /session/:id once the id is known (new or
    // resumed). No full navigation — keeps the live session intact. The URL
    // stays clean (no file path): instead we record sessionId → source in an
    // app-level map so a cold load / reload can re-resolve the build-time webext
    // extension by id — even for a brand-new, message-less session whose agent
    // header is not persisted yet (the resume-meta fallback cannot recover it).
    onSessionId: (id) => {
      if (typeof window === "undefined") return;
      const path = `/session/${id}`;
      window.history.replaceState(null, "", path);
      // 设置页「返回」用：回到当前会话，而非 agent 选择页。
      try {
        sessionStorage.setItem("pi-web:last-session-path", path);
      } catch {
        // private mode / 配额：忽略。
      }
      if (create.source.length > 0 && create.source !== ".") {
        void fetch("/api/session-source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, source: create.source }),
        }).catch(() => {
          // best-effort:映射失败时冷加载退回持久化 header.cwd 兜底。
        });
      }
    },
  });

  const controls = usePiControls({
    sessionId: session.sessionId,
    connection: session.connection,
  });

  const extensionUI = useExtensionUI({
    sessionId: session.sessionId,
    connection: session.connection,
  });

  // 构建期集成:按 agent source 解析其 UI 扩展(.pi/web),传给 <PiChat>(Tier1/2)。
  const buildTimeExtension = React.useMemo(
    () => resolveExtensionForSource(create.source),
    [create.source],
  );
  // 运行时集成(webext-package-install):构建期未命中时,经 /api/webext/resolve 动态加载已装源 webext。
  // webextReloadNonce:装/卸 plugin 后 bump,触发 webext 加载路径(builtin-plugin-command 4.2 双路之一)。
  const [webextReloadNonce, setWebextReloadNonce] = React.useState(0);
  const runtimeWebext = useRuntimeWebext(
    create.source,
    buildTimeExtension !== undefined,
    webextReloadNonce,
  );
  const extension = buildTimeExtension ?? runtimeWebext.extension;

  // 右侧面板的连续宽度由宿主持有：webext 只声明初值/边界，PiChat 内置分隔条持续回传 px。
  // extension/source 切换时重置，避免把上一个 Agent 的用户拖拽宽度泄漏到下一个 Agent。
  const panelPersistenceKey = (
    extension?.panes?.config as { readonly persistenceKey?: unknown } | undefined
  )?.persistenceKey;
  const persistedPanelKey = typeof panelPersistenceKey === "string" ? `${panelPersistenceKey}:sidebar` : undefined;
  const configuredPanelWidth = extension?.config?.panelWidth;
  const [panelWidth, setPanelWidth] = React.useState<number | undefined>(configuredPanelWidth);
  // 宿主内置 pane 来源(spec host-builtin-panes)。清单为空(如构建产物缺席)时为 undefined,
  // 此时判据退回「只看 agent 有无贡献」,即本特性实施前的行为(Req 1.7)。
  const hostPaneSource = React.useMemo(() => builtinPaneSource(), []);
  // 会话事实 → 具名信号。cwd 是**创建请求里的值**;agent 侧解析后可能另有其所(如内置
  // default-agent 的 cwd 由 resolver 设为用户工作目录),故 pane 的字段语义是「请求的工作目录」。
  const paneSignals = React.useMemo(
    () => ({
      ...buildSessionSignals({
        sessionId: session.sessionId,
        agentSource: create.source,
        cwd: create.cwd,
      }),
      [IDENTITY_REVISION_SIGNAL_NAME]: identityRevision,
    }),
    [session.sessionId, create.source, create.cwd, identityRevision],
  );
  // ★ 判据须与 PiChat 内部的同名判据**同源**:两项输入(内置来源 / agent 声明键)任一存在
  // 即有面板。不同步会导致「外层容器与内层内容一个显示一个不显示」。
  // (旧的具名槽分支已随 spec panes-only-right-panel 删除。)
  const hasSidePanel =
    hostPaneSource !== undefined || extension?.panes !== undefined;
  const configuredPanelRatio = extension?.config?.panelRatio;
  const [sidePanelOpen, setSidePanelOpen] = React.useState(
    () => hasSidePanel && configuredPanelRatio !== "centered",
  );
  React.useEffect(() => {
    let saved: { open?: unknown; width?: unknown } | undefined;
    if (persistedPanelKey !== undefined && typeof window !== "undefined") {
      try {
        saved = JSON.parse(window.localStorage.getItem(persistedPanelKey) ?? "null") as typeof saved;
      } catch {
        saved = undefined;
      }
    }
    setPanelWidth(typeof saved?.width === "number" ? saved.width : configuredPanelWidth);
    setSidePanelOpen(typeof saved?.open === "boolean"
      ? saved.open && hasSidePanel
      : hasSidePanel && configuredPanelRatio !== "centered");
  }, [extension?.manifestId, configuredPanelRatio, configuredPanelWidth, hasSidePanel, persistedPanelKey]);
  const persistPanel = React.useCallback((patch: { readonly open?: boolean; readonly width?: number }): void => {
    if (persistedPanelKey === undefined || typeof window === "undefined") return;
    let current: { open?: boolean; width?: number } = {};
    try {
      current = JSON.parse(window.localStorage.getItem(persistedPanelKey) ?? "{}") as typeof current;
    } catch {
      // 损坏偏好直接覆写。
    }
    window.localStorage.setItem(persistedPanelKey, JSON.stringify({ ...current, ...patch }));
  }, [persistedPanelKey]);
  const changePanelWidth = React.useCallback((width: number): void => {
    setPanelWidth(width);
    persistPanel({ width });
  }, [persistPanel]);
  const effectivePanelRatio: React.ComponentProps<typeof PiChat>["panelRatio"] =
    !hasSidePanel || !sidePanelOpen
      ? "centered"
      : configuredPanelRatio === undefined || configuredPanelRatio === "centered"
        ? "2:1"
        : configuredPanelRatio;
  const closePanelRight = React.useCallback(() => {
    setSidePanelOpen(false);
    persistPanel({ open: false });
  }, [persistPanel]);
  const openPanelRight = React.useCallback(() => {
    setSidePanelOpen(true);
    persistPanel({ open: true });
  }, [persistPanel]);
  // panes 侧栏入口（Canvas 画廊等）经 pi-panes-panel-open 请求展开右栏。
  React.useEffect(() => {
    const onOpen = (): void => {
      openPanelRight();
    };
    window.addEventListener("pi-panes-panel-open", onOpen);
    return () => window.removeEventListener("pi-panes-panel-open", onOpen);
  }, [openPanelRight]);
  // 内置斜杠命令(builtin-plugin-command):前置合流到命令面板;选中走 harness 分派(不进 LLM)。
  const builtinCommands = React.useMemo(
    () => BUILTIN_COMMANDS.map(toRpcSlashCommand),
    [],
  );
  // 词条名 → 结果卡片 data part 类型(spec install-host-command,任务 3.1):`RpcSlashCommand`
  // 是 pi 原生派生形状,不携带 `resultDataPart`,故从 tool-kit 的 BuiltinCommandSpec 单独派生
  // 一份映射传给 PiChat(dispatchBuiltin 据此判断是否把结果追加为聊天卡片,如 /install)。
  const builtinResultDataParts = React.useMemo(
    () =>
      Object.fromEntries(
        BUILTIN_COMMANDS.filter((c) => c.resultDataPart !== undefined).map((c) => [
          c.name,
          c.resultDataPart as string,
        ]),
      ),
    [],
  );
  // 扩展安装已迁出为 agent 内置工具(spec extension-install-agent-tools),信息/进度走 ctx.ui
  // (StatusBar/通知),不再有 plugin 模态面板与 host 命令结果回流。

  // 会话列表(sessions-list):宿主级 REST client + 列表面板,经选定宿主插槽注入 <PiChat>。
  // 列表数据经 client.listSessions 注入(面板不持 pi 接线);恢复复用 /session/:id 成熟链路
  // (冷恢复 + 历史回放 + source 反查),失败时由该路由的 SessionView 错误态提示。
  const piClient = React.useMemo(() => createPiClient("/api"), []);
  const onResumeSession = React.useCallback((id: string): void => {
    if (typeof window === "undefined") return;
    const navigate = (): void => window.location.assign(`/session/${id}`);
    // 切到另一会话：先隐藏再销毁当前 pane 再导航。
    const bridge = getPiWebDesktopBridge();
    if (bridge?.hidePaneWebviews !== undefined) void bridge.hidePaneWebviews();
    const destroy = bridge?.destroyPaneWebviews;
    if (destroy === undefined) {
      navigate();
      return;
    }
    void destroy().then(navigate, navigate);
  }, []);
  const onPaneEvent = React.useCallback((topic: string, payload: unknown): boolean => {
    if (topic !== "pi.session.locate") return false;
    const sessionId =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { sessionId?: unknown }).sessionId === "string"
        ? (payload as { sessionId: string }).sessionId
        : undefined;
    if (sessionId === undefined) return false;
    onResumeSession(sessionId);
    return true;
  }, [onResumeSession]);
  // 会话列表刷新信号:面板自身只在 scope/数据源变化时加载,感知不到「加载之后」的服务端变更
  // (新会话镜像落库、auto_title 自动标题持久化都发生在 agent_end 时)。故每轮 agent 运行结束
  // (PiChat onTurnEnd)bump 此计数 → 面板重拉当前 scope 首页,及时反映新会话与最新标题。
  const [sessionListRefreshKey, setSessionListRefreshKey] = React.useState(0);
  const onTurnEnd = React.useCallback((): void => {
    setSessionListRefreshKey((n) => n + 1);
  }, []);
  // 活跃态变化(spec session-meta-index, Req 8.1-8.3):忙态**双向**边沿 + 交互挂起边沿都重拉。
  // 补上 onTurnEnd 缺的那一半 —— 轮次**开始**时列表也要刷,否则转圈往往等到不忙了才出现。
  // 与 onTurnEnd 合流到同一个刷新信号(面板只认这一个 key)。
  const onActivityChange = React.useCallback((): void => {
    setSessionListRefreshKey((n) => n + 1);
  }, []);

  // agent source 选择器刷新:父级登录态变化 + 本会话 `/install` panel-refresh 合并为单一信号。
  const [localInstallRefreshKey, setLocalInstallRefreshKey] = React.useState(0);
  const agentSourcesRefreshKey =
    parentAgentSourcesRefreshKey + localInstallRefreshKey;
  const onCommandResult = React.useCallback(
    (_name: string, outcome: CommandOutcome): void => {
      if (outcome.ok && outcome.result?.effect === "panel-refresh") {
        setLocalInstallRefreshKey((n) => n + 1);
        onAgentSourcesRefresh?.();
      }
    },
    [onAgentSourcesRefresh],
  );

  // sidebar-launcher-rail:会话内悬浮源选择器对话框。导航区「新建聊天」调出;选中源即新建会话。
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // 收藏信号:会话内收藏变更(对话框星标/导航区取消)后 bump → 导航区锚点与对话框星标同步。
  const [favoritesSignal, setFavoritesSignal] = React.useState(0);
  const [dialogFavorites, setDialogFavorites] = React.useState<Set<string>>(
    () => new Set(),
  );
  // 对话框打开或收藏信号变化时拉取收藏,用于星标高亮。
  React.useEffect(() => {
    if (!launcherRailEnabled() || !pickerOpen) return;
    let live = true;
    void piClient
      .listFavorites()
      .then((res) => {
        if (live) setDialogFavorites(new Set(res.favorites.map((f) => f.source)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [piClient, pickerOpen, favoritesSignal]);
  const onDialogToggleFavorite = React.useCallback(
    (item: AgentSourceItem): void => {
      void piClient
        .listFavorites()
        .then((res) => {
          const exists = res.favorites.some((f) => f.source === item.source);
          const next = exists
            ? res.favorites.filter((f) => f.source !== item.source)
            : [
                ...res.favorites,
                {
                  source: item.source,
                  name: item.name,
                  ...(item.title !== undefined ? { title: item.title } : {}),
                  ...(item.avatar !== undefined ? { avatar: item.avatar } : {}),
                },
              ];
          return piClient.setFavorites({ favorites: next });
        })
        .then((res) => {
          setDialogFavorites(new Set(res.favorites.map((f) => f.source)));
          setFavoritesSignal((n) => n + 1); // 同步导航区锚点
        })
        .catch(() => {});
    },
    [piClient],
  );

  // 会话项管理(session-list-item-actions):收藏集合(按 sessionId)+ 删除/重命名/收藏回调。
  // 收藏是宿主权威的用户偏好,经 listSessionFavorites 拉取;写操作后 bump sessionListRefreshKey
  // 使列表重拉权威态(与 auto_title/新会话同一刷新通道)。删当前会话则导航至新会话空态。
  const [sessionFavoriteIds, setSessionFavoriteIds] = React.useState<
    readonly string[]
  >([]);
  React.useEffect(() => {
    // 收藏**读**不受写门控(Req 4.9):即便写操作禁用(只读部署),已持久化的收藏仍拉取用于置顶展示。
    let live = true;
    void piClient
      .listSessionFavorites()
      .then((res) => {
        if (live) setSessionFavoriteIds(res.sessionIds);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // 收藏在写操作后经 setSessionFavoriteIds 就地更新;列表刷新时一并重拉以纠偏。
  }, [piClient, sessionListRefreshKey]);

  // 当前 agent 展示名:拉 /agent-sources 命中项的 title ?? name(与选择器同源),路径末段落底。
  const [currentSourceMeta, setCurrentSourceMeta] =
    React.useState<AgentSourceItem | null>(null);
  React.useEffect(() => {
    const source = create.source;
    if (source.length === 0 || source === ".") {
      setCurrentSourceMeta(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        let cursor: string | undefined;
        for (let page = 0; page < 8; page++) {
          const res = await piClient.listAgentSources({
            limit: 100,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          if (!live) return;
          const hit = res.sources.find(
            (item) =>
              sameAgentSource(item.source, source) ||
              sameAgentSource(item.id, source),
          );
          if (hit !== undefined) {
            setCurrentSourceMeta(hit);
            return;
          }
          if (res.nextCursor === undefined || res.nextCursor.length === 0) break;
          cursor = res.nextCursor;
        }
        if (live) setCurrentSourceMeta(null);
      } catch {
        if (live) setCurrentSourceMeta(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [piClient, create.source, agentSourcesRefreshKey]);

  const onDeleteSession = React.useCallback(
    async (id: string): Promise<void> => {
      await piClient.deleteSessionHistory(id);
      if (id === session.sessionId) {
        // 删的是当前会话 → 导航至新会话空态(不破坏其它进行中的会话)。
        if (typeof window !== "undefined") window.location.assign("/");
        return;
      }
      setSessionListRefreshKey((n) => n + 1); // 拉权威态
    },
    [piClient, session.sessionId],
  );

  const onRenameSession = React.useCallback(
    async (id: string, name: string): Promise<void> => {
      await piClient.renameSession(id, name);
      setSessionListRefreshKey((n) => n + 1);
    },
    [piClient],
  );

  const onToggleSessionFavorite = React.useCallback(
    async (id: string, favorite: boolean): Promise<void> => {
      const current = await piClient.listSessionFavorites();
      const next = favorite
        ? [...current.sessionIds.filter((x) => x !== id), id]
        : current.sessionIds.filter((x) => x !== id);
      const res = await piClient.setSessionFavorites({ sessionIds: next });
      setSessionFavoriteIds(res.sessionIds);
    },
    [piClient],
  );

  const sessionListSlot = React.useMemo<PiChatSlots>(() => {
    const panel = (
      <SessionListPanel
        {...(session.sessionId !== undefined
          ? { currentSessionId: session.sessionId }
          : {})}
        listSessions={piClient.listSessions}
        onResume={onResumeSession}
        refreshSignal={sessionListRefreshKey}
        manageEnabled={sessionsManageEnabled()}
        // 来源展示(spec session-meta-index, Req 6.2/6.3):开启后列表项显示来源标识与来源色条。
        // ★ 此前 `showSource` 门控存在但宿主从未传过 —— 于是 SessionListItem.source 即便有值
        //   也永远看不见(浏览器 e2e 抓到的接线缺口,单测因显式传 prop 而看不出来)。
        showSource
        favoriteSessionIds={sessionFavoriteIds}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
        onToggleFavorite={onToggleSessionFavorite}
        {...(resumeId === undefined && session.sessionId !== undefined
          ? { pendingSession: { sessionId: session.sessionId } }
          : {})}
      />
    );
    const agentName = displayAgentLabel(currentSourceMeta, create.source);
    const agentSource = create.source === "." ? create.cwd : create.source;
    // ui-redesign §5.2 / prototype `.proto-current-agent`:
    // 名 15/600、路径 11 mono、图标 16 + 命中 32、控件半径 7、块间呼吸 gap。
    const iconBtnClass =
      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";
    const currentAgent = (
      <div
        data-sidebar-agent-header
        className="flex shrink-0 items-center gap-2"
      >
        <button
          type="button"
          data-current-agent
          data-switch-source
          onClick={() => setPickerOpen(true)}
          aria-label={`切换 Agent · ${agentName}`}
          title={`${agentName} · ${agentSource}`}
          className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 text-left transition-colors hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground))]">
            <SwitchAgentIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="truncate text-[15px] font-semibold leading-snug tracking-[-0.02em] text-[hsl(var(--foreground))] group-hover:underline group-hover:underline-offset-[3px]">
              {agentName}
            </strong>
            <span className="truncate font-mono text-[11px] leading-tight text-[hsl(var(--muted-foreground))]">
              {agentSource}
            </span>
          </span>
        </button>
        <button
          type="button"
          data-sidebar-collapse
          onClick={toggleSidebar}
          aria-label={t("chatApp.collapseSidebar")}
          title={t("chatApp.collapseSidebar")}
          className={iconBtnClass}
        >
          <PanelArrowIcon direction="left" />
        </button>
      </div>
    );
    // 底部账户:ChatGPT 式 头像+全名+设置;主题/语言/登出进弹层。
    const accountBar = <AccountBar />;
    // 启动导航区(sidebar-launcher-rail):固定置于会话列表之上,列表在其下独立滚动。
    // webext 槽:仅当扩展为 launcherRail 贡献时才注入节点(否则不占位,Req 5.2);
    // SlotHost 自带 error boundary 隔离(Req 5.4)。
    const launcherContribution = resolveSlot(extension, "launcherRail");
    const sessionNavigation = (
      <LauncherRail
        onNewChat={onNewByAgentSource}
        onResume={onResumeSession}
        onLaunchSource={onLaunchSource}
        listSessions={piClient.listSessions}
        listFavorites={piClient.listFavorites}
        setFavorites={piClient.setFavorites}
        showFavorites={false}
        className="gap-0.5"
      />
    );
    // 门控开启,或 source 声明了 launcherRail 贡献(如 Canvas)时渲染 LauncherRail——
    // source 声明即意图,免全局门控(保 agent-source 自治;宿主仍中立,不认领域语义)。
    if (sidebarCollapsed)
      return sessionListSlots(
        <div
          data-sidebar-collapsed-rail
          title={t("chatApp.expandSidebar")}
          className="flex h-full w-14 cursor-ew-resize flex-col items-center overflow-visible border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] px-2 py-5"
          onClick={(e) => {
            // 仅空白区展开;icon/按钮/浮层内点击不触发展开。
            const el = e.target as HTMLElement;
            if (
              el.closest(
                "button, a, input, textarea, select, [role='button'], [data-launcher-search-panel], [data-account-menu]",
              )
            ) {
              return;
            }
            toggleSidebar();
          }}
        >
          <button
            type="button"
            data-sidebar-expand
            onClick={toggleSidebar}
            aria-label={t("chatApp.expandSidebar")}
            title={t("chatApp.expandSidebar")}
            className="mt-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius)] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))]"
          >
            <PanelArrowIcon direction="right" />
          </button>
          <button
            type="button"
            data-switch-source
            onClick={() => setPickerOpen(true)}
            aria-label={agentName}
            title={`${agentName} · ${agentSource}`}
            className="mt-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))]"
          >
            <SwitchAgentIcon />
          </button>
          <LauncherRail
            compact
            onNewChat={() => setPickerOpen(true)}
            onResume={onResumeSession}
            onLaunchSource={onLaunchSource}
            listSessions={piClient.listSessions}
            listFavorites={piClient.listFavorites}
            setFavorites={piClient.setFavorites}
            favoritesRefreshSignal={favoritesSignal}
            {...(launcherContribution !== undefined
              ? { webextSlot: <SlotHost ext={extension} slot="launcherRail" /> }
              : {})}
            className="mt-3 cursor-pointer"
          />
          {/* 中部空白:可点展开 + 双向箭头光标 */}
          <div
            data-sidebar-expand-hit
            className="min-h-4 w-full flex-1 cursor-ew-resize"
            aria-hidden
          />
          <div className="mt-auto flex flex-col items-center gap-1 border-t border-[hsl(var(--border))] pt-3">
            <a
              href="/settings"
              data-settings-link
              aria-label={t("chatApp.settings")}
              title={t("chatApp.settings")}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))]"
            >
              <SettingsIcon />
            </a>
            <span className="cursor-pointer">
              <LocaleToggleButton />
            </span>
            <span className="cursor-pointer">
              <ThemeToggleButton />
            </span>
          </div>
        </div>,
      );
    // 侧栏内边距统一 pl-1.5/pr-0,与 Agent 头 / Launcher 行内 px-1.5 叠成同一左缘。
    const sidebarShellClass =
      "flex h-full w-[240px] flex-col gap-2 overflow-hidden border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] py-2 px-1";
    if (!launcherRailEnabled() && launcherContribution === undefined)
      return sessionListSlots(
        <div className={sidebarShellClass}>
          {currentAgent}
          {sessionNavigation}
          <div className="h-px shrink-0 bg-[hsl(var(--border))]" />
          <div className="pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {panel}
          </div>
          {accountBar}
        </div>,
      );
    return sessionListSlots(
      <div className={sidebarShellClass}>
        {currentAgent}
        <LauncherRail
          onNewChat={() => setPickerOpen(true)}
          onResume={onResumeSession}
          onLaunchSource={onLaunchSource}
          listSessions={piClient.listSessions}
          listFavorites={piClient.listFavorites}
          setFavorites={piClient.setFavorites}
          favoritesRefreshSignal={favoritesSignal}
          {...(launcherContribution !== undefined
            ? { webextSlot: <SlotHost ext={extension} slot="launcherRail" /> }
            : {})}
          className="gap-0.5"
        />
        <div className="h-px shrink-0 bg-[hsl(var(--border))]" />
        <div className="pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {panel}
        </div>
        {accountBar}
      </div>,
    );
  }, [
    session.sessionId,
    resumeId,
    create.source,
    create.cwd,
    piClient,
    onResumeSession,
    sessionListRefreshKey,
    favoritesSignal,
    onLaunchSource,
    extension,
    sessionFavoriteIds,
    currentSourceMeta,
    onDeleteSession,
    onRenameSession,
    onToggleSessionFavorite,
    onNewByAgentSource,
    onReset,
    t,
    sidebarCollapsed,
    toggleSidebar,
  ]);

  // Tier5 声明式 documentTitle:agent source 载入后把浏览器标签页标题同步为扩展声明值;
  // 未显式声明则回落到由 source 派生的名字(deriveSourceTitle)。cleanup 还原为载入前标题
  // —— 故回选源页(SessionView 卸载)或切换 source 时自动复位。Next.js 静态 metadata 只在
  // 服务端,运行时标题须由客户端 effect 接管。
  React.useEffect(() => {
    const declared = extension?.config?.documentTitle;
    const title =
      declared !== undefined && declared.length > 0
        ? declared
        : deriveSourceTitle(create.source);
    if (title === undefined) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [extension, create.source]);

  // Session creation failed → recognizable error + re-pick (Req 4.5).
  if (session.error !== undefined && session.status === "closed") {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-4 p-6"
        data-session-error
      >
        <p
          role="alert"
          className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
        >
          Failed to create session: {session.error.message}
        </p>
        <button
          type="button"
          onClick={onReset}
          data-session-retry
          className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium"
        >
          Pick another source
        </button>
      </div>
    );
  }

  // Creating / connecting → progress indicator (Req 4.4).
  if (session.transport === undefined) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-6 text-sm text-[hsl(var(--muted-foreground))]"
        data-session-connecting
      >
        Connecting to session…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" data-session-active>
      {/* 无 head 设计:撤除顶部导航栏,全局控件下沉到侧栏底部账户区。会话 id 以 sr-only
          保留在 DOM 供 e2e 读取(data-session-id),不再有可见头栏。 */}
      <span className="sr-only" data-session-id>
        session: {session.sessionId}
      </span>
      <div
        className="relative min-h-0 flex-1"
        {...(extension?.config?.theme !== undefined
          ? {
              "data-pi-ext-theme": "",
              // 声明式 theme token 注入会话根(命名空间隔离,不污染宿主全局)。
              style: extension.config.theme as React.CSSProperties,
            }
          : {})}
      >
        {hasSidePanel && !sidePanelOpen ? (
          <button
            type="button"
            data-panel-right-toggle
            onClick={openPanelRight}
            aria-expanded={false}
            aria-label={t("chatApp.showPaneSidebar")}
            title={t("chatApp.showPaneSidebar")}
            // ui-redesign §5.2/5.6:收起态仅 32 方钮 + surface，与 proto-pane-launcher 对齐。
            className="absolute right-4 top-4 z-30 inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground))] shadow-sm transition-colors hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <PanelToggleIcon />
          </button>
        ) : null}
        {/* Tier5 空态声明式配置(config.empty)→ PiChat props,与上方 theme/layout 同构。
            优先级契约在 PiChat 边界:PiChat 不读 extension.config,只认显式 props,故显式 props
            天然胜出;本宿主若未来叠加自身显式空态 props,须置于这些条件展开之后以让宿主值胜出。 */}
        <PiChat
          session={session}
          controls={controls}
          extensionUI={extensionUI}
          resources={{ agentId: create.source, endpoint: "/api" }}
          gateUntilReady={gateUntilReady()}
          components={PI_CHAT_COMPONENTS}
          extensionCommands={extensionCommandPolicy()}
          builtinCommands={builtinCommands}
          builtinResultDataParts={builtinResultDataParts}
          onCommandResult={onCommandResult}
          // 装/卸插件命令(/plugin、/reload-runtime)提交后 bump nonce → 重解析 webext
          // (装后即时双路生效之路②;spec plugin-system-unification Req 7)。
          onRuntimeReloadRequested={() => setWebextReloadNonce(Date.now())}
          onPaneEvent={onPaneEvent}
          attachmentBaseUrl="/api"
          slots={sessionListSlot}
          onTurnEnd={onTurnEnd}
          onActivityChange={onActivityChange}
          showLogs={true}
          enableBash={bashEnabled()}
          logsPanelVisible={logsPanelVisible ?? true}
          logsPanelPosition={logsPanelPosition ?? "bottom"}
          loggingEnabled={loggingEnabled}
          {...(extension !== undefined ? { extension } : {})}
          {...(hostPaneSource !== undefined ? { hostPaneSource } : {})}
          paneSignals={paneSignals}
          {...(narrowLayoutPreset(extension?.config?.layout) !== undefined
            ? { layout: narrowLayoutPreset(extension?.config?.layout) }
            : {})}
          {...(hasSidePanel
            ? {
                panelRatio: effectivePanelRatio,
                onPanelClose: closePanelRight,
                onPanelOpen: openPanelRight,
              }
            : {})}
          {...(panelWidth !== undefined
            ? {
                panelWidth,
                onPanelWidthChange: changePanelWidth,
                ...(extension?.config?.minPanelWidth !== undefined
                  ? { minPanelWidth: extension.config.minPanelWidth }
                  : {}),
              }
            : {})}
          {...(extension?.config?.empty?.title !== undefined
            ? { emptyTitle: extension.config.empty.title }
            : {})}
          {...(extension?.config?.empty?.subtitle !== undefined
            ? { emptySubtitle: extension.config.empty.subtitle }
            : {})}
          {...(extension?.config?.empty?.starters !== undefined
            ? { suggestionsPresets: extension.config.empty.starters }
            : {})}
          {...(extension?.config?.empty?.mergeCommands !== undefined
            ? { suggestionsMerge: extension.config.empty.mergeCommands }
            : {})}
          {...(extensionBaseUrl().length > 0
            ? { extensionBaseUrl: extensionBaseUrl() }
            : {})}
        />
      </div>
      {/* sidebar-launcher-rail:会话内悬浮源选择器对话框。导航区「新建聊天」调出;选中源→新建会话。 */}
      {pickerOpen ? (
        <AgentSourcePicker
          variant="dialog"
          onClose={() => setPickerOpen(false)}
          onSubmit={(source) => {
            setPickerOpen(false);
            onLaunchSource(source);
          }}
          defaultSource={create.source}
          enableSourceList={sourcePickerEnabled()}
          listAgentSources={piClient.listAgentSources}
          refreshSignal={agentSourcesRefreshKey}
          favoriteSources={dialogFavorites}
          onToggleFavorite={onDialogToggleFavorite}
          {...(desktopPickDirectory !== undefined
            ? { onBrowseDirectory: desktopPickDirectory }
            : {})}
        />
      ) : null}
    </div>
  );
}

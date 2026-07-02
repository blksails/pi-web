"use client";

import * as React from "react";
import {
  PiProvider,
  usePiSession,
  usePiControls,
  useExtensionUI,
  createPiClient,
  type UsePiSessionResult,
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
} from "@blksails/pi-web-ui";
import type {
  CreateSessionRequest,
  AgentSourceItem,
} from "@blksails/pi-web-protocol";
import { BUILTIN_COMMANDS } from "@blksails/pi-web-tool-kit/commands";
import { toRpcSlashCommand } from "@/lib/app/plugin-command/to-rpc-command.js";
import { AgentSourcePicker } from "./agent-source-picker.js";
import { ThemeToggleButton, LocaleToggleButton } from "@/app/theme-controls.js";
import { resolveExtensionForSource } from "@/lib/app/webext-registry.js";
import { useRuntimeWebext } from "@/lib/app/webext-load-client.js";
import { ChatReasoning } from "./chat-reasoning.js";
import { LoggingConfigLoader } from "./logging-config-loader.js";

type LogsPanelConfig = {
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
            outputs?: {
              panelVisible?: boolean;
              panelPosition?: "bottom" | "right" | "drawer" | "top";
            };
          };
        };
        const outputs = json.values?.outputs;
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
          return { panelVisible, panelPosition };
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
 * 扩展(source==="extension")命令在命令补全里的可见策略。
 *
 * 默认隐藏所有扩展命令:它们在 web 端会让该轮永久卡 pending(扩展命令本地执行后提前
 * 返回、不发 agent_end,详见 PiCommandPalette 文件头)。可经环境变量覆盖(client 端
 * 读取 NEXT_PUBLIC_*,构建时内联):
 *   NEXT_PUBLIC_PI_EXTENSION_COMMANDS=all        → 放行所有扩展命令(谨慎,可能卡死)
 *   NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST=foo,bar   → 仅按名放行(逗号分隔),其余仍隐藏
 *
 * 模块级常量:引用稳定,避免每次渲染产生新对象使下游 useMemo 失效。
 */
const EXTENSION_COMMAND_POLICY: ExtensionCommandPolicy = {
  enabled: process.env.NEXT_PUBLIC_PI_EXTENSION_COMMANDS === "all",
  allowlist: [
    // 平台内置「扩展管理扩展」命令默认放行(spec extension-install-agent-tools):
    // /plugin 经斜杠补全直接装/卸/列扩展;它们在 web 端不卡 pending —— PiChat onSubmit
    // 识别 source==="extension" 命令后经 client.prompt fire-and-forget 执行(不进 useChat)。
    "plugin",
    "reload-runtime",
    ...(process.env.NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  ],
};

/**
 * 会话列表(sessions-list)宿主配置(client 端读 NEXT_PUBLIC_*,构建期内联):
 *   NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=true|1  → 显示「全部」(系统/全机器)Tab(默认关闭)
 *   NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT=sidebar|header|footer|empty → 展示位置(默认 sidebar)
 * 与后端门控同名(NEXT_PUBLIC_ 变量两端可读),两端对系统视图是否启用保持一致。
 * 模块级常量:引用稳定,避免每渲染新对象。
 */
const SESSIONS_GLOBAL_ENABLED =
  process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "true" ||
  process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "1";

// session-list-item-actions:会话项管理写操作(删除/重命名/收藏)是否启用。默认启用;
// =false/=0 时隐藏写入口(与后端同名 NEXT_PUBLIC_ 门控两端一致:服务端亦拒绝写请求)。
const SESSIONS_MANAGE_ENABLED =
  process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "false" &&
  process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "0";

// agent-sources-list:是否在源选择器中展示"可浏览的源列表"。构建期内联,前端门控;
// 后端未配来源时端点返回空列表,两端一致表现为"无列表可浏览"(Req 6.4)。
const SOURCE_PICKER_ENABLED =
  process.env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER === "true" ||
  process.env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER === "1";

// sidebar-launcher-rail:是否在侧栏会话列表之上渲染启动导航区(搜索/新建/收藏锚点/webext槽)。
// 构建期内联,前端门控;未启用时侧栏退化为仅会话列表(Req 1.4/6.1)。
const LAUNCHER_RAIL_ENABLED =
  process.env.NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL === "true" ||
  process.env.NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL === "1";

/** 允许的宿主插槽子集(PiChatSlots 中可承载块级面板的 key)。 */
type SessionsSlotKey = "sidebar" | "header" | "footer" | "empty";
const ALLOWED_SESSIONS_SLOTS: readonly SessionsSlotKey[] = [
  "sidebar",
  "header",
  "footer",
  "empty",
];
const SESSIONS_SLOT: SessionsSlotKey = ((): SessionsSlotKey => {
  const v = process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT;
  return v !== undefined && (ALLOWED_SESSIONS_SLOTS as readonly string[]).includes(v)
    ? (v as SessionsSlotKey)
    : "sidebar";
})();

/** 把会话列表面板放入选定的宿主插槽(类型安全;默认 sidebar)。 */
function sessionListSlots(node: React.ReactNode): PiChatSlots {
  switch (SESSIONS_SLOT) {
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

export function ChatApp(props: ChatAppProps): React.JSX.Element {
  // Logging panel config (Req 6.6 + 6.1/6.2): defaults until config loads.
  const logsPanelConfig = useLogsPanelConfig();

  // agent-sources-list:源选择器的只读列表数据源(注入 PiClient.listAgentSources)。
  // 与 SessionListPanel 同构的注入式接线——组件不持接线,便于测试。
  const pickerClient = React.useMemo(() => createPiClient("/api"), []);

  // sidebar-launcher-rail:收藏集合(供选择器星标高亮 + 切换)。选择器(session===undefined)
  // 与侧栏导航区(SessionView 内)是互斥视图,故此处仅服务选择器的星标态;导航区锚点由
  // LauncherRail 自身经 listFavorites 拉取。
  const [favoriteSources, setFavoriteSources] = React.useState<Set<string>>(
    () => new Set(),
  );
  // 返回选择器时 bump(onReset)→ 重拉收藏,反映在会话内(LauncherRail)对收藏的增删,
  // 避免选择器星标态陈旧(reviewer 反馈)。
  const [favoritesReloadKey, setFavoritesReloadKey] = React.useState(0);
  React.useEffect(() => {
    if (!LAUNCHER_RAIL_ENABLED) return;
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

  const onSubmit = (source: string): void => {
    const resolved = source.length > 0 ? source : (props.defaultSource ?? ".");
    // New session: no resumeId. bump nonce 强制 SessionView 重挂 —— 使侧栏「新建聊天」
    // 即便选中当前同一 source 也得到全新会话(usePiSession 不响应 create 变化重建,须靠
    // key 重挂)。原顶栏「新建会话」按钮已移除,同源新建统一由「新建聊天」承担。
    setSession({ create: buildCreate(props, resolved) });
    setNonce((n) => n + 1);
  };

  const onReset = (): void => {
    setSession(undefined);
    // 返回选择器:重拉收藏,反映会话内导航区对收藏的增删(避免星标态陈旧)。
    setFavoritesReloadKey((n) => n + 1);
    // Drop back to the picker URL so a refresh does not re-resume.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  };

  // 同源新建:保持当前 agent source、丢弃 resumeId,bump nonce 变更 SessionView 的 key 强制
  // 重挂,得到同一 source 的全新会话。仅 rail 关闭态账户区仍提供此入口(rail 开启时由
  // 侧栏「新建聊天」承担,见 SessionView 账户区)。
  const onNewByAgentSource = (): void => {
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
          enableSourceList={SOURCE_PICKER_ENABLED}
          listAgentSources={pickerClient.listAgentSources}
          {...(LAUNCHER_RAIL_ENABLED
            ? { favoriteSources, onToggleFavorite }
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
          logsPanelVisible={logsPanelConfig.panelVisible}
          logsPanelPosition={logsPanelConfig.panelPosition}
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
  logsPanelVisible,
  logsPanelPosition,
}: {
  readonly create: CreateSessionRequest;
  readonly resumeId?: string;
  readonly onReset: () => void;
  /** 同源新建(仅 rail 关闭态账户区使用;rail 开启时由侧栏「新建聊天」承担)。 */
  readonly onNewByAgentSource: () => void;
  /** sidebar-launcher-rail:以某 source 新建会话(收藏锚点点击)。 */
  readonly onLaunchSource: (source: string) => void;
  /** Controls LogsPanel visibility per logging config (Req 6.6). */
  readonly logsPanelVisible?: boolean;
  /** Controls LogsPanel position per logging config (Req 6.1/6.2). Default "bottom". */
  readonly logsPanelPosition?: "bottom" | "right" | "drawer" | "top";
}): React.JSX.Element {
  const t = useI18n();
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
      window.history.replaceState(null, "", `/session/${id}`);
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

  // 内置斜杠命令(builtin-plugin-command):前置合流到命令面板;选中走 harness 分派(不进 LLM)。
  const builtinCommands = React.useMemo(
    () => BUILTIN_COMMANDS.map(toRpcSlashCommand),
    [],
  );
  // 扩展安装已迁出为 agent 内置工具(spec extension-install-agent-tools),信息/进度走 ctx.ui
  // (StatusBar/通知),不再有 plugin 模态面板与 host 命令结果回流。

  // 会话列表(sessions-list):宿主级 REST client + 列表面板,经选定宿主插槽注入 <PiChat>。
  // 列表数据经 client.listSessions 注入(面板不持 pi 接线);恢复复用 /session/:id 成熟链路
  // (冷恢复 + 历史回放 + source 反查),失败时由该路由的 SessionView 错误态提示。
  const piClient = React.useMemo(() => createPiClient("/api"), []);
  const onResumeSession = React.useCallback((id: string): void => {
    if (typeof window !== "undefined") {
      window.location.assign(`/session/${id}`);
    }
  }, []);
  // 会话列表刷新信号:面板自身只在 scope/数据源变化时加载,感知不到「加载之后」的服务端变更
  // (新会话镜像落库、auto_title 自动标题持久化都发生在 agent_end 时)。故每轮 agent 运行结束
  // (PiChat onTurnEnd)bump 此计数 → 面板重拉当前 scope 首页,及时反映新会话与最新标题。
  const [sessionListRefreshKey, setSessionListRefreshKey] = React.useState(0);
  const onTurnEnd = React.useCallback((): void => {
    setSessionListRefreshKey((n) => n + 1);
  }, []);

  // sidebar-launcher-rail:会话内悬浮源选择器对话框。导航区「新建聊天」调出;选中源即新建会话。
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // 收藏信号:会话内收藏变更(对话框星标/导航区取消)后 bump → 导航区锚点与对话框星标同步。
  const [favoritesSignal, setFavoritesSignal] = React.useState(0);
  const [dialogFavorites, setDialogFavorites] = React.useState<Set<string>>(
    () => new Set(),
  );
  // 对话框打开或收藏信号变化时拉取收藏,用于星标高亮。
  React.useEffect(() => {
    if (!LAUNCHER_RAIL_ENABLED || !pickerOpen) return;
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
        currentCwd={create.cwd ?? "."}
        globalEnabled={SESSIONS_GLOBAL_ENABLED}
        listSessions={piClient.listSessions}
        onResume={onResumeSession}
        refreshSignal={sessionListRefreshKey}
        manageEnabled={SESSIONS_MANAGE_ENABLED}
        favoriteSessionIds={sessionFavoriteIds}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
        onToggleFavorite={onToggleSessionFavorite}
        {...(resumeId === undefined && session.sessionId !== undefined
          ? { pendingSession: { sessionId: session.sessionId } }
          : {})}
      />
    );
    // 无 head 设计:原顶部导航栏(pi-web/session/新建会话/切换源/设置/语言/主题)整体撤除,
    // 全局控件下沉到侧栏底部「账户区」。恒渲染(不随 LAUNCHER_RAIL_ENABLED 门控),因主流 e2e
    // 跑在 rail 关闭态且依赖 data-settings-link / data-pi-theme-toggle 等。原「新建会话/切换源」
    // 已移除(冗余,统一由侧栏「新建聊天」承担);日志面板可见性由 /settings 的「显示日志面板」
    // 设置项(logging.outputs.panelVisible)控制,账户区不再放开关。
    const accountBtnClass =
      "inline-flex shrink-0 items-center justify-center rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]";
    const accountBar = (
      <div
        data-launcher-account
        className="flex shrink-0 flex-col gap-1 border-t border-[hsl(var(--border))] px-2 pb-2 pt-2"
      >
        {/* 新建会话/切换源:仅 rail 关闭态提供(rail 开启时冗余,由侧栏「新建聊天」承担)。 */}
        {!LAUNCHER_RAIL_ENABLED ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onNewByAgentSource}
              data-new-session
              className={`${accountBtnClass} flex-1`}
            >
              {t("chatApp.newSession")}
            </button>
            <button
              type="button"
              onClick={onReset}
              data-switch-source
              className={`${accountBtnClass} flex-1`}
            >
              {t("chatApp.switchSource")}
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <a href="/settings" data-settings-link className={accountBtnClass}>
            {t("chatApp.settings")}
          </a>
          <span className="ml-auto flex items-center gap-1">
            <LocaleToggleButton />
            <ThemeToggleButton />
          </span>
        </div>
      </div>
    );
    if (!LAUNCHER_RAIL_ENABLED)
      return sessionListSlots(
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">{panel}</div>
          {accountBar}
        </div>,
      );
    // 启动导航区(sidebar-launcher-rail):固定置于会话列表之上,列表在其下独立滚动。
    // webext 槽:仅当扩展为 launcherRail 贡献时才注入节点(否则不占位,Req 5.2);
    // SlotHost 自带 error boundary 隔离(Req 5.4)。
    const launcherContribution = resolveSlot(extension, "launcherRail");
    return sessionListSlots(
      <div className="flex h-full w-64 flex-col gap-0.5 overflow-x-hidden border-r border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-1.5">
        <LauncherRail
          onNewChat={() => setPickerOpen(true)}
          onResume={onResumeSession}
          onLaunchSource={onLaunchSource}
          listSessions={piClient.listSessions}
          currentCwd={create.cwd ?? "."}
          listFavorites={piClient.listFavorites}
          setFavorites={piClient.setFavorites}
          favoritesRefreshSignal={favoritesSignal}
          {...(launcherContribution !== undefined
            ? { webextSlot: <SlotHost ext={extension} slot="launcherRail" /> }
            : {})}
        />
        <div className="mx-1 my-1.5 h-px shrink-0 bg-[hsl(var(--border))]" />
        <div className="pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {panel}
        </div>
        {accountBar}
      </div>,
    );
  }, [
    session.sessionId,
    resumeId,
    create.cwd,
    piClient,
    onResumeSession,
    sessionListRefreshKey,
    favoritesSignal,
    onLaunchSource,
    extension,
    sessionFavoriteIds,
    onDeleteSession,
    onRenameSession,
    onToggleSessionFavorite,
    onNewByAgentSource,
    onReset,
    t,
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
        className="min-h-0 flex-1"
        {...(extension?.config?.theme !== undefined
          ? {
              "data-pi-ext-theme": "",
              // 声明式 theme token 注入会话根(命名空间隔离,不污染宿主全局)。
              style: extension.config.theme as React.CSSProperties,
            }
          : {})}
      >
        {/* Tier5 空态声明式配置(config.empty)→ PiChat props,与上方 theme/layout 同构。
            优先级契约在 PiChat 边界:PiChat 不读 extension.config,只认显式 props,故显式 props
            天然胜出;本宿主若未来叠加自身显式空态 props,须置于这些条件展开之后以让宿主值胜出。 */}
        <PiChat
          session={session}
          controls={controls}
          extensionUI={extensionUI}
          // 就绪握手(spec session-readiness-handshake):默认开启门控,与服务端 readinessHandshake 一致;
          // 经公开 env 关闭(须与服务端 PI_WEB_DISABLE_READINESS_HANDSHAKE 同步)。
          gateUntilReady={
            process.env.NEXT_PUBLIC_PI_WEB_DISABLE_READINESS_HANDSHAKE !== "1"
          }
          components={PI_CHAT_COMPONENTS}
          extensionCommands={EXTENSION_COMMAND_POLICY}
          builtinCommands={builtinCommands}
          // 装/卸插件命令(/plugin、/reload-runtime)提交后 bump nonce → 重解析 webext
          // (装后即时双路生效之路②;spec plugin-system-unification Req 7)。
          onRuntimeReloadRequested={() => setWebextReloadNonce((n) => n + 1)}
          attachmentBaseUrl="/api"
          slots={sessionListSlot}
          onTurnEnd={onTurnEnd}
          showLogs={true}
          // bang shell 命令前端体验开关(spec bang-shell-command,Req 5.5/5.6/5.7)。
          // 仅经构建期内联的 NEXT_PUBLIC_ 变量提供(非用户可写 Settings);服务端权威门控独立。
          enableBash={
            process.env.NEXT_PUBLIC_PI_WEB_BASH_ENABLED === "1" ||
            process.env.NEXT_PUBLIC_PI_WEB_BASH_ENABLED === "true"
          }
          logsPanelVisible={logsPanelVisible ?? true}
          logsPanelPosition={logsPanelPosition ?? "bottom"}
          {...(extension !== undefined ? { extension } : {})}
          {...(narrowLayoutPreset(extension?.config?.layout) !== undefined
            ? { layout: narrowLayoutPreset(extension?.config?.layout) }
            : {})}
          {...(extension?.config?.panelRatio !== undefined
            ? { panelRatio: extension.config.panelRatio }
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
          {...(process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL !== undefined
            ? { extensionBaseUrl: process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL }
            : {})}
        />
      </div>
      {/* sidebar-launcher-rail:会话内悬浮源选择器对话框。导航区「新建聊天」调出;选中源→新建会话。 */}
      {LAUNCHER_RAIL_ENABLED && pickerOpen ? (
        <AgentSourcePicker
          variant="dialog"
          onClose={() => setPickerOpen(false)}
          onSubmit={(source) => {
            setPickerOpen(false);
            onLaunchSource(source);
          }}
          defaultSource={create.source}
          enableSourceList={SOURCE_PICKER_ENABLED}
          listAgentSources={piClient.listAgentSources}
          favoriteSources={dialogFavorites}
          onToggleFavorite={onDialogToggleFavorite}
        />
      ) : null}
    </div>
  );
}

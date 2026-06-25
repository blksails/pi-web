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
  type ExtensionCommandPolicy,
  type ComponentOverrides,
  type PiChatSlots,
} from "@blksails/pi-web-ui";
import type {
  CreateSessionRequest,
  RpcSlashCommand,
} from "@blksails/pi-web-protocol";
import { BUILTIN_COMMANDS } from "@blksails/pi-web-tool-kit/commands";
import { toRpcSlashCommand } from "@/lib/app/plugin-command/to-rpc-command.js";
import { PluginPanel } from "@/components/plugin-panel.js";
import { AgentSourcePicker } from "./agent-source-picker.js";
import { ThemeToggleButton } from "@/app/theme-controls.js";
import { resolveExtensionForSource } from "@/lib/app/webext-registry.js";
import { useRuntimeWebext } from "@/lib/app/webext-load-client.js";
import { ChatReasoning } from "./chat-reasoning.js";
import { LoggingConfigLoader } from "./logging-config-loader.js";

type LogsPanelConfig = {
  readonly panelVisible: boolean;
  readonly panelPosition: "bottom" | "right" | "drawer";
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
              panelPosition?: "bottom" | "right" | "drawer";
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
            outputs?.panelPosition === "drawer"
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
  allowlist: (process.env.NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
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
  // 同源新建计数:bump 后变更 SessionView 的 key 以强制重挂(见 onNewByAgentSource)。
  const [nonce, setNonce] = React.useState<number>(0);

  const onSubmit = (source: string): void => {
    const resolved = source.length > 0 ? source : (props.defaultSource ?? ".");
    // New session: no resumeId.
    setSession({ create: buildCreate(props, resolved) });
  };

  const onReset = (): void => {
    setSession(undefined);
    // Drop back to the picker URL so a refresh does not re-resume.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  };

  // 同源新建:保持当前 agent source、丢弃 resumeId(恢复模式下避免重挂为"再次恢复旧会话"),
  // 并 bump nonce 以变更 SessionView 的 key —— 强制 React 卸载+重挂,使 usePiSession 以
  // 新实例(startedRef 复位)用同一 source 重新 createSession,得到全新会话。
  // (usePiSession 不响应 create 变化重建,故必须靠 key 重挂;见 spec design。)
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
  logsPanelVisible,
  logsPanelPosition,
}: {
  readonly create: CreateSessionRequest;
  readonly resumeId?: string;
  readonly onReset: () => void;
  readonly onNewByAgentSource: () => void;
  /** Controls LogsPanel visibility per logging config (Req 6.6). */
  readonly logsPanelVisible?: boolean;
  /** Controls LogsPanel position per logging config (Req 6.1/6.2). Default "bottom". */
  readonly logsPanelPosition?: "bottom" | "right" | "drawer";
}): React.JSX.Element {
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
  const runtimeWebext = useRuntimeWebext(
    create.source,
    buildTimeExtension !== undefined,
  );
  const extension = buildTimeExtension ?? runtimeWebext.extension;

  // 内置斜杠命令(builtin-plugin-command):前置合流到命令面板;选中走 harness 分派(不进 LLM)。
  const builtinCommands = React.useMemo(
    () => BUILTIN_COMMANDS.map(toRpcSlashCommand),
    [],
  );
  const pluginClient = React.useMemo(() => createPiClient("/api"), []);
  const [pluginPanelOpen, setPluginPanelOpen] = React.useState(false);
  const onBuiltinSelect = React.useCallback(
    (cmd: RpcSlashCommand): void => {
      // /plugin:打开管理面板(安装/卸载在面板内完成)。
      if (cmd.name === "plugin") setPluginPanelOpen(true);
    },
    [],
  );

  // 会话列表(sessions-list):宿主级 REST client + 列表面板,经选定宿主插槽注入 <PiChat>。
  // 列表数据经 client.listSessions 注入(面板不持 pi 接线);恢复复用 /session/:id 成熟链路
  // (冷恢复 + 历史回放 + source 反查),失败时由该路由的 SessionView 错误态提示。
  const piClient = React.useMemo(() => createPiClient("/api"), []);
  const onResumeSession = React.useCallback((id: string): void => {
    if (typeof window !== "undefined") {
      window.location.assign(`/session/${id}`);
    }
  }, []);
  const sessionListSlot = React.useMemo<PiChatSlots>(
    () =>
      sessionListSlots(
        <SessionListPanel
          {...(session.sessionId !== undefined
            ? { currentSessionId: session.sessionId }
            : {})}
          currentCwd={create.cwd ?? "."}
          globalEnabled={SESSIONS_GLOBAL_ENABLED}
          listSessions={piClient.listSessions}
          onResume={onResumeSession}
        />,
      ),
    [session.sessionId, create.cwd, piClient, onResumeSession],
  );

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
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-2 sm:gap-3 sm:px-4">
        <span className="shrink-0 text-sm font-medium">pi-web</span>
        <span
          className="hidden truncate text-xs text-[hsl(var(--muted-foreground))] sm:inline"
          data-session-id
        >
          session: {session.sessionId}
        </span>
        <button
          type="button"
          onClick={onNewByAgentSource}
          className="ml-auto shrink-0 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs sm:px-3"
          data-new-session
        >
          New session
        </button>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs sm:px-3"
          data-switch-source
        >
          切换源
        </button>
        <a
          href="/settings"
          className="shrink-0 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs sm:px-3"
          data-settings-link
        >
          设置
        </a>
        <ThemeToggleButton />
      </div>
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
          components={PI_CHAT_COMPONENTS}
          extensionCommands={EXTENSION_COMMAND_POLICY}
          builtinCommands={builtinCommands}
          onBuiltinSelect={onBuiltinSelect}
          attachmentBaseUrl="/api"
          slots={sessionListSlot}
          showLogs={true}
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
        {pluginPanelOpen ? (
          <PluginPanel
            client={pluginClient}
            sessionId={session.sessionId}
            onClose={() => setPluginPanelOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

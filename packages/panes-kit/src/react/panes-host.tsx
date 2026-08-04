import * as React from "react";
import {
  Box,
  Command,
  FileStack,
  GitCompare,
  Images,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  PaneGuestRequestSchema,
  PANE_PROTOCOL_VERSION,
  UNLIMITED_PANE_COUNT,
  type PaneCapabilities,
  type PaneDefinition,
  type PaneGuestRequest,
  type PaneHostMessage,
  type PaneInstance,
  type PaneTheme,
  type PanesDefinition,
} from "../contract.js";
import { authorizePaneRequest, DEFAULT_PANE_RESPONSE_BYTES } from "../authorization.js";
import { bindPaneState } from "../state-binding.js";
import { createAgentRouteClient } from "../agent-routes.js";
import { asPaneHostError, PaneHostError } from "../errors.js";
import {
  createPaneWorkspace,
  reducePaneWorkspace,
  type PaneWorkspaceAction,
  type PaneWorkspaceState,
} from "../instances.js";
import { fromMessagePort, type PanePort, type PaneViewHandle } from "../host-ports.js";
import {
  createGlobalTauriPaneOverlay,
  createGlobalTauriPaneViewAdapter,
  ensureTauriContentWellMetrics,
  isTauriNativePaneLayout,
  publishTauriContentWellMetrics,
  tauriPaneDocumentUrl,
} from "../adapters/tauri-runtime.js";
import type { TauriPaneMountTarget } from "../adapters/tauri.js";
import { isPanesHostChromeHidden } from "../host-presence.js";
import { PaneLoadingSkeleton } from "./pane-guest.js";
import {
  PANES_WORKSPACE_DOMAIN,
  PanesWorkspaceSnapshotSchema,
  type PaneWorkspaceOp,
} from "../workspace-protocol.js";
import {
  PI_PANES_WORKSPACE_INTENT_EVENT,
  type PaneWorkspaceHostIntent,
} from "../workspace-intent.js";

const NATIVE_READY_TIMEOUT_MS = 30_000;

export interface PanesSurfaceAccess {
  run(domain: string, action: string, args?: unknown): Promise<unknown>;
  getState<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  hasCommand(name: string): boolean;
}

export interface PanesStateAccess {
  get<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export type PanesUpload = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<{ readonly attachment: { readonly id: string }; readonly displayUrl: string }>;

export type PanesSessionLogs = (
  query: Readonly<Record<string, string>>,
) => Promise<unknown>;

export interface PanesConversationAccess {
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): void;
}

export interface PanesHostConfig {
  readonly interactionMode?: "standard" | "advanced";
  readonly allowTabReorder?: boolean;
  readonly showCommandPalette?: boolean;
  /** 可选 UI 编排：事件发布后激活已打开的目标 pane；不参与数据中继授权。 */
  readonly eventTargets?: Readonly<Record<string, string>>;
  /** Agent 自选的本地持久化命名空间；未声明则保持无状态。 */
  readonly persistenceKey?: string;
}

/** 宿主自身向 Pane 广播的事件；id 变化即一次新投递。 */
export interface PaneHostEvent {
  readonly id: number;
  readonly topic: string;
  readonly payload?: unknown;
}

export interface PanesHostProps {
  readonly definition: PanesDefinition;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly surface?: PanesSurfaceAccess;
  readonly upload?: PanesUpload;
  readonly conversation?: PanesConversationAccess;
  readonly state?: PanesStateAccess;
  readonly config?: PanesHostConfig;
  readonly signals?: Readonly<Record<string, unknown>>;
  readonly className?: string;
  readonly onHostError?: (error: PaneHostError) => void;
  /** 宿主控制的右侧栏收起入口；提供时置于 Pane 标签栏最左。 */
  readonly onRequestClose?: () => void;
  /** Pane 已获发布授权后，交宿主处理跨应用事件；返回 true 计入 delivered。 */
  readonly onEvent?: (topic: string, payload: unknown) => boolean | void | Promise<boolean | void>;
  /** 宿主 UI 向已授权订阅 Pane 发布事件。目标 Pane 未打开时按 eventTargets 自动打开并待就绪投递。 */
  readonly hostEvent?: PaneHostEvent;
  /** 受限的会话日志查询；仅供声明 `session.logs` 路由的 Guest 使用。 */
  readonly sessionLogs?: PanesSessionLogs;
  readonly createInstanceId?: (paneId: string, sequence: number) => string;
  /**
   * LLM 工作区遥控桥的 surface domain(见 workspace-protocol.ts)：订阅
   * `surface:<domain>` 快照增量应用意图 ops，并经 `surface.run(<domain>, "report", …)`
   * 回声实况。false 关闭；仅在提供 surface 时生效，agent 未发布该 domain 时零噪声。
   */
  readonly workspaceDomain?: string | false;
}

interface LiveConnection {
  readonly epoch: number;
  readonly port: PanePort;
  readonly closePort: boolean;
  readonly paneId: string;
  readonly cleanup: Array<() => void>;
  surfaceCleanup?: () => void;
  stateCleanup?: () => void;
}

interface NativePaneMount {
  readonly target: HTMLElement;
  readonly epoch: number;
  disposed: boolean;
  ready?: boolean;
  handle?: PaneViewHandle;
  stopReady?: () => void;
  readyTimeout?: ReturnType<typeof setTimeout>;
  disposeTimeout?: ReturnType<typeof setTimeout>;
}

interface NativePaneCarrierProps {
  readonly instance: PaneInstance;
  readonly pane: PaneDefinition;
  readonly active: boolean;
  readonly ready: boolean;
  readonly shown: boolean;
  readonly error?: PaneHostError;
  readonly onReload: () => void;
  readonly mount: (instance: PaneInstance, pane: PaneDefinition, target: HTMLElement | null) => void;
}

function NativePaneCarrier({ instance, pane, active, ready, shown, error, onReload, mount }: NativePaneCarrierProps): React.JSX.Element {
  const carrierRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    mount(instance, pane, carrierRef.current);
    return () => mount(instance, pane, null);
  }, [instance.instanceId, instance.epoch, instance.paneId, mount, pane.id]);
  return <div
    id={`pane-view-${instance.instanceId}`}
    role="tabpanel"
    aria-label={pane.title}
    data-pane-carrier="tauri-webview"
    ref={carrierRef}
    style={{ display: active && (error !== undefined || !ready || shown) ? "block" : "none", width: "100%", height: "100%", overflow: "hidden" }}
  >
    {error !== undefined ? (
      <div
        role="alert"
        data-pane-native-error={error.code}
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          padding: 16,
          color: "hsl(var(--destructive))",
          textAlign: "center",
          fontSize: 12,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>{error.message}</span>
          <button
            type="button"
            aria-label={`刷新 ${pane.title}`}
            title="刷新当前 Pane"
            onClick={onReload}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minHeight: 28,
              padding: "4px 8px",
              border: "1px solid hsl(var(--border))",
              borderRadius: 7,
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <RefreshCw size={13} aria-hidden="true" />
            刷新
          </button>
        </span>
      </div>
    ) : !ready ? <PaneLoadingSkeleton label={`正在加载${pane.title}…`} /> : null}
  </div>;
}

interface PersistedPaneWorkspace {
  readonly paneIds: readonly string[];
  /** Native child WebView label seed; keeps one WebView per pane across route remounts. */
  readonly instanceIds?: readonly string[];
  readonly activeIndex?: number;
}

const PANE_ICONS: Readonly<Record<string, LucideIcon>> = {
  box: Box,
  files: FileStack,
  "git-compare": GitCompare,
  images: Images,
  palette: Palette,
  search: Search,
  "scroll-text": ScrollText,
  "square-pen": SquarePen,
};

function PaneIcon({ name }: { readonly name?: string }): React.JSX.Element | null {
  if (name === undefined) return null;
  const Icon = PANE_ICONS[name];
  return Icon === undefined ? null : <Icon size={14} strokeWidth={1.8} aria-hidden />;
}

function restoredPaneWorkspace(
  definition: PanesDefinition,
  idFactory: (paneId: string) => string,
  persistenceKey?: string,
): PaneWorkspaceState {
  if (persistenceKey === undefined || typeof window === "undefined") {
    return createPaneWorkspace(definition, (paneId) => idFactory(paneId));
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(`${persistenceKey}:workspace`) ?? "null") as PersistedPaneWorkspace | null;
    if (!Array.isArray(saved?.paneIds)) throw new Error("missing paneIds");
    const declared = new Set(definition.panes.map((pane) => pane.id));
    // 直接按持久化顺序构造实例(而非逐个 reduce open):MRU 语义下 open 会前置,
    // 复用 open 会让顺序逐次翻转;构造后仅 activate 活跃实例(其前置为最近使用,稳定)。
    const instances: PaneInstance[] = [];
    const seenPanes = new Set<string>();
    for (const [index, paneId] of saved.paneIds.entries()) {
      if (typeof paneId !== "string" || !declared.has(paneId)) continue;
      const pane = paneById(definition, paneId);
      if (!pane.allowMultiple && seenPanes.has(paneId)) continue;
      seenPanes.add(paneId);
      const persistedInstanceId = saved.instanceIds?.[index];
      const instanceId = typeof persistedInstanceId === "string" && persistedInstanceId.length > 0
        ? persistedInstanceId
        : idFactory(paneId);
      instances.push({
        instanceId,
        paneId: pane.id,
        epoch: 1,
        state: instances.length === 0 ? "connecting" as const : "hidden" as const,
      });
    }
    const restored: PaneWorkspaceState = { instances, activeInstanceId: instances[0]?.instanceId };
    const active = saved.activeIndex === undefined ? undefined : instances[saved.activeIndex];
    return active === undefined
      ? restored
      : reducePaneWorkspace(definition, restored, { type: "activate", instanceId: active.instanceId });
  } catch {
    return createPaneWorkspace(definition, (paneId) => idFactory(paneId));
  }
}

function defaultInstanceId(paneId: string, sequence: number): string {
  return `${paneId}-${sequence}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function paneById(definition: PanesDefinition, paneId: string): PaneDefinition {
  const pane = definition.panes.find((candidate) => candidate.id === paneId);
  if (pane === undefined) throw new Error(`Unknown pane id: ${paneId}`);
  return pane;
}

function routeMax(capabilities: PaneCapabilities, route: string, method: "GET" | "POST"): number {
  return capabilities.routes.find((grant) => grant.name === route && grant.methods.includes(method))?.maxResponseBytes
    ?? DEFAULT_PANE_RESPONSE_BYTES;
}

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
};

const PANE_THEME_VARIABLES = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--popover", "--popover-foreground", "--primary", "--primary-foreground",
  "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
  "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
  "--border", "--input", "--ring", "--radius",
] as const;

function readPaneTheme(root: Element): PaneTheme {
  const style = getComputedStyle(root);
  return {
    colorScheme: style.colorScheme,
    tokens: Object.fromEntries(PANE_THEME_VARIABLES.flatMap((name) => {
      const value = style.getPropertyValue(name).trim();
      return value === "" ? [] : [[name, value]];
    })),
  };
}

const hostInteractionStyles = `
[data-panes-host] button { transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease; }
[data-panes-host] button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
[data-panes-host] [data-pane-icon-button]:hover,
[data-panes-host] [data-pane-palette-item]:hover:not(:disabled) {
  background: hsl(var(--accent)) !important;
  color: hsl(var(--foreground)) !important;
}
[data-panes-host] [data-pane-tab-shell]:hover {
  background: hsl(var(--accent)) !important;
  color: hsl(var(--foreground)) !important;
}
[data-panes-host] [data-pane-tab-shell]:hover > button {
  background: transparent !important;
}
`;

export function PanesHost({
  definition,
  baseUrl,
  sessionId,
  surface,
  upload,
  conversation,
  state,
  config = {},
  signals,
  className,
  onHostError,
  onRequestClose,
  onEvent,
  hostEvent,
  sessionLogs,
  createInstanceId = defaultInstanceId,
  workspaceDomain = PANES_WORKSPACE_DOMAIN,
}: PanesHostProps): React.JSX.Element {
  const sequence = React.useRef(0);
  const nextId = React.useCallback((paneId: string) => createInstanceId(paneId, ++sequence.current), [createInstanceId]);
  const [workspace, setWorkspace] = React.useState(() =>
    restoredPaneWorkspace(definition, (paneId) => nextId(paneId), config.persistenceKey));
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  const [parkedInstanceIds, setParkedInstanceIds] =
    React.useState<ReadonlySet<string>>(() => new Set());
  const parkedRef = React.useRef(parkedInstanceIds);
  parkedRef.current = parkedInstanceIds;
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [tabMenuOpen, setTabMenuOpen] = React.useState(false);
  // 新开 Pane / 更多 tab 弹层挂在 chrome 区，不 hide content webview（用户要底下 pane 保持可见）。
  const [draggedId, setDraggedId] = React.useState<string>();
  const [hostError, setHostError] = React.useState<PaneHostError>();
  const [nativeErrors, setNativeErrors] =
    React.useState<ReadonlyMap<string, PaneHostError>>(() => new Map());
  const [nativeReadyKeys, setNativeReadyKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  // native child 实际 show 完成（避免 ready 后 show 前的 carrier 空白帧闪烁）。
  const [nativeShownKeys, setNativeShownKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const frames = React.useRef(new Map<string, HTMLIFrameElement>());
  const connections = React.useRef(new Map<string, LiveConnection>());
  const pendingHostEvents = React.useRef(
    new Map<string, Array<{ readonly topic: string; readonly payload: unknown }>>(),
  );
  const lastHostEventId = React.useRef<number | undefined>(undefined);
  const nativeMounts = React.useRef(new Map<string, NativePaneMount>());
  const nativeSessionId = React.useRef(sessionId);
  const hostRoot = React.useRef<HTMLElement | null>(null);
  const tabNav = React.useRef<HTMLElement>(null);
  const contentWellRef = React.useRef<HTMLDivElement | null>(null);
  const [contentWellEl, setContentWellEl] = React.useState<HTMLDivElement | null>(null);
  const setContentWell = React.useCallback((node: HTMLDivElement | null): void => {
    contentWellRef.current = node;
    setContentWellEl(node);
  }, []);
  // SSR/jsdom 无布局观测时采用宽栏基线；浏览器首帧后由 ResizeObserver 收敛到真实余宽。
  const [tabNavWidth, setTabNavWidth] = React.useState(560);
  const [nativeLayoutActive, setNativeLayoutActive] = React.useState(false);
  const nativeAdapter = React.useMemo(
    () => typeof window === "undefined" ? undefined : createGlobalTauriPaneViewAdapter(window),
    [],
  );
  const nativeOverlay = React.useMemo(
    () => typeof window === "undefined" ? undefined : createGlobalTauriPaneOverlay(window),
    [],
  );
  // 挂载即预建隐藏 overlay shell，首点「新开 Pane」免冷创建。
  React.useEffect(() => {
    void nativeOverlay?.warm?.();
  }, [nativeOverlay]);

  // child WebView 只盖 content-well；tabs chrome 留在 host。量井上报 left/top/width/bottom。
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let cancelled = false;
    void isTauriNativePaneLayout(window).then((active) => {
      if (!cancelled) setNativeLayoutActive(active);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // lifecycle 由应用根 installDocumentPanesHostPresence 统一观察 document 内
  // [data-panes-host]（设置路由卸 host → destroy）。此处不重复 observe。

  // layout 后立刻 ensure 一次 + RO 跟手；well 用 callback 绑定，避免 current=null 漏挂。
  React.useLayoutEffect(() => {
    if (!nativeLayoutActive || typeof window === "undefined" || contentWellEl === null) {
      return undefined;
    }
    const well = contentWellEl;
    const publish = (): void => {
      void publishTauriContentWellMetrics(well, { minWidth: 240, target: window });
    };
    // 首挂一次同步量槽；跟手只走 RO→publish 单 rAF，勿 ensure settle。
    void ensureTauriContentWellMetrics(well, {
      minWidth: 240,
      target: window,
      force: true,
      settle: false,
    });
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(publish);
    ro?.observe(well);
    window.addEventListener("resize", publish);
    window.addEventListener("pi-panes-content-well-sync", publish);
    let unlisten: (() => void) | undefined;
    const runtime = (window as Window & {
      readonly __TAURI__?: {
        readonly event?: {
          listen(event: string, cb: () => void): Promise<() => void>;
        };
      };
    }).__TAURI__;
    void runtime?.event?.listen("pane-host-layout", publish).then((off) => {
      unlisten = off;
    }).catch(() => undefined);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("pi-panes-content-well-sync", publish);
      unlisten?.();
    };
  }, [nativeLayoutActive, contentWellEl]);
  const openPaletteRequestRef = React.useRef<(anchor?: Element) => void>(
    () => setPaletteOpen(true),
  );
  const advanced = config.interactionMode === "advanced";

  React.useEffect(() => {
    setParkedInstanceIds(new Set());
    setNativeErrors(new Map());
    setHostError(undefined);
  }, [definition]);

  React.useEffect(() => {
    const element = tabNav.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setTabNavWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (config.persistenceKey === undefined || typeof window === "undefined") return;
    const visible = workspace.instances.filter(
      (instance) => !parkedInstanceIds.has(instance.instanceId),
    );
    const activeIndex = visible.findIndex(
      (instance) => instance.instanceId === workspace.activeInstanceId,
    );
    window.localStorage.setItem(`${config.persistenceKey}:workspace`, JSON.stringify({
      paneIds: visible.map((instance) => instance.paneId),
      instanceIds: visible.map((instance) => instance.instanceId),
      ...(activeIndex >= 0 ? { activeIndex } : {}),
    } satisfies PersistedPaneWorkspace));
  }, [
    config.persistenceKey,
    parkedInstanceIds,
    workspace.activeInstanceId,
    workspace.instances,
  ]);

  const dispatch = React.useCallback((action: PaneWorkspaceAction): void => {
    setWorkspace((current) => reducePaneWorkspace(definition, current, action));
  }, [definition]);

  const closeConnection = React.useCallback((instanceId: string, lifecycle = true): void => {
    const live = connections.current.get(instanceId);
    if (live === undefined) return;
    if (lifecycle) live.port.post({ type: "pane:lifecycle", state: "closing" } satisfies PaneHostMessage);
    live.surfaceCleanup?.();
    live.stateCleanup?.();
    for (const cleanup of live.cleanup) cleanup();
    if (live.closePort) live.port.close();
    connections.current.delete(instanceId);
  }, []);

  React.useEffect(() => () => {
    // 组件卸载：document presence 见 host 移除 → destroyAll。
    // 此处只清 React 侧挂载表与连接；OS 侧由 host-presence 统一销毁。
    for (const instanceId of [...connections.current.keys()]) closeConnection(instanceId, false);
    for (const mount of nativeMounts.current.values()) {
      mount.disposed = true;
      if (mount.readyTimeout !== undefined) clearTimeout(mount.readyTimeout);
      mount.stopReady?.();
      // presence 已负责 destroy；此处避免双重 close 竞态，仅 suspend 标记。
      mount.handle?.suspend?.();
    }
    nativeMounts.current.clear();
  }, [closeConnection]);

  React.useLayoutEffect(() => {
    if (Object.is(nativeSessionId.current, sessionId)) return;
    nativeSessionId.current = sessionId;
    // 会话边界先停车：旧原生层若多留一帧，会盖住新 iframe 并截获鼠标。
    for (const live of connections.current.values()) {
      live.port.post({ type: "pane:lifecycle", state: "hidden" } satisfies PaneHostMessage);
    }
    for (const mount of nativeMounts.current.values()) {
      mount.disposed = true;
      if (mount.disposeTimeout !== undefined) clearTimeout(mount.disposeTimeout);
      if (mount.readyTimeout !== undefined) clearTimeout(mount.readyTimeout);
      mount.stopReady?.();
      mount.handle?.hide();
      mount.handle?.dispose();
    }
    nativeMounts.current.clear();
    for (const instanceId of [...connections.current.keys()]) {
      closeConnection(instanceId, false);
    }
    setNativeReadyKeys(new Set());
    setNativeErrors(new Map());
    setHostError(undefined);
    // epoch 变化迫使 iframe/WebView 都换新文档；新 WebView 仍以 visible:false 创建，
    // 仅 pane:ready 后展示，故加载期只有宿主骨架。
    setWorkspace((current) =>
      current.instances.reduce(
        (next, instance) =>
          reducePaneWorkspace(definition, next, {
            type: "reload",
            instanceId: instance.instanceId,
          }),
        current,
      ),
    );
  }, [closeConnection, definition, sessionId]);

  React.useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const publish = (): void => {
      if (hostRoot.current === null) return;
      const theme = readPaneTheme(hostRoot.current);
      for (const live of connections.current.values()) {
        live.port.post({ type: "pane:theme", theme } satisfies PaneHostMessage);
      }
    };
    const observer = new MutationObserver(publish);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    publish();
    return () => observer.disconnect();
  }, []);

  const restoreNativeVisibility = React.useCallback((): void => {
    const host = hostRoot.current;
    // 仅侧栏折叠等 chrome 隐藏时 hide content；面积 0 / overlay 打开不关 content。
    const hostChromeOk = host !== null && !isPanesHostChromeHidden(host);
    const activeId = workspaceRef.current.activeInstanceId;
    const activeMount =
      activeId === undefined ? undefined : nativeMounts.current.get(activeId);
    if (
      !hostChromeOk ||
      activeId === undefined ||
      activeMount === undefined ||
      activeMount.ready !== true ||
      parkedRef.current.has(activeId)
    ) {
      for (const instance of workspaceRef.current.instances) {
        const native = nativeMounts.current.get(instance.instanceId);
        if (native?.ready !== true) continue;
        native.handle?.hide();
      }
      return;
    }
    // show-first：先显活跃（await），成功后再隐其余，避免切 tab 的空白/旧帧闪烁。
    const activeNative = activeMount;
    void Promise.resolve(activeNative.handle?.show()).then(() => {
      if (workspaceRef.current.activeInstanceId !== activeId) return;
      setNativeShownKeys((current) => {
        const next = new Set(current);
        next.add(`${activeId}:${activeNative.epoch}`);
        return next;
      });
      for (const instance of workspaceRef.current.instances) {
        const native = nativeMounts.current.get(instance.instanceId);
        if (native?.ready !== true || native === activeNative) continue;
        native.handle?.hide();
      }
    });
  }, []);

  React.useLayoutEffect(() => {
    for (const instance of workspace.instances) {
      connections.current.get(instance.instanceId)?.port.post({
        type: "pane:lifecycle",
        state:
          instance.instanceId === workspace.activeInstanceId &&
          !parkedInstanceIds.has(instance.instanceId)
            ? "visible"
            : "hidden",
      } satisfies PaneHostMessage);
    }
    restoreNativeVisibility();
  }, [parkedInstanceIds, restoreNativeVisibility, workspace.activeInstanceId, workspace.instances]);

  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onRestore = (): void => restoreNativeVisibility();
    window.addEventListener("pi-panes-restore-visible", onRestore);
    return () => window.removeEventListener("pi-panes-restore-visible", onRestore);
  }, [restoreNativeVisibility]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && config.showCommandPalette !== false) {
        event.preventDefault();
        openPaletteRequestRef.current(hostRoot.current ?? undefined);
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const instance = workspace.instances
          .filter((candidate) => !parkedInstanceIds.has(candidate.instanceId))[
            Number(event.key) - 1
          ];
        if (instance !== undefined) dispatch({ type: "activate", instanceId: instance.instanceId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.showCommandPalette, dispatch, parkedInstanceIds, workspace.instances]);

  React.useEffect(() => () => nativeOverlay?.close(), [nativeOverlay, sessionId]);

  // ── LLM 工作区遥控桥(workspace-protocol.ts)────────────────────────────────
  // 下行:订阅 surface:<domain> 快照,对 opId 增量应用意图 ops;首帧取基线(不重放
  // 历史),opId 回退(agent 重启)自动再基线。上行:workspace 变化或 appliedOpId 推进
  // 时经 surface.run(<domain>,"report",…) 回声实况;内容去重,best-effort。
  // 另：宿主 UI（launcher 等）经 PI_PANES_WORKSPACE_INTENT_EVENT 投递同语义意图。
  const appliedOpRef = React.useRef<number | undefined>(undefined);
  const lastReportRef = React.useRef<string | undefined>(undefined);
  const snapshotSeenRef = React.useRef(false);
  const [reportTick, setReportTick] = React.useState(0);

  const applyOpenPane = React.useCallback(
    (paneId: string): void => {
      if (!definition.panes.some((pane) => pane.id === paneId)) return;
      const parked = workspaceRef.current.instances.find(
        (instance) =>
          instance.paneId === paneId && parkedRef.current.has(instance.instanceId),
      );
      if (parked !== undefined) {
        setParkedInstanceIds((current) => {
          const next = new Set(current);
          next.delete(parked.instanceId);
          return next;
        });
        dispatch({ type: "activate", instanceId: parked.instanceId });
        return;
      }
      dispatch({ type: "open", paneId, instanceId: nextId(paneId) });
    },
    [definition.panes, dispatch, nextId],
  );

  const applyActivateOrReload = React.useCallback(
    (
      type: "activate" | "reload" | "close",
      target: { instanceId?: string; paneId?: string },
    ): void => {
      setWorkspace((current) => {
        const hit =
          target.instanceId !== undefined
            ? current.instances.find((i) => i.instanceId === target.instanceId)
            : target.paneId !== undefined
              ? current.instances.find((i) => i.paneId === target.paneId)
              : undefined;
        if (hit === undefined) return current;
        if (type === "close") {
          closeConnection(hit.instanceId);
          return reducePaneWorkspace(definition, current, {
            type: "close",
            instanceId: hit.instanceId,
          });
        }
        if (type === "activate") {
          setParkedInstanceIds((parked) => {
            const next = new Set(parked);
            next.delete(hit.instanceId);
            return next;
          });
        }
        const action: PaneWorkspaceAction =
          type === "activate"
            ? { type: "activate", instanceId: hit.instanceId }
            : { type: "reload", instanceId: hit.instanceId };
        return reducePaneWorkspace(definition, current, action);
      });
    },
    [closeConnection, definition],
  );

  /** 与 pane_open / pane_activate 工具同语义；open-or-activate 供侧栏入口。 */
  const applyHostIntent = React.useCallback(
    (intent: PaneWorkspaceHostIntent): void => {
      if (intent.type === "open") {
        applyOpenPane(intent.paneId);
        return;
      }
      if (intent.type === "open-or-activate") {
        if (!definition.panes.some((pane) => pane.id === intent.paneId)) return;
        const parked = workspaceRef.current.instances.find(
          (instance) =>
            instance.paneId === intent.paneId &&
            parkedRef.current.has(instance.instanceId),
        );
        if (parked !== undefined) {
          applyOpenPane(intent.paneId);
          return;
        }
        const existing = workspaceRef.current.instances.find(
          (instance) => instance.paneId === intent.paneId,
        );
        if (existing !== undefined) {
          applyActivateOrReload("activate", { instanceId: existing.instanceId });
          return;
        }
        applyOpenPane(intent.paneId);
        return;
      }
      applyActivateOrReload("activate", {
        instanceId: intent.instanceId,
        paneId: intent.paneId,
      });
    },
    [applyActivateOrReload, applyOpenPane, definition.panes],
  );

  React.useEffect(() => {
    const onIntent = (event: Event): void => {
      const detail = (event as CustomEvent<PaneWorkspaceHostIntent>).detail;
      if (detail === undefined || typeof detail !== "object" || detail === null) return;
      if (typeof (detail as { type?: unknown }).type !== "string") return;
      applyHostIntent(detail);
    };
    window.addEventListener(PI_PANES_WORKSPACE_INTENT_EVENT, onIntent);
    return () => window.removeEventListener(PI_PANES_WORKSPACE_INTENT_EVENT, onIntent);
  }, [applyHostIntent]);

  React.useEffect(() => {
    if (surface === undefined || workspaceDomain === false) return;
    const applyOp = (op: PaneWorkspaceOp): void => {
      if (op.type === "open") {
        applyOpenPane(op.paneId);
        return;
      }
      applyActivateOrReload(op.type, {
        instanceId: op.instanceId,
        paneId: op.paneId,
      });
    };
    const consume = (value: unknown): void => {
      const parsed = PanesWorkspaceSnapshotSchema.safeParse(value);
      if (!parsed.success) return;
      snapshotSeenRef.current = true;
      const ops = [...parsed.data.ops].sort((a, b) => a.opId - b.opId);
      const latest = ops[ops.length - 1]?.opId ?? 0;
      if (appliedOpRef.current === undefined || appliedOpRef.current > latest) {
        appliedOpRef.current = latest;
      } else {
        for (const op of ops) {
          if (op.opId <= appliedOpRef.current) continue;
          appliedOpRef.current = op.opId;
          applyOp(op);
        }
      }
      setReportTick((tick) => tick + 1);
    };
    consume(surface.getState(`surface:${workspaceDomain}`));
    return surface.subscribe(`surface:${workspaceDomain}`, consume);
  }, [applyActivateOrReload, applyOpenPane, surface, workspaceDomain]);

  React.useEffect(() => {
    if (surface === undefined || workspaceDomain === false || !snapshotSeenRef.current) return;
    const report = {
      appliedOpId: appliedOpRef.current ?? 0,
      ...(workspace.activeInstanceId !== undefined &&
      !parkedInstanceIds.has(workspace.activeInstanceId)
        ? { activeInstanceId: workspace.activeInstanceId }
        : {}),
      panes: definition.panes.map((pane) => ({
        paneId: pane.id,
        title: pane.title,
        openCount: workspace.instances.filter((instance) => instance.paneId === pane.id).length,
        maxInstances: pane.maxInstances,
        allowMultiple: pane.allowMultiple,
      })),
      instances: workspace.instances.map((instance) => ({
        instanceId: instance.instanceId,
        paneId: instance.paneId,
        epoch: instance.epoch,
        state: parkedInstanceIds.has(instance.instanceId)
          ? "hidden" as const
          : instance.state,
      })),
    };
    const encoded = JSON.stringify(report);
    if (encoded === lastReportRef.current) return;
    lastReportRef.current = encoded;
    void Promise.resolve(surface.run(workspaceDomain, "report", report)).catch(() => undefined);
  }, [definition, parkedInstanceIds, reportTick, surface, workspace, workspaceDomain]);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const handleRequest = React.useCallback(async (
    instance: PaneInstance,
    pane: PaneDefinition,
    request: PaneGuestRequest,
  ): Promise<unknown> => {
    const live = connections.current.get(instance.instanceId);
    if (live?.epoch !== instance.epoch) throw new PaneHostError("STALE_INSTANCE", "Pane instance epoch is stale");
    authorizePaneRequest(pane.capabilities, request);
    if (request.operation === "route.query" || request.operation === "route.mutate") {
      if (request.operation === "route.query" && request.route === "session.logs") {
        if (sessionLogs === undefined) {
          throw new PaneHostError("HOST_UNAVAILABLE", "Session logs are not ready", { retryable: true });
        }
        return sessionLogs(request.query ?? {});
      }
      if (baseUrl === undefined || sessionId === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Agent Route session is not ready", { retryable: true });
      const client = createAgentRouteClient({ baseUrl, sessionId });
      return request.operation === "route.query"
        ? client.query(request.route, request.query, routeMax(pane.capabilities, request.route, "GET"))
        : client.mutate(request.route, request.body, routeMax(pane.capabilities, request.route, "POST"));
    }
    if (request.operation === "surface.run") {
      if (surface === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Surface is not ready", { retryable: true });
      return surface.run(request.domain, request.action, request.args);
    }
    if (request.operation === "event.publish") {
      let delivered = 0;
      if (await onEvent?.(request.topic, request.payload) === true) delivered += 1;
      const current = workspaceRef.current;
      for (const target of current.instances) {
        const targetPane = paneById(definition, target.paneId);
        if (!targetPane.capabilities.events.subscribe.includes(request.topic)) continue;
        const targetLive = connections.current.get(target.instanceId);
        if (targetLive?.epoch !== target.epoch) continue;
        targetLive.port.post({
          type: "pane:event",
          topic: request.topic,
          payload: request.payload,
          source: { instanceId: instance.instanceId, paneId: instance.paneId },
        } satisfies PaneHostMessage);
        delivered += 1;
      }
      const targetPaneId = config.eventTargets?.[request.topic];
      const target = targetPaneId === undefined
        ? undefined
        : current.instances.find((candidate) => candidate.paneId === targetPaneId);
      if (target !== undefined) {
        setParkedInstanceIds((parked) => {
          const next = new Set(parked);
          next.delete(target.instanceId);
          return next;
        });
        setWorkspace((latest) => reducePaneWorkspace(definition, latest, {
          type: "activate",
          instanceId: target.instanceId,
        }));
      }
      return { delivered };
    }
    if (request.operation === "attachment.put") {
      if (upload === undefined || baseUrl === undefined || sessionId === undefined) {
        throw new PaneHostError("ATTACHMENT_FAILED", "Attachment service is not ready", { retryable: true });
      }
      const file = new File([request.bytes], request.name, { type: request.mimeType || "application/octet-stream" });
      const result = await upload(baseUrl, sessionId, file);
      return { attachmentId: result.attachment.id, displayUrl: result.displayUrl };
    }
    if (request.operation === "state.set" || request.operation === "state.delete") {
      const stateAccess = stateRef.current;
      if (stateAccess === undefined) {
        throw new PaneHostError("HOST_UNAVAILABLE", "Shared state is not ready", { retryable: true });
      }
      if (request.operation === "state.set") await stateAccess.set(request.key, request.value);
      else await stateAccess.delete(request.key);
      return undefined;
    }
    if (conversation === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Conversation is not ready", { retryable: true });
    conversation.submitUserMessage(request.text, request.attachmentIds === undefined ? undefined : { attachmentIds: request.attachmentIds });
    return undefined;
  }, [baseUrl, config.eventTargets, conversation, definition, onEvent, sessionId, sessionLogs, surface, upload]);

  const bindSurface = React.useCallback((live: LiveConnection, pane: PaneDefinition): void => {
    live.surfaceCleanup?.();
    live.surfaceCleanup = undefined;
    if (surface === undefined) return;
    const disposers: Array<() => void> = [];
    for (const key of pane.capabilities.surfaceKeys) {
      const push = (value: unknown): void => {
        live.port.post({ type: "pane:surface", key, value } satisfies PaneHostMessage);
      };
      push(surface.getState(key));
      disposers.push(surface.subscribe(key, push));
    }
    live.surfaceCleanup = () => {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    };
  }, [surface]);

  const bindState = React.useCallback((live: LiveConnection, pane: PaneDefinition): void => {
    live.stateCleanup?.();
    live.stateCleanup = bindPaneState(stateRef.current, pane.capabilities.state.read, (key, value) => {
      live.port.post({ type: "pane:state", key, value } satisfies PaneHostMessage);
    });
  }, []);

  React.useEffect(() => {
    for (const live of connections.current.values()) {
      bindState(live, paneById(definition, live.paneId));
    }
  }, [bindState, definition, state]);

  React.useEffect(() => {
    for (const live of connections.current.values()) {
      bindSurface(live, paneById(definition, live.paneId));
    }
  }, [bindSurface, definition]);

  const pushAllSignals = React.useCallback((port: PanePort): void => {
    for (const [name, value] of Object.entries(signals ?? {})) {
      port.post({ type: "pane:signal", name, value } satisfies PaneHostMessage);
    }
  }, [signals]);

  const lastSignals = React.useRef<Record<string, unknown>>({});
  React.useEffect(() => {
    const next = signals ?? {};
    const previous = lastSignals.current;
    const changed = Object.entries(next).filter(([name, value]) => !Object.is(previous[name], value));
    lastSignals.current = { ...next };
    if (changed.length === 0) return;
    for (const live of connections.current.values()) {
      for (const [name, value] of changed) {
        live.port.post({ type: "pane:signal", name, value } satisfies PaneHostMessage);
      }
    }
  }, [signals]);

  const bindConnection = React.useCallback((
    instance: PaneInstance,
    pane: PaneDefinition,
    port: PanePort,
    sendConnected: (message: PaneHostMessage) => void,
    closePort: boolean,
    force = false,
  ): void => {
    if (!force && connections.current.get(instance.instanceId)?.epoch === instance.epoch) return;
    closeConnection(instance.instanceId, false);
    const cleanup: Array<() => void> = [];
    const live: LiveConnection = {
      epoch: instance.epoch,
      paneId: instance.paneId,
      port,
      closePort,
      cleanup,
    };
    connections.current.set(instance.instanceId, live);
    cleanup.push(port.listen((data) => {
      const parsed = PaneGuestRequestSchema.safeParse(data);
      if (!parsed.success) {
        const requestId = typeof data === "object" && data !== null && typeof (data as { requestId?: unknown }).requestId === "string"
          ? (data as { requestId: string }).requestId
          : "invalid";
        port.post({
          type: "pane:result",
          requestId,
          ok: false,
          error: new PaneHostError("INVALID_MESSAGE", "Pane request does not match protocol").toJSON(),
        } satisfies PaneHostMessage);
        return;
      }
      void handleRequest(instance, pane, parsed.data).then(
        (data) => port.post({ type: "pane:result", requestId: parsed.data.requestId, ok: true, data } satisfies PaneHostMessage),
        (reason: unknown) => {
          const error = asPaneHostError(reason);
          if (error.code === "HOST_UNAVAILABLE") setHostError(error);
          onHostError?.(error);
          port.post({ type: "pane:result", requestId: parsed.data.requestId, ok: false, error: error.toJSON() } satisfies PaneHostMessage);
        },
      );
    }));
    bindSurface(live, pane);
    bindState(live, pane);
    pushAllSignals(port);
    sendConnected({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: instance.instanceId, paneId: instance.paneId, epoch: instance.epoch },
      grants: pane.capabilities,
      interactionMode: config.interactionMode ?? "standard",
      theme: readPaneTheme(hostRoot.current ?? document.documentElement),
    } satisfies PaneHostMessage);
    const queued = pendingHostEvents.current.get(instance.paneId);
    if (queued !== undefined) {
      pendingHostEvents.current.delete(instance.paneId);
      for (const event of queued) {
        port.post({
          type: "pane:event",
          topic: event.topic,
          payload: event.payload,
          source: { instanceId: "host", paneId: "host" },
        } satisfies PaneHostMessage);
      }
    }
  }, [bindState, bindSurface, closeConnection, config.interactionMode, definition, handleRequest, onHostError, pushAllSignals]);

  React.useEffect(() => {
    if (hostEvent === undefined || lastHostEventId.current === hostEvent.id) return;
    lastHostEventId.current = hostEvent.id;
    const current = workspaceRef.current;
    const payload = hostEvent.payload;
    const livePaneIds = new Set<string>();
    for (const instance of current.instances) {
      const pane = paneById(definition, instance.paneId);
      if (!pane.capabilities.events.subscribe.includes(hostEvent.topic)) continue;
      const live = connections.current.get(instance.instanceId);
      if (live?.epoch !== instance.epoch) continue;
      live.port.post({
        type: "pane:event",
        topic: hostEvent.topic,
        payload,
        source: { instanceId: "host", paneId: "host" },
      } satisfies PaneHostMessage);
      livePaneIds.add(instance.paneId);
    }

    const targetPaneId = config.eventTargets?.[hostEvent.topic];
    if (targetPaneId === undefined) return;
    const targetPane = definition.panes.find((pane) => pane.id === targetPaneId);
    if (
      targetPane === undefined ||
      !targetPane.capabilities.events.subscribe.includes(hostEvent.topic)
    ) return;
    const target = current.instances.find((instance) => instance.paneId === targetPaneId);
    if (target === undefined) {
      pendingHostEvents.current.set(targetPaneId, [
        ...(pendingHostEvents.current.get(targetPaneId) ?? []),
        { topic: hostEvent.topic, payload },
      ]);
      dispatch({ type: "open", paneId: targetPaneId, instanceId: nextId(targetPaneId) });
      return;
    }
    setParkedInstanceIds((parked) => {
      const next = new Set(parked);
      next.delete(target.instanceId);
      return next;
    });
    dispatch({ type: "activate", instanceId: target.instanceId });
    if (!livePaneIds.has(targetPaneId)) {
      pendingHostEvents.current.set(targetPaneId, [
        ...(pendingHostEvents.current.get(targetPaneId) ?? []),
        { topic: hostEvent.topic, payload },
      ]);
    }
  }, [config.eventTargets, definition, dispatch, hostEvent, nextId]);

  const connectFrame = React.useCallback((instance: PaneInstance, force = false): void => {
    const frame = frames.current.get(instance.instanceId);
    if (frame?.contentWindow === null || frame?.contentWindow === undefined) return;
    const pane = paneById(definition, instance.paneId);
    const channel = new MessageChannel();
    bindConnection(
      instance,
      pane,
      fromMessagePort(channel.port1),
      (message) => frame.contentWindow?.postMessage(message, "*", [channel.port2]),
      true,
      force,
    );
  }, [bindConnection, definition]);

  React.useEffect(() => {
    const onGuestReady = (event: MessageEvent<unknown>): void => {
      const data = event.data as { type?: unknown; protocol?: unknown; paneId?: unknown } | undefined;
      if (data?.type !== "pane:ready" || data.protocol !== PANE_PROTOCOL_VERSION || typeof data.paneId !== "string") return;
      const instance = workspace.instances.find((candidate) => {
        const frame = frames.current.get(candidate.instanceId);
        return candidate.paneId === data.paneId && frame?.contentWindow === event.source;
      });
      // ready 表示当前 guest 尚无通道；旧同 epoch 记录属于已卸载文档，须重建。
      if (instance !== undefined) connectFrame(instance, true);
    };
    window.addEventListener("message", onGuestReady);
    return () => window.removeEventListener("message", onGuestReady);
  }, [connectFrame, workspace.instances]);

  /**
   * 补连扫描：iframe 的 `load` 与 guest 的 `pane:ready` 都可能早于宿主
   * 注册监听或保存 ref；已有 frame 即按 epoch 幂等补建连接。
   */
  React.useEffect(() => {
    for (const instance of workspace.instances) {
      if (connections.current.get(instance.instanceId)?.epoch === instance.epoch) continue;
      const frame = frames.current.get(instance.instanceId);
      if (frame?.contentWindow !== null && frame?.contentWindow !== undefined) {
        connectFrame(instance);
      }
    }
  }, [connectFrame, workspace.instances]);

  const mountNativePane = React.useCallback((
    instance: PaneInstance,
    pane: PaneDefinition,
    target: HTMLElement | null,
  ): void => {
    if (nativeAdapter === undefined) return;
    const existing = nativeMounts.current.get(instance.instanceId);
    if (target === null) {
      if (existing === undefined || existing.epoch !== instance.epoch) return;
      // 槽位/侧栏收起：隐藏并保留 webview（suspend），不 dispose。
      // StrictMode 的 null→重挂 仍用 0ms 防抖；重挂取消则仅 suspend。
      existing.disposeTimeout ??= setTimeout(() => {
        if (nativeMounts.current.get(instance.instanceId) !== existing) return;
        if (existing.readyTimeout !== undefined) clearTimeout(existing.readyTimeout);
        existing.stopReady?.();
        closeConnection(instance.instanceId, false);
        existing.handle?.suspend?.() ?? existing.handle?.hide();
        // 保留 mount 记录以便同会话再开侧栏时复用 handle；仅标记未就绪展示。
        existing.ready = false;
        existing.disposeTimeout = undefined;
      }, 0);
      return;
    }
    if (existing?.target === target && existing.epoch === instance.epoch) {
      if (existing.disposeTimeout !== undefined) {
        clearTimeout(existing.disposeTimeout);
        existing.disposeTimeout = undefined;
      }
      return;
    }
    if (existing !== undefined && existing.epoch === instance.epoch) {
      existing.disposed = true;
      if (existing.disposeTimeout !== undefined) clearTimeout(existing.disposeTimeout);
      if (existing.readyTimeout !== undefined) clearTimeout(existing.readyTimeout);
      existing.stopReady?.();
      closeConnection(instance.instanceId);
      existing.handle?.dispose();
      nativeMounts.current.delete(instance.instanceId);
    }
    const mount: NativePaneMount = { target, epoch: instance.epoch, disposed: false };
    nativeMounts.current.set(instance.instanceId, mount);
    const fallbackKey = `${instance.instanceId}:${instance.epoch}`;
    setNativeErrors((current) => {
      if (!current.has(instance.instanceId)) return current;
      const next = new Map(current);
      next.delete(instance.instanceId);
      return next;
    });
    setNativeReadyKeys((current) => {
      if (!current.has(fallbackKey)) return current;
      const next = new Set(current);
      next.delete(fallbackKey);
      return next;
    });
    mount.readyTimeout = setTimeout(() => {
      if (mount.disposed || nativeMounts.current.get(instance.instanceId) !== mount) return;
      mount.disposed = true;
      mount.stopReady?.();
      mount.handle?.dispose();
      nativeMounts.current.delete(instance.instanceId);
      const error = asPaneHostError(
        new Error(`Pane WebView readiness timed out: ${pane.id}`),
      );
      setNativeErrors((current) => new Map(current).set(instance.instanceId, error));
    }, NATIVE_READY_TIMEOUT_MS);
    const options: TauriPaneMountTarget = {
      instanceId: instance.instanceId,
      paneId: instance.paneId,
      epoch: instance.epoch,
      url: tauriPaneDocumentUrl(pane.document, instance.instanceId),
      container: target,
      // Native surface stays hidden until protocol readiness; an unready
      // transparent WebView must never intercept host input.
      visible: false,
    };
    // 同一 commit 的微任务中启动：可合并 StrictMode 的 ref 模拟重挂，又不会像
    // setTimeout(0) 跨过 Fast Refresh/会话清理而遗失启动机会。
    queueMicrotask(() => {
      if (mount.disposed || nativeMounts.current.get(instance.instanceId) !== mount) return;
      void Promise.resolve(nativeAdapter.mount(options)).then((handle) => {
        if (mount.disposed || nativeMounts.current.get(instance.instanceId) !== mount) {
          handle.dispose();
          return;
        }
        mount.handle = handle;
        mount.stopReady = handle.port.listen((message) => {
          const ready = message as { type?: unknown; protocol?: unknown; paneId?: unknown } | undefined;
          if (ready?.type !== "pane:ready" || ready.protocol !== PANE_PROTOCOL_VERSION || ready.paneId !== pane.id) return;
          if (mount.readyTimeout !== undefined) {
            clearTimeout(mount.readyTimeout);
            mount.readyTimeout = undefined;
           }
           mount.ready = true;
           setNativeErrors((current) => {
             if (!current.has(instance.instanceId)) return current;
             const next = new Map(current);
             next.delete(instance.instanceId);
             return next;
           });
           setNativeReadyKeys((current) => new Set(current).add(fallbackKey));
           bindConnection(instance, pane, handle.port, (connected) => handle.port.post(connected), false, true);
          // ready → **await 槽位 metrics** → 再 show。禁止只 publish rAF 就 show（首帧错位）。
          // show 门控用 chrome 折叠态（非面积）：首帧/jsdom rect=0 不得挡住 show。
          const hostEl = hostRoot.current;
          const hostChromeOk =
            hostEl !== null && !isPanesHostChromeHidden(hostEl);
          const well = contentWellRef.current;
          const placeThenShow = async (): Promise<void> => {
            if (well !== null) {
              // 首 show 前最多 4 帧稳一次；之后拖拽只 RO→publish。
              await ensureTauriContentWellMetrics(well, {
                minWidth: 240,
                force: true,
                settle: true,
              });
            }
            if (
              hostChromeOk &&
              workspaceRef.current.activeInstanceId === instance.instanceId &&
              !parkedRef.current.has(instance.instanceId)
            ) {
              await Promise.resolve(handle.show());
              setNativeShownKeys((current) =>
                new Set(current).add(`${instance.instanceId}:${instance.epoch}`));
              // show 后一帧补钉（无 settle 循环）。
              if (well !== null) {
                await ensureTauriContentWellMetrics(well, {
                  minWidth: 240,
                  force: true,
                  settle: false,
                });
              }
              window.dispatchEvent(new Event("pi-panes-restore-visible"));
            } else {
              handle.hide();
            }
          };
          void placeThenShow();
        });
      }).catch((reason: unknown) => {
        if (mount.disposed) return;
        mount.disposed = true;
        if (mount.readyTimeout !== undefined) clearTimeout(mount.readyTimeout);
        nativeMounts.current.delete(instance.instanceId);
        const error = asPaneHostError(reason);
        setNativeErrors((current) => new Map(current).set(instance.instanceId, error));
      });
    });
  }, [bindConnection, closeConnection, dispatch, nativeAdapter, onHostError]);

  const openPane = (paneId: string): void => {
    const parked = workspace.instances.find(
      (instance) =>
        instance.paneId === paneId &&
        parkedInstanceIds.has(instance.instanceId),
    );
    if (parked !== undefined) {
      setParkedInstanceIds((current) => {
        const next = new Set(current);
        next.delete(parked.instanceId);
        return next;
      });
      dispatch({ type: "activate", instanceId: parked.instanceId });
    } else {
      dispatch({ type: "open", paneId, instanceId: nextId(paneId) });
    }
    setPaletteOpen(false);
    setTabMenuOpen(false);
    nativeOverlay?.close();
  };

  const closePane = (instanceId: string): void => {
    const nextParked = new Set(parkedInstanceIds);
    nextParked.add(instanceId);
    setParkedInstanceIds(nextParked);
    const next = workspace.instances.find(
      (instance) =>
        instance.instanceId !== instanceId &&
        !nextParked.has(instance.instanceId),
    );
    if (next !== undefined) {
      dispatch({ type: "activate", instanceId: next.instanceId });
    }
  };

  const reloadPane = (instanceId: string): void => {
    const instance = workspace.instances.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (instance === undefined) return;
    const pane = paneById(definition, instance.paneId);
    if (nativeAdapter !== undefined && pane.document.kind === "html") {
      setNativeErrors((current) => {
        if (!current.has(instanceId)) return current;
        const next = new Map(current);
        next.delete(instanceId);
        return next;
      });
      const mount = nativeMounts.current.get(instanceId);
      if (mount?.handle !== undefined) {
        closeConnection(instanceId, false);
        mount.ready = false;
        mount.handle.hide();
        setNativeReadyKeys((current) => {
          const next = new Set(current);
          next.delete(`${instanceId}:${instance.epoch}`);
          return next;
        });
        setNativeShownKeys((current) => {
          const next = new Set(current);
          next.delete(`${instanceId}:${instance.epoch}`);
          return next;
        });
        if (mount.readyTimeout !== undefined) clearTimeout(mount.readyTimeout);
        mount.readyTimeout = setTimeout(() => {
          if (mount.disposed || nativeMounts.current.get(instanceId) !== mount) return;
          mount.disposed = true;
          mount.stopReady?.();
          mount.handle?.dispose();
          nativeMounts.current.delete(instanceId);
          const error = asPaneHostError(
            new Error(`Pane WebView readiness timed out: ${pane.id}`),
          );
          setNativeErrors((current) => new Map(current).set(instanceId, error));
        }, NATIVE_READY_TIMEOUT_MS);
        mount.handle.reload();
        return;
      }
    }
    closeConnection(instanceId, false);
    dispatch({ type: "reload", instanceId });
  };

  const tabInstances = workspace.instances.filter(
    (instance) => !parkedInstanceIds.has(instance.instanceId),
  );
  // 标签含图标、标题与关闭键；按每项约 108px 预算，确保标为“可见”的项不被 nav 裁掉。
  const tabLimit = Math.max(1, Math.min(6, Math.floor(tabNavWidth / 108)));
  const visibleInstances = tabInstances.length <= tabLimit
    ? tabInstances
    : tabInstances.slice(0, tabLimit);
  const visibleInstanceIds = new Set(
    visibleInstances.map((instance) => instance.instanceId),
  );
  const hiddenInstances = tabInstances.filter(
    (instance) => !visibleInstanceIds.has(instance.instanceId),
  );
  const activeTabInstanceId = tabInstances.some(
    (instance) => instance.instanceId === workspace.activeInstanceId,
  )
    ? workspace.activeInstanceId
    : undefined;
  /**
   * 新开 Pane / 更多 tab：
   * - native：child overlay **贴合 content-well**（与 content webview 同槽），内蒙版+菜单；
   *   z 高于 content，**不 hide** 侧栏 webview。
   * - 非 Tauri：DOM 蒙版盖在 content-well 上。
   */
  const openPaletteMenu = (anchor?: Element): void => {
    setTabMenuOpen(false);
    const cover = contentWellRef.current;
    const themeEl = anchor ?? hostRoot.current ?? cover;
    if (nativeOverlay !== undefined && cover !== null && themeEl !== null) {
      setPaletteOpen(false);
      const items = definition.panes.map((pane) => {
        const openCount = workspace.instances.filter((i) => i.paneId === pane.id).length;
        const parked = workspace.instances.some(
          (i) => i.paneId === pane.id && parkedInstanceIds.has(i.instanceId),
        );
        const disabled =
          !parked &&
          (openCount >= pane.maxInstances ||
            workspace.instances.length >= definition.maxOpenPanes);
        return {
          id: pane.id,
          label: pane.title,
          meta: pane.maxInstances === UNLIMITED_PANE_COUNT
            ? `已开 ${openCount}`
            : `${openCount}/${pane.maxInstances}`,
          disabled,
        };
      });
      void nativeOverlay.open({
        title: "新开 Pane",
        items,
        cover,
        anchor: themeEl,
        placement: "center",
        onSelect: (id) => openPane(id),
      });
      return;
    }
    setPaletteOpen(true);
  };
  openPaletteRequestRef.current = openPaletteMenu;
  const openHiddenTabsMenu = (anchor: Element): void => {
    setPaletteOpen(false);
    const cover = contentWellRef.current;
    if (nativeOverlay !== undefined && cover !== null) {
      setTabMenuOpen(false);
      const items = hiddenInstances.map((instance) => {
        const pane = paneById(definition, instance.paneId);
        return {
          id: instance.instanceId,
          label: pane.title,
          disabled: false,
          selected: instance.instanceId === workspace.activeInstanceId,
        };
      });
      void nativeOverlay.open({
        title: "更多 Pane",
        items,
        cover,
        anchor,
        placement: "anchor-end",
        onSelect: (instanceId) => {
          dispatch({ type: "activate", instanceId });
          if (nativeErrors.has(instanceId)) reloadPane(instanceId);
        },
      });
      return;
    }
    setTabMenuOpen(true);
  };
  const closeChromeMenus = (): void => {
    setPaletteOpen(false);
    setTabMenuOpen(false);
    nativeOverlay?.close();
  };

  return (
    <section
      ref={hostRoot}
      data-panes-host
      data-panes-carrier={nativeAdapter !== undefined ? "tauri-webview" : "iframe"}
      className={className}
      style={{ position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
    >
      <style>{hostInteractionStyles}</style>
      {/* Pane 层 chrome：紧凑扁平 tabs，选中仅底色/字色区分。 */}
      <header
        data-panes-chrome
        data-panes-tabs
        style={{
          display: "flex",
          minHeight: 28,
          alignItems: "center",
          gap: 1,
          padding: "2px 4px",
          borderBottom: "1px solid hsl(var(--border))",
          background: "hsl(var(--muted) / .12)",
        }}
      >
        {onRequestClose !== undefined ? (
          <button
            type="button"
            data-pane-sidebar-collapse
            aria-label="收起 Pane 侧栏"
            title="收起 Pane 侧栏"
            onClick={onRequestClose}
            style={{ ...buttonStyle, display: "grid", placeItems: "center", border: "1px solid hsl(var(--border))", padding: "4px" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="15" y1="4" x2="15" y2="20" />
            </svg>
          </button>
        ) : null}
        <nav ref={tabNav} aria-label="Panes" role="tablist" style={{ display: "flex", flex: 1, gap: 4, minWidth: 0, overflow: "hidden" }}>
          {visibleInstances.map((instance) => {
            const index = workspace.instances.findIndex(
              (candidate) => candidate.instanceId === instance.instanceId,
            );
            const pane = paneById(definition, instance.paneId);
            const count = workspace.instances.filter((candidate) => candidate.paneId === instance.paneId);
            const ordinal = count.findIndex((candidate) => candidate.instanceId === instance.instanceId) + 1;
            const selected = instance.instanceId === workspace.activeInstanceId;
            return (
              <div key={instance.instanceId} role="presentation" data-pane-tab-shell data-pane-tab-selected={selected ? "true" : "false"} draggable={advanced && config.allowTabReorder !== false}
                onDragStart={() => setDraggedId(instance.instanceId)} onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (draggedId !== undefined) dispatch({ type: "move", instanceId: draggedId, beforeInstanceId: instance.instanceId }); setDraggedId(undefined); }}
                style={{
                  display: "flex",
                  flex: "0 1 auto",
                  minWidth: 0,
                  maxWidth: 120,
                  alignItems: "center",
                  borderRadius: 4,
                  border: "none",
                  background: selected ? "hsl(var(--muted))" : "transparent",
                  boxShadow: "none",
                }}>
                <button type="button" role="tab" aria-selected={selected} aria-controls={`pane-view-${instance.instanceId}`}
                  data-pane-tab
                  title={`${pane.title} · Alt+${index + 1}`}
                  onClick={() => {
                    dispatch({ type: "activate", instanceId: instance.instanceId });
                    if (nativeErrors.has(instance.instanceId)) {
                      reloadPane(instance.instanceId);
                    }
                  }}
                  style={{
                    ...buttonStyle,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    padding: "4px 4px 4px 8px",
                    lineHeight: 1.2,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                    fontWeight: selected ? 500 : 400,
                  }}>
                  {pane.icon !== undefined ? <span aria-hidden="true" style={{ display: "inline-grid", marginRight: 4, verticalAlign: -1, opacity: .75 }}><PaneIcon name={pane.icon} /></span> : null}
                  {pane.title}{count.length > 1 ? ` ${ordinal}` : ""}
                </button>
                <button type="button" aria-label={`关闭 ${pane.title}`} title="关闭 Pane" onClick={() => closePane(instance.instanceId)}
                  data-pane-icon-button
                  style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: "2px 5px", color: "hsl(var(--muted-foreground))" }}>
                  <X size={12} aria-hidden />
                </button>
              </div>
            );
          })}
        </nav>
        {hiddenInstances.length > 0 ? (
          <button
            type="button"
            aria-label="更多 Pane"
            title={`${hiddenInstances.length} 个 Pane 已收起`}
            aria-haspopup="menu"
            aria-expanded={tabMenuOpen}
            onClick={(event) => openHiddenTabsMenu(event.currentTarget)}
            data-pane-icon-button
            style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: "4px" }}
          >
            <MoreHorizontal size={15} aria-hidden />
          </button>
        ) : null}
        <button type="button" aria-label="新开 Pane" title="新开 Pane" onClick={(event) => openPaletteMenu(event.currentTarget)}
          data-pane-icon-button
          style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: "4px" }}>
          <Plus size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="刷新当前 Pane"
          title="刷新当前 Pane"
          disabled={activeTabInstanceId === undefined}
          onClick={() => {
            if (activeTabInstanceId !== undefined) {
              reloadPane(activeTabInstanceId);
            }
          }}
          data-pane-icon-button
          style={{
            ...buttonStyle,
            display: "grid",
            placeItems: "center",
            padding: "4px",
            opacity: activeTabInstanceId === undefined ? .4 : 1,
          }}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
        {config.showCommandPalette !== false ? <button type="button" aria-label="打开 Pane 切换器" title="Ctrl/Cmd+K" onClick={(event) => openPaletteMenu(event.currentTarget)}
          data-pane-icon-button
          style={{ ...buttonStyle, display: "grid", placeItems: "center", border: "1px solid hsl(var(--border))", padding: "4px" }}>
          <Command size={14} aria-hidden />
        </button> : null}
      </header>
      {hostError !== undefined ? <div role="alert" data-pane-host-error={hostError.code} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 10px", background: "hsl(var(--destructive) / .1)", color: "hsl(var(--destructive))", fontSize: 12 }}><span>{hostError.message}</span><button type="button" aria-label="关闭错误提示" onClick={() => setHostError(undefined)} style={{ ...buttonStyle, display: "grid", placeItems: "center" }}><X size={14} aria-hidden /></button></div> : null}
      {/*
        content-well：iframe 直接填井；native child 叠在井上（Rust 按井几何 set_bounds）。
        结构与 iframe 一致，仅载体不同。
      */}
      <div
        ref={setContentWell}
        data-panes-content-well
        style={{ position: "relative", flex: 1, minHeight: 0 }}
      >
        {tabInstances.length === 0 ? <div style={{ height: "100%", display: "grid", placeItems: "center", color: "hsl(var(--muted-foreground))" }}><button type="button" onClick={(event) => openPaletteMenu(event.currentTarget)} style={{ ...buttonStyle, border: "1px solid hsl(var(--border))", padding: "8px 12px" }}>打开一个 Pane</button></div> : null}
        {workspace.instances.map((instance) => {
          const pane = paneById(definition, instance.paneId);
          const active =
            instance.instanceId === workspace.activeInstanceId &&
            !parkedInstanceIds.has(instance.instanceId);
          if (nativeAdapter !== undefined && pane.document.kind === "html") {
            return <NativePaneCarrier
              key={`${instance.instanceId}:${instance.epoch}`}
              instance={instance}
              pane={pane}
              active={active}
              ready={nativeReadyKeys.has(`${instance.instanceId}:${instance.epoch}`)}
              shown={nativeShownKeys.has(`${instance.instanceId}:${instance.epoch}`)}
              error={nativeErrors.get(instance.instanceId)}
              onReload={() => reloadPane(instance.instanceId)}
              mount={mountNativePane}
            />;
          }
          return <iframe key={`${instance.instanceId}:${instance.epoch}`} id={`pane-view-${instance.instanceId}`}
            ref={(node) => { if (node === null) frames.current.delete(instance.instanceId); else frames.current.set(instance.instanceId, node); }}
            title={pane.title}
            data-pane-carrier="iframe"
            sandbox={`allow-scripts${pane.capabilities.downloads ? " allow-downloads" : ""}`}
            referrerPolicy="no-referrer"
            {...(pane.document.kind === "inline" ? { srcDoc: pane.document.srcDoc } : { src: pane.document.src })}
            style={{ display: active ? "block" : "none", width: "100%", height: "100%", border: 0 }} />;
        })}
        {/* 非 native：更多 tab 蒙版贴 content-well */}
        {tabMenuOpen && hiddenInstances.length > 0 ? (
          <div
            role="presentation"
            onMouseDown={closeChromeMenus}
            style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgb(0 0 0 / .32)" }}
          >
            <div
              role="menu"
              aria-label="更多 Pane"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                zIndex: 41,
                minWidth: 180,
                padding: 4,
                border: "1px solid hsl(var(--border))",
                borderRadius: 9,
                background: "hsl(var(--popover))",
                boxShadow: "0 12px 30px rgb(0 0 0 / .16)",
              }}
            >
              {hiddenInstances.map((instance) => {
                const pane = paneById(definition, instance.paneId);
                const selected = instance.instanceId === workspace.activeInstanceId;
                return (
                  <button
                    key={instance.instanceId}
                    type="button"
                    role="menuitem"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      dispatch({ type: "activate", instanceId: instance.instanceId });
                      if (nativeErrors.has(instance.instanceId)) {
                        reloadPane(instance.instanceId);
                      }
                      closeChromeMenus();
                    }}
                    data-pane-palette-item
                    data-pane-tab-selected={selected ? "true" : "false"}
                    style={{
                      ...buttonStyle,
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "7px 9px",
                      textAlign: "left",
                      background: selected ? "hsl(var(--muted))" : "transparent",
                      color: selected ? "hsl(var(--foreground))" : undefined,
                      fontWeight: selected ? 500 : undefined,
                    }}
                  >
                    <PaneIcon name={pane.icon} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pane.title}</span>
                    {selected ? <span aria-hidden="true" style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {/* 非 native：新开 Pane 蒙版贴 content-well（与 native overlay 槽一致） */}
        {paletteOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="新开 Pane"
            onMouseDown={closeChromeMenus}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 40,
              display: "grid",
              placeItems: "start center",
              paddingTop: 48,
              background: "rgb(0 0 0 / .32)",
            }}
          >
            <div
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                width: "min(320px, calc(100% - 24px))",
                padding: 8,
                border: "1px solid hsl(var(--border))",
                borderRadius: 12,
                background: "hsl(var(--popover, var(--background)))",
                boxShadow: "0 18px 45px rgb(0 0 0 / .18)",
              }}
            >
              <strong style={{ display: "block", padding: "7px 10px" }}>新开 Pane</strong>
              {definition.panes.map((pane, index) => {
                const openCount = workspace.instances.filter((instance) => instance.paneId === pane.id).length;
                const parked = workspace.instances.some(
                  (instance) =>
                    instance.paneId === pane.id &&
                    parkedInstanceIds.has(instance.instanceId),
                );
                const disabled =
                  !parked &&
                  (openCount >= pane.maxInstances ||
                    workspace.instances.length >= definition.maxOpenPanes);
                return (
                  <button
                    key={pane.id}
                    type="button"
                    autoFocus={index === 0}
                    disabled={disabled}
                    onClick={() => openPane(pane.id)}
                    data-pane-palette-item
                    style={{
                      ...buttonStyle,
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "9px 10px",
                      textAlign: "left",
                      opacity: disabled ? 0.45 : 1,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <PaneIcon name={pane.icon} />
                      {pane.title}
                    </span>
                    <span>
                      {pane.maxInstances === UNLIMITED_PANE_COUNT
                        ? `已开 ${openCount}`
                        : `${openCount}/${pane.maxInstances}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

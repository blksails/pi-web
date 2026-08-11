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
import { HOST_PANE_ID_PREFIX } from "../merge.js";
import {
  createPaneWorkspace,
  reconcilePaneWorkspace,
  reducePaneWorkspace,
  type PaneWorkspaceAction,
  type PaneWorkspaceState,
} from "../instances.js";
import { fromMessagePort, type PanePort, type PaneViewHandle } from "../host-ports.js";
import {
  createGlobalTauriPaneViewAdapter,
  ensureTauriContentWellMetrics,
  isTauriNativePaneLayout,
  publishTauriContentWellMetrics,
  tauriPaneDocumentUrl,
} from "../adapters/tauri-runtime.js";
import type { TauriPaneMountTarget } from "../adapters/tauri.js";
import { isPanesHostChromeHidden } from "../host-presence.js";
import { shouldShowNativePane } from "./native-show-gate.js";
import { PaneLoadingSkeleton } from "./pane-guest.js";
import {
  PANES_WORKSPACE_DOMAIN,
  PanesWorkspaceSnapshotSchema,
  type PaneWorkspaceOp,
} from "../workspace-protocol.js";
import {
  PANE_CHROME_SIGNAL,
  withDefaultPaneChrome,
  type PaneChromeWorkspaceSignal,
} from "../pane-chrome.js";
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
  stageUserMessage?(text: string, options?: { readonly attachmentIds?: readonly string[] }): void;
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): void | Promise<void>;
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
  /**
   * 写入本快照时 definition 中的**全部** pane id。
   *
   * `knownPaneIds − paneIds` 即「用户见过却选择不开」的集合 —— 快照本身只记「开着哪些」,
   * 分不出「用户主动关掉的」与「因清单尚未补齐而没来得及打开的」,这个字段就是那条分界线。
   *
   * 可选:旧快照没有它。旧代码读到带该字段的新快照会忽略它(行为不变);新代码读到旧快照
   * 则走 {@link restoredPaneWorkspace} 里的降级判定。
   */
  readonly knownPaneIds?: readonly string[];
}

/** {@link restoredPaneWorkspace} 的返回:workspace 之外还要把快照里的已知全集带出给 reconcile 用。 */
interface RestoredWorkspace {
  readonly workspace: PaneWorkspaceState;
  readonly knownPaneIds: readonly string[] | undefined;
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

/**
 * 判定一份**旧格式**快照(无 `knownPaneIds`)是否可确证为缺陷产物。
 *
 * 缺陷会留下唯一形态的快照:清单尚未补齐时 workspace 只开出宿主内置 pane 并就此写盘。
 * 判据刻意收窄到该形态 —— 旧快照分不出用户意图,宁可少纠正,不可乱纠正(Req 3.3)。
 *
 * 不必再单独检查「agent 初始 pane 是否已在快照里」:条件二已保证快照里全是内置前缀,
 * 而 agent 的 pane 用该前缀会被 `mergePaneSources` 直接拒绝,两者在结构上不可能相交。
 */
function isProvablyPollutedSnapshot(
  definition: PanesDefinition,
  savedPaneIds: readonly unknown[],
): boolean {
  const saved = savedPaneIds.filter((id): id is string => typeof id === "string");
  // 一:快照非空(空快照走既有的 missing paneIds 分支,不归这里管)。
  if (saved.length === 0) return false;
  // 二:快照里**没有任何** agent pane —— 正常使用中用户不会把 agent pane 全关掉却恰好只留内置的。
  if (!saved.every((paneId) => paneId.startsWith(HOST_PANE_ID_PREFIX))) return false;
  // 三:当前清单确实声明了 agent 侧的初始 pane(否则无所谓「被污染」,例如纯内置 pane 的会话)。
  const agentInitial = (definition.initialPaneIds ?? []).filter(
    (paneId) => !paneId.startsWith(HOST_PANE_ID_PREFIX),
  );
  return agentInitial.length > 0;
}

function restoredPaneWorkspace(
  definition: PanesDefinition,
  idFactory: (paneId: string) => string,
  persistenceKey?: string,
): RestoredWorkspace {
  if (persistenceKey === undefined || typeof window === "undefined") {
    return {
      workspace: createPaneWorkspace(definition, (paneId) => idFactory(paneId)),
      knownPaneIds: undefined,
    };
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(`${persistenceKey}:workspace`) ?? "null") as PersistedPaneWorkspace | null;
    if (!Array.isArray(saved?.paneIds)) throw new Error("missing paneIds");
    const knownPaneIds = Array.isArray(saved.knownPaneIds)
      ? saved.knownPaneIds.filter((id): id is string => typeof id === "string")
      : undefined;
    // 旧格式快照且可确证被污染 → 丢弃它,按当前清单的初始集合重建。随后写出的新格式快照
    // 会带上 knownPaneIds,故纠正只发生这一次(Req 3.2)。
    if (knownPaneIds === undefined && isProvablyPollutedSnapshot(definition, saved.paneIds)) {
      return {
        workspace: createPaneWorkspace(definition, (paneId) => idFactory(paneId)),
        knownPaneIds: undefined,
      };
    }
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
    const workspace = active === undefined
      ? restored
      : reducePaneWorkspace(definition, restored, { type: "activate", instanceId: active.instanceId });
    return { workspace, knownPaneIds };
  } catch {
    return {
      workspace: createPaneWorkspace(definition, (paneId) => idFactory(paneId)),
      knownPaneIds: undefined,
    };
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
  "--background", "--foreground", "--canvas", "--sidebar",
  "--surface", "--surface-subtle",
  "--card", "--card-foreground",
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
  definition: definitionInput,
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
  // ★ 默认包装器在 Host 入口：凡 inline 文档统一装 chrome，业务侧不必自觉 wrap。
  //   URL 形态由 native initialization_script boot 兜底；宿主内置应优先 inline。
  const definition = React.useMemo(
    () => withDefaultPaneChrome(definitionInput),
    [definitionInput],
  );
  const sequence = React.useRef(0);
  const nextId = React.useCallback((paneId: string) => createInstanceId(paneId, ++sequence.current), [createInstanceId]);
  // 恢复只发生一次(mount)。除 workspace 外还要留住快照里的「已知全集」——definition 后续补齐时
  // 靠它区分「用户主动关掉的」与「因清单尚未到达而没来得及打开的」。
  const [restored] = React.useState(() =>
    restoredPaneWorkspace(definition, (paneId) => nextId(paneId), config.persistenceKey));
  const [workspace, setWorkspace] = React.useState<PaneWorkspaceState>(restored.workspace);
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  /** 最近一次写盘快照所记录的已知全集;每次持久化后更新,供下一轮补齐判定使用。 */
  const knownPaneIdsRef = React.useRef<readonly string[] | undefined>(restored.knownPaneIds);
  const [parkedInstanceIds, setParkedInstanceIds] =
    React.useState<ReadonlySet<string>>(() => new Set());
  const parkedRef = React.useRef(parkedInstanceIds);
  parkedRef.current = parkedInstanceIds;
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [tabMenuOpen, setTabMenuOpen] = React.useState(false);
  const chromeReturnFocusRef = React.useRef<HTMLElement | null>(null);
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
  // mountNativePane 的回调闭包会捕获渲染期的值；用 ref 取当前值，避免 show 门控读到陈旧的 false。
  const nativeLayoutActiveRef = React.useRef(false);
  nativeLayoutActiveRef.current = nativeLayoutActive;
  const nativeAdapter = React.useMemo(
    () => typeof window === "undefined" ? undefined : createGlobalTauriPaneViewAdapter(window),
    [],
  );
  // child WebView 只盖 content-well；chrome 已移入 pane 内边车。量井上报 left/top/width/bottom。
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

  // definition 换了要做的两件事,合在同一个 effect 里:
  //  ① 清理瞬时错误；并剔除「清单里已不存在的 pane」的残留 park 标记。
  //  ② 把清单里新出现、且声明为初始打开的 pane 补进已打开集合。
  //
  // ★ 为什么必须有 ②:workspace 由 useState 惰性初始化建立,**只在首次 mount 跑一次**。
  //   经在线解析装载的 webext 是异步到达的,首帧清单里只有宿主内置 pane —— 没有 ② 的话
  //   workspace 就此定型,agent 声明的 pane 永远打不开(且该结果还会被写进持久化快照)。
  React.useEffect(() => {
    const paneIds = new Set(definition.panes.map((pane) => pane.id));
    setParkedInstanceIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const instanceId of current) {
        const inst = workspaceRef.current.instances.find(
          (instance) => instance.instanceId === instanceId,
        );
        if (inst !== undefined && paneIds.has(inst.paneId)) next.add(instanceId);
        else changed = true;
      }
      return changed || next.size !== current.size ? next : current;
    });
    setNativeErrors(new Map());
    setHostError(undefined);
    // 读 ref 而非 workspace:把 workspace 放进依赖会让本 effect 随每次面板操作重跑。
    const current = workspaceRef.current;
    const next = reconcilePaneWorkspace({
      definition,
      state: current,
      knownPaneIds: knownPaneIdsRef.current,
      idFactory: (paneId) => nextId(paneId),
    });
    // 无可补开时 reconcile 返回同一引用 —— 据此跳过 setState,避免每次 definition
    // 变化都白重渲染一轮(首帧清单即完整的 agent 走的正是这条路)。
    if (next !== current) setWorkspace(next);
  }, [definition, nextId]);

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
    // knownPaneIds 必须与 paneIds 在**同一次 setItem** 中写出,否则会留下撕裂快照
    // (打开集合是新的、已知全集是旧的),下一轮补齐判定就会据此得出错误的用户意图。
    const knownPaneIds = definition.panes.map((pane) => pane.id);
    window.localStorage.setItem(`${config.persistenceKey}:workspace`, JSON.stringify({
      paneIds: visible.map((instance) => instance.paneId),
      instanceIds: visible.map((instance) => instance.instanceId),
      ...(activeIndex >= 0 ? { activeIndex } : {}),
      knownPaneIds,
    } satisfies PersistedPaneWorkspace));
    knownPaneIdsRef.current = knownPaneIds;
  }, [
    config.persistenceKey,
    definition,
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
    // 仅侧栏折叠等 chrome 隐藏时 hide content；面积 0 不关 content。
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

  /**
   * 真关闭：销毁连接 / native WebView，从 workspace 移除。
   * 不进「更多」；再次打开只能经新开 Pane 弹层创建新实例。
   */
  const hardClose = React.useCallback((instanceId: string): void => {
    const current = workspaceRef.current;
    const hit = current.instances.find((instance) => instance.instanceId === instanceId);
    if (hit === undefined) return;
    const mount = nativeMounts.current.get(instanceId);
    if (mount !== undefined) {
      mount.disposed = true;
      if (mount.disposeTimeout !== undefined) clearTimeout(mount.disposeTimeout);
      if (mount.readyTimeout !== undefined) clearTimeout(mount.readyTimeout);
      mount.stopReady?.();
      mount.handle?.hide();
      mount.handle?.dispose();
      nativeMounts.current.delete(instanceId);
    }
    closeConnection(instanceId, true);
    if (parkedRef.current.has(instanceId)) {
      const nextParked = new Set(parkedRef.current);
      nextParked.delete(instanceId);
      parkedRef.current = nextParked;
      setParkedInstanceIds(nextParked);
    }
    setNativeReadyKeys((keys) => {
      const next = new Set([...keys].filter((key) => !key.startsWith(`${instanceId}:`)));
      return next.size === keys.size ? keys : next;
    });
    setNativeShownKeys((keys) => {
      const next = new Set([...keys].filter((key) => !key.startsWith(`${instanceId}:`)));
      return next.size === keys.size ? keys : next;
    });
    setNativeErrors((errors) => {
      if (!errors.has(instanceId)) return errors;
      const next = new Map(errors);
      next.delete(instanceId);
      return next;
    });
    dispatch({ type: "close", instanceId });
  }, [closeConnection, dispatch]);

  const applyActivateOrReload = React.useCallback(
    (
      type: "activate" | "reload" | "close",
      target: { instanceId?: string; paneId?: string },
    ): void => {
      const current = workspaceRef.current;
      const hit =
        target.instanceId !== undefined
          ? current.instances.find((i) => i.instanceId === target.instanceId)
          : target.paneId !== undefined
            ? current.instances.find((i) => i.paneId === target.paneId)
            : current.activeInstanceId !== undefined
              ? current.instances.find((i) => i.instanceId === current.activeInstanceId)
              : undefined;
      if (hit === undefined) return;
      if (type === "close") {
        hardClose(hit.instanceId);
        return;
      }
      if (type === "activate") {
        // 兼容旧 park 快照：若仍在 parked 集合则先放出再激活。
        setParkedInstanceIds((parked) => {
          if (!parked.has(hit.instanceId)) return parked;
          const next = new Set(parked);
          next.delete(hit.instanceId);
          parkedRef.current = next;
          return next;
        });
        dispatch({ type: "activate", instanceId: hit.instanceId });
        return;
      }
      dispatch({ type: "reload", instanceId: hit.instanceId });
    },
    [dispatch, hardClose],
  );

  /** 供 handleRequest 闭包调用（reloadPane 定义在后）。 */
  const reloadPaneRef = React.useRef<(instanceId: string) => void>(() => undefined);

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
    if (
      request.operation === "workspace.open" ||
      request.operation === "workspace.activate" ||
      request.operation === "workspace.close" ||
      request.operation === "workspace.reload" ||
      request.operation === "workspace.collapse"
    ) {
      if (request.operation === "workspace.collapse") {
        onRequestClose?.();
        return undefined;
      }
      if (request.operation === "workspace.open") {
        applyOpenPane(request.paneId);
        return undefined;
      }
      if (request.operation === "workspace.close") {
        // 边车 X / 遥控 close = 真关闭：销毁实例；仅新开 Pane 可再建。
        const id = request.instanceId
          ?? workspaceRef.current.activeInstanceId;
        if (id !== undefined) hardClose(id);
        return undefined;
      }
      if (request.operation === "workspace.reload") {
        // 必须走 reloadPane：native 调 handle.reload / 抬 epoch 整页重建
        const id = request.instanceId
          ?? workspaceRef.current.activeInstanceId;
        if (id !== undefined) reloadPaneRef.current(id);
        return undefined;
      }
      applyActivateOrReload("activate", {
        paneId: request.paneId,
        instanceId: request.instanceId,
      });
      return undefined;
    }
    if (conversation === undefined) throw new PaneHostError("HOST_UNAVAILABLE", "Conversation is not ready", { retryable: true });
    const options = request.attachmentIds === undefined ? undefined : { attachmentIds: request.attachmentIds };
    if (request.operation === "conversation.stage") {
      if (conversation.stageUserMessage === undefined) {
        throw new PaneHostError("HOST_UNAVAILABLE", "Conversation draft is not ready", { retryable: true });
      }
      conversation.stageUserMessage(request.text, options);
    } else await conversation.submitUserMessage(request.text, options);
    return undefined;
  }, [applyActivateOrReload, applyOpenPane, baseUrl, config.eventTargets, conversation, definition, hardClose, onEvent, onRequestClose, sessionId, sessionLogs, surface, upload]);

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

  const chromeSignal = React.useCallback((): PaneChromeWorkspaceSignal => {
    const instances = workspace.instances.map((instance) => {
      const parked = parkedInstanceIds.has(instance.instanceId);
      return {
        instanceId: instance.instanceId,
        paneId: instance.paneId,
        state: parked ? ("hidden" as const) : ("open" as const),
        active:
          instance.instanceId === workspace.activeInstanceId && !parked,
      };
    });
    const panes = definition.panes.map((pane) => ({
      paneId: pane.id,
      title: pane.title,
      // 关闭即从 instances 移除；openCount = 当前真实打开数。
      openCount: workspace.instances.filter(
        (instance) =>
          instance.paneId === pane.id &&
          !parkedInstanceIds.has(instance.instanceId),
      ).length,
      // Infinity 不能进 JSON；边车用大数表示不限
      maxInstances: Number.isFinite(pane.maxInstances) ? pane.maxInstances : 1_000_000_000,
      allowMultiple: pane.allowMultiple,
    }));
    // 边车依 activeInstanceId 判定当前 tab；若 active 已不在 open 集合则取首个 open。
    const activeOpen =
      workspace.activeInstanceId !== undefined &&
      !parkedInstanceIds.has(workspace.activeInstanceId)
        ? workspace.activeInstanceId
        : instances.find((instance) => instance.state === "open")?.instanceId;
    return {
      ...(activeOpen !== undefined ? { activeInstanceId: activeOpen } : {}),
      // 收起钮进 child 边车，宿主不再占顶栏高度 → child 满格。
      ...(onRequestClose !== undefined ? { canCollapse: true as const } : {}),
      panes,
      instances,
    };
  }, [definition.panes, onRequestClose, parkedInstanceIds, workspace.activeInstanceId, workspace.instances]);

  // 快照去重：父组件若每帧换 definition 引用，不可对 N 个 WebView 每帧 fan-out（会卡死 UI 线程）。
  const lastChromeSignalKey = React.useRef<string>("");
  const broadcastChromeSignal = React.useCallback((force = false): void => {
    const value = chromeSignal();
    const key = JSON.stringify(value);
    if (!force && key === lastChromeSignalKey.current) return;
    lastChromeSignalKey.current = key;
    for (const live of connections.current.values()) {
      live.port.post({ type: "pane:signal", name: PANE_CHROME_SIGNAL, value } satisfies PaneHostMessage);
    }
  }, [chromeSignal]);

  const pushAllSignals = React.useCallback((port: PanePort): void => {
    for (const [name, value] of Object.entries(signals ?? {})) {
      port.post({ type: "pane:signal", name, value } satisfies PaneHostMessage);
    }
    // 新连接必须收到当前 tabs 快照（即使与上次广播 key 相同）。
    port.post({ type: "pane:signal", name: PANE_CHROME_SIGNAL, value: chromeSignal() } satisfies PaneHostMessage);
  }, [chromeSignal, signals]);

  // workspace 真实变化 → 向全部已连接 iframe/native WebView 广播同一份 tabs 快照。
  React.useEffect(() => {
    broadcastChromeSignal(false);
  }, [broadcastChromeSignal]);

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
    // 先 connected 再建 MessageChannel，再推 signals；否则首包 pi.workspace 在 guest 被丢。
    sendConnected({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: instance.instanceId, paneId: instance.paneId, epoch: instance.epoch },
      grants: pane.capabilities,
      interactionMode: config.interactionMode ?? "standard",
      theme: readPaneTheme(hostRoot.current ?? document.documentElement),
    } satisfies PaneHostMessage);
    pushAllSignals(port);
    // 边车 chrome 可能晚于 guest 才挂上 port 监听；MessagePort 不重放已投递帧。
    // 微任务 + 短延迟再推一次 workspace 快照，保证首进 agent 顶栏不空白。
    const chromeValue = chromeSignal();
    queueMicrotask(() => {
      if (connections.current.get(instance.instanceId)?.port !== port) return;
      port.post({ type: "pane:signal", name: PANE_CHROME_SIGNAL, value: chromeValue } satisfies PaneHostMessage);
    });
    window.setTimeout(() => {
      if (connections.current.get(instance.instanceId)?.port !== port) return;
      port.post({
        type: "pane:signal",
        name: PANE_CHROME_SIGNAL,
        value: chromeSignal(),
      } satisfies PaneHostMessage);
    }, 80);
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
  }, [bindState, bindSurface, chromeSignal, closeConnection, config.interactionMode, definition, handleRequest, onHostError, pushAllSignals]);

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
      if (instance === undefined) return;
      // chrome 与 guest 都可能发 ready。已连接时：仅 guest 重挂（同 epoch 再 ready）强制重建。
      // 用「最近一次 connected 后的短窗」防 chrome 周期 ready 刷屏：已有连接且 port 仍可用则忽略。
      // guest 同 epoch 重建由测试/重挂显式再发 ready 且 contentWindow 仍匹配 → 仍 force。
      // 区分：chrome 周期 ready 在 bindPort 后会 stop；若仍到达，说明未绑上，应重建。
      connectFrame(instance, true);
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
      url: tauriPaneDocumentUrl(pane.document, instance.instanceId, pane.id),
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
            // ★ 几何已送达是 show 的**前置条件**（spec desktop-pane-chrome-occlusion，Req 4.2）。
            //   改动前这里不看量槽结果：量不到也照样 show，pane 遂停在布局侧的默认矩形上
            //   （y=0、铺满全高），恰好盖住 tab 栏——用户随即失去切换 pane 的唯一入口。
            //
            //   几何迟到（首帧尚未布局）不是失败，只是还没轮到：逐帧重试若干次，
            //   一旦送达就落位并 show（Req 2.3/4.3）。始终没送达则不 show——
            //   宁可 pane 暂不可见，也不吃掉用户的恢复手段。
            //   ★ 门控只在 native 布局真正生效时才成立：非 native 时 Rust 并不拥有 child 的
            //   bounds（走旧的浮层载体），也就不存在「盖住 chrome 的槽」，此时要求几何先到
            //   毫无意义，只会在 jsdom / 回退形态下白白挡住 show。
            //   注意载体门（有 __TAURI__ 即用 native 载体）与几何门（pane_layout_is_native）
            //   是两个门，此处按后者判断——前者为真而后者为假，正是本缺陷的可疑触发条件之一。
            const needsGeometry = nativeLayoutActiveRef.current;
            let geometryReady = well === null || !needsGeometry;
            if (well !== null) {
              for (let attempt = 0; attempt < 8; attempt += 1) {
                const outcome = await ensureTauriContentWellMetrics(well, {
                  minWidth: 240,
                  force: true,
                  // 首 show 前最多 4 帧稳一次；之后拖拽只 RO→publish。
                  settle: attempt === 0,
                });
                if (outcome.kind === "delivered" || outcome.kind === "skipped-unchanged") {
                  geometryReady = true;
                  break;
                }
                // 不需要门控时只量一次就走，别在回退形态下空转 8 帧。
                if (!needsGeometry) break;
                await new Promise<void>((resolve) => {
                  window.requestAnimationFrame(() => resolve());
                });
              }
            }
            if (
              shouldShowNativePane({
                chromeVisible: hostChromeOk,
                requiresGeometry: needsGeometry,
                geometry: geometryReady ? "delivered" : "pending",
                isActiveInstance:
                  workspaceRef.current.activeInstanceId === instance.instanceId,
                isParked: parkedRef.current.has(instance.instanceId),
              })
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
    closeChromeMenus();
  };

  const closePane = (instanceId: string): void => {
    hardClose(instanceId);
  };

  const reloadPane = (instanceId: string): void => {
    const instance = workspaceRef.current.instances.find(
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
        // WebView 整页 reload；guest 再 pane:ready → 重绑
        mount.handle.reload();
        return;
      }
    }
    // iframe：抬 epoch 换文档
    closeConnection(instanceId, false);
    dispatch({ type: "reload", instanceId });
  };
  reloadPaneRef.current = reloadPane;

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
   * 新开 Pane / 更多 tab：DOM 蒙版盖在 content-well 上。
   */
  const openPaletteMenu = (anchor?: Element): void => {
    const active = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    chromeReturnFocusRef.current =
      anchor instanceof HTMLElement && anchor !== hostRoot.current ? anchor : active;
    setTabMenuOpen(false);
    setPaletteOpen(true);
  };
  openPaletteRequestRef.current = openPaletteMenu;
  const openHiddenTabsMenu = (anchor: Element): void => {
    chromeReturnFocusRef.current = anchor instanceof HTMLElement ? anchor : null;
    setPaletteOpen(false);
    setTabMenuOpen(true);
  };
  const closeChromeMenus = (): void => {
    setPaletteOpen(false);
    setTabMenuOpen(false);
    const target = chromeReturnFocusRef.current;
    chromeReturnFocusRef.current = null;
    if (target !== null) {
      requestAnimationFrame(() => target.focus());
    }
  };

  React.useEffect(() => {
    if (!paletteOpen && !tabMenuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeChromeMenus();
    };
    window.addEventListener("keydown", onKeyDown);
    const firstItem = hostRoot.current?.querySelector<HTMLElement>(
      '[data-pane-palette-item]:not(:disabled)',
    );
    firstItem?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, tabMenuOpen]);

  return (
    <section
      ref={hostRoot}
      data-panes-host
      data-panes-carrier={nativeAdapter !== undefined ? "tauri-webview" : "iframe"}
      className={className}
      style={{ position: "relative", height: "100%", minHeight: 0, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
    >
      <style>{hostInteractionStyles}</style>
      {hostError !== undefined ? (
        <div
          role="alert"
          data-pane-host-error={hostError.code}
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: 0,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            padding: "7px 10px",
            background: "hsl(var(--destructive) / .1)",
            color: "hsl(var(--destructive))",
            fontSize: 12,
          }}
        >
          <span>{hostError.message}</span>
          <button type="button" aria-label="关闭错误提示" onClick={() => setHostError(undefined)} style={{ ...buttonStyle, display: "grid", placeItems: "center" }}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {/*
        content-well 满铺 host：chrome 在 child 文档内，native child 叠满井 = 满格高度。
        宿主不再渲染顶栏 tabs（会从井高里偷像素）。
      */}
      <div
        ref={setContentWell}
        data-panes-content-well
        style={{ position: "absolute", inset: 0 }}
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
            ref={(node) => {
              if (node === null) frames.current.delete(instance.instanceId);
              else frames.current.set(instance.instanceId, node);
            }}
            title={pane.title}
            data-pane-carrier="iframe"
            sandbox={`allow-scripts${pane.capabilities.downloads ? " allow-downloads" : ""}`}
            referrerPolicy="no-referrer"
            onLoad={() => {
              // load 可能晚于 instances effect；已同 epoch 连接则不动（避免双连）。
              // 未连上时补连：无 guest 的 pane 靠 chrome pane:ready + 此处兜底。
              if (connections.current.get(instance.instanceId)?.epoch === instance.epoch) return;
              connectFrame(instance, true);
            }}
            {...(pane.document.kind === "inline"
              // 文档已在 withDefaultPaneChrome 入口包装（含 paneId 握手），勿重复。
              ? { srcDoc: pane.document.srcDoc }
              : { src: pane.document.src })}
            style={{ display: active ? "block" : "none", width: "100%", height: "100%", border: 0 }} />;
        })}
        {/* 非 native：更多 tab 蒙版贴 content-well */}
        {tabMenuOpen && hiddenInstances.length > 0 ? (
          <div
            role="presentation"
            onMouseDown={closeChromeMenus}
            style={{ position: "absolute", inset: 0, zIndex: 40, background: "hsl(var(--foreground) / .32)" }}
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
                borderRadius: 10,
                background: "hsl(var(--popover))",
                boxShadow: "0 12px 30px hsl(var(--foreground) / .14)",
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
        {/* 新开 Pane 蒙版贴 content-well */}
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
              background: "hsl(var(--foreground) / .32)",
            }}
          >
            <div
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                width: "min(320px, calc(100% - 24px))",
                padding: 8,
                border: "1px solid hsl(var(--border))",
                borderRadius: 10,
                background: "hsl(var(--popover, var(--background)))",
                boxShadow: "0 16px 48px hsl(var(--foreground) / .16)",
              }}
            >
              <strong style={{ display: "block", padding: "7px 10px" }}>新开 Pane</strong>
              {definition.panes.map((pane, index) => {
                const openCount = workspace.instances.filter(
                  (instance) =>
                    instance.paneId === pane.id &&
                    !parkedInstanceIds.has(instance.instanceId),
                ).length;
                const disabled =
                  openCount >= pane.maxInstances ||
                  workspace.instances.filter(
                    (instance) => !parkedInstanceIds.has(instance.instanceId),
                  ).length >= definition.maxOpenPanes;
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

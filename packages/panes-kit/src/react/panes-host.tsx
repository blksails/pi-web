import * as React from "react";
import { Command, Plus, X } from "lucide-react";
import {
  PaneGuestRequestSchema,
  PANE_PROTOCOL_VERSION,
  UNLIMITED_PANE_COUNT,
  type PaneCapabilities,
  type PaneDefinition,
  type PaneGuestRequest,
  type PaneHostMessage,
  type PaneInstance,
  type PanesDefinition,
} from "../contract.js";
import { authorizePaneRequest, DEFAULT_PANE_RESPONSE_BYTES } from "../authorization.js";
import { bindPaneState } from "../state-binding.js";
import { createAgentRouteClient } from "../agent-routes.js";
import { asPaneHostError, PaneHostError } from "../errors.js";
import { createPaneWorkspace, reducePaneWorkspace, type PaneWorkspaceAction } from "../instances.js";
import {
  PANES_WORKSPACE_DOMAIN,
  PanesWorkspaceSnapshotSchema,
  type PaneWorkspaceOp,
} from "../workspace-protocol.js";

export interface PanesSurfaceAccess {
  run(domain: string, action: string, args?: unknown): Promise<unknown>;
  getState<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  hasCommand(name: string): boolean;
}

/**
 * 会话级共享状态的宿主侧接入(spec panes-only-right-panel Req 2)。
 *
 * 四操作与宿主既有的共享状态访问器**逐一对应**,使迁移方只改取得途径、不改调用形状。
 * 与 `PanesSurfaceAccess` 的分工:后者是 agent 权威快照(只读),这里是人与 agent 双向读写的
 * 会话级 KV。
 */
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

export interface PanesConversationAccess {
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): void;
}

export interface PanesHostConfig {
  readonly interactionMode?: "standard" | "advanced";
  readonly allowTabReorder?: boolean;
  readonly showCommandPalette?: boolean;
  /** 可选 UI 编排：事件发布后激活已打开的目标 pane；不参与数据中继授权。 */
  readonly eventTargets?: Readonly<Record<string, string>>;
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
  /**
   * 宿主 → pane 的具名信号(见 contract 的 `pane:signal`):搬运**只存在于宿主 realm**
   * 的东西 —— 主题类、宿主 chrome 上的点击、轮次边沿。它们既不属于 agent 权威状态
   * (那走 `surfaceKeys`),pane 自己也观察不到(iframe 是独立 document)。
   *
   * 语义是**最后值即真值**:值变即广播给全部在世 pane;新建连接时重推全部当前值,
   * 故 pane 晚连、重连、刷新后重建都不会丢。传入对象按 key 逐个浅比较,未变的不推。
   */
  readonly signals?: Readonly<Record<string, unknown>>;
  readonly className?: string;
  readonly onHostError?: (error: PaneHostError) => void;
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
  /** 重绑 surface 订阅时要按 paneId 取回该 pane 的授权 key 集。 */
  readonly paneId: string;
  readonly port: MessagePort;
  /** ★ 可变:`surface` 换身份时整组退订重绑(见 bindSurface)。 */
  cleanup: Array<() => void>;
  /** ★ 与 surface 的清理**分开持有**:合并会导致一方换身份时顺手退掉另一方却不重建。 */
  stateCleanup?: () => void;
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

const hostInteractionStyles = `
[data-panes-host] button { transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease; }
[data-panes-host] button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
[data-panes-host] [data-pane-icon-button]:hover,
[data-panes-host] [data-pane-tab]:hover,
[data-panes-host] [data-pane-palette-item]:hover:not(:disabled) {
  background: hsl(var(--accent)) !important;
  color: hsl(var(--foreground)) !important;
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
  createInstanceId = defaultInstanceId,
  workspaceDomain = PANES_WORKSPACE_DOMAIN,
}: PanesHostProps): React.JSX.Element {
  const sequence = React.useRef(0);
  const nextId = React.useCallback((paneId: string) => createInstanceId(paneId, ++sequence.current), [createInstanceId]);
  const [workspace, setWorkspace] = React.useState(() => createPaneWorkspace(definition, (paneId) => nextId(paneId)));
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [draggedId, setDraggedId] = React.useState<string>();
  const [hostError, setHostError] = React.useState<PaneHostError>();
  const frames = React.useRef(new Map<string, HTMLIFrameElement>());
  const connections = React.useRef(new Map<string, LiveConnection>());
  const advanced = config.interactionMode === "advanced";

  const dispatch = React.useCallback((action: PaneWorkspaceAction): void => {
    setWorkspace((current) => reducePaneWorkspace(definition, current, action));
  }, [definition]);

  const closeConnection = React.useCallback((instanceId: string, lifecycle = true): void => {
    const live = connections.current.get(instanceId);
    if (live === undefined) return;
    if (lifecycle) live.port.postMessage({ type: "pane:lifecycle", state: "closing" } satisfies PaneHostMessage);
    for (const cleanup of live.cleanup) cleanup();
    live.stateCleanup?.();
    live.port.close();
    connections.current.delete(instanceId);
  }, []);

  React.useEffect(() => () => {
    for (const instanceId of [...connections.current.keys()]) closeConnection(instanceId);
  }, [closeConnection]);

  React.useEffect(() => {
    for (const instance of workspace.instances) {
      connections.current.get(instance.instanceId)?.port.postMessage({
        type: "pane:lifecycle",
        state: instance.instanceId === workspace.activeInstanceId ? "visible" : "hidden",
      } satisfies PaneHostMessage);
    }
  }, [workspace.activeInstanceId, workspace.instances]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && config.showCommandPalette !== false) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const instance = workspace.instances[Number(event.key) - 1];
        if (instance !== undefined) dispatch({ type: "activate", instanceId: instance.instanceId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.showCommandPalette, dispatch, workspace.instances]);

  // ── LLM 工作区遥控桥(workspace-protocol.ts)────────────────────────────────
  // 下行:订阅 surface:<domain> 快照,对 opId 增量应用意图 ops;首帧取基线(不重放
  // 历史),opId 回退(agent 重启)自动再基线。上行:workspace 变化或 appliedOpId 推进
  // 时经 surface.run(<domain>,"report",…) 回声实况;内容去重,best-effort。
  const appliedOpRef = React.useRef<number | undefined>(undefined);
  const lastReportRef = React.useRef<string | undefined>(undefined);
  const snapshotSeenRef = React.useRef(false);
  const [reportTick, setReportTick] = React.useState(0);

  React.useEffect(() => {
    if (surface === undefined || workspaceDomain === false) return;
    const applyOp = (op: PaneWorkspaceOp): void => {
      if (op.type === "open") {
        if (definition.panes.some((pane) => pane.id === op.paneId)) {
          dispatch({ type: "open", paneId: op.paneId, instanceId: nextId(op.paneId) });
        }
        return;
      }
      // 目标解析放进函数式更新,使同一快照内「先 open 后 activate」的串行 ops 互相可见。
      setWorkspace((current) => {
        const target = op.instanceId !== undefined
          ? current.instances.find((instance) => instance.instanceId === op.instanceId)
          : (op.paneId !== undefined ? current.instances.find((instance) => instance.paneId === op.paneId) : undefined);
        if (target === undefined) return current;
        // close 需同步断连;closeConnection 幂等,StrictMode 双调无害。
        if (op.type === "close") closeConnection(target.instanceId);
        const action: PaneWorkspaceAction = op.type === "activate"
          ? { type: "activate", instanceId: target.instanceId }
          : op.type === "close"
            ? { type: "close", instanceId: target.instanceId }
            : { type: "reload", instanceId: target.instanceId };
        return reducePaneWorkspace(definition, current, action);
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
  }, [closeConnection, definition, dispatch, nextId, surface, workspaceDomain]);

  React.useEffect(() => {
    if (surface === undefined || workspaceDomain === false || !snapshotSeenRef.current) return;
    const report = {
      appliedOpId: appliedOpRef.current ?? 0,
      ...(workspace.activeInstanceId !== undefined ? { activeInstanceId: workspace.activeInstanceId } : {}),
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
        state: instance.state,
      })),
    };
    const encoded = JSON.stringify(report);
    if (encoded === lastReportRef.current) return;
    lastReportRef.current = encoded;
    void Promise.resolve(surface.run(workspaceDomain, "report", report)).catch(() => undefined);
  }, [definition, reportTick, surface, workspace, workspaceDomain]);

  const handleRequest = React.useCallback(async (
    instance: PaneInstance,
    pane: PaneDefinition,
    request: PaneGuestRequest,
  ): Promise<unknown> => {
    const live = connections.current.get(instance.instanceId);
    if (live?.epoch !== instance.epoch) throw new PaneHostError("STALE_INSTANCE", "Pane instance epoch is stale");
    authorizePaneRequest(pane.capabilities, request);
    if (request.operation === "route.query" || request.operation === "route.mutate") {
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
      const current = workspaceRef.current;
      for (const target of current.instances) {
        const targetPane = paneById(definition, target.paneId);
        if (!targetPane.capabilities.events.subscribe.includes(request.topic)) continue;
        const targetLive = connections.current.get(target.instanceId);
        if (targetLive?.epoch !== target.epoch) continue;
        targetLive.port.postMessage({
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
      // 只有**写回**走上行请求;读与订阅由宿主按授权键主动推 `pane:state`(任务 1.2)。
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
    // ★ `state` 刻意**不在** deps 里 —— 见 stateRef 处的说明(它换身份会导致连接重建)。
  }, [baseUrl, config.eventTargets, conversation, definition, sessionId, surface, upload]);

  /**
   * 绑定(或**重新**绑定)某条连接的 surface 订阅。
   *
   * ★ 为什么必须能重绑:`surface` 不是恒等对象。宿主的 `WebExtSurfaceAccess` 通常由
   * `useMemo` 依赖会话连接/命令表构造 —— 就绪握手、控制流重开都会换出新实例,而新实例读的是
   * **新的** state store。建连那一刻绑定的订阅会挂在旧 store 上,此后永不触发:表现为
   * 「pane 起来了、能力也对,但快照永远是空的」,且极易被当成 agent 没发快照。
   *
   * 槽(slot)形态没这个问题,因为组件每次渲染都拿到最新的 `surface` prop;pane 形态把它跨到了
   * iframe 边界外,就必须由宿主侧显式跟随。重绑时会**立即重推当前值**,故建连早于首帧快照
   * 到达的竞态也一并被覆盖。
   */
  const bindSurface = React.useCallback((live: LiveConnection, pane: PaneDefinition): void => {
    for (const off of live.cleanup) off();
    live.cleanup = [];
    if (surface === undefined) return;
    for (const key of pane.capabilities.surfaceKeys) {
      const push = (value: unknown): void =>
        live.port.postMessage({ type: "pane:surface", key, value } satisfies PaneHostMessage);
      push(surface.getState(key));
      live.cleanup.push(surface.subscribe(key, push));
    }
  }, [surface]);

  /**
   * 绑定(或**重新**绑定)某条连接的共享状态订阅。
   *
   * ★ 与 `bindSurface` 同源的重绑理由:`state` 同样不是恒等对象(由宿主 useMemo 依赖会话
   * 连接构造),换身份后旧订阅挂在旧 store 上永不触发。见 state-binding.ts 的整段说明。
   *
   * 两者的清理函数分开持有 —— 合并进同一个数组的话,`surface` 换身份会顺手把状态订阅也
   * 退掉却不重建,反之亦然。
   */
  /**
   * ★ `state` 以 ref 持有,**不进任何建连回调的依赖链**。
   *
   * 它由宿主 useMemo 依赖会话连接构造,换身份非常频繁。一旦进入 `handleRequest` /
   * 建连回调的 deps,那些回调就跟着换身份 → 触发连接重建 → 旧 MessagePort 被 close;
   * 而 guest 只在启动时 await 一次握手、此后一直持有那个 port ⇒ 请求发进虚空,
   * promise 永不 settle。症状是「pane 渲染正常、按钮可点,但点了毫无反应、也不报错」。
   *
   * 实测:该形态只在**宿主装载路径**下暴露(内置 ⊕ agent 合并);旧槽路径由 agent 自建
   * 面板宿主、不传 state,故一直没被发现。
   */
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const bindState = React.useCallback((live: LiveConnection, pane: PaneDefinition): void => {
    live.stateCleanup?.();
    live.stateCleanup = bindPaneState(stateRef.current, pane.capabilities.state.read, (key, value) => {
      live.port.postMessage({ type: "pane:state", key, value } satisfies PaneHostMessage);
    });
    // deps 刻意为空:绑定读的是 ref,重绑由下面的 effect 按 state 身份变化驱动。
  }, []);

  // `state` 换身份 → 同样整组重绑(经 effect,不经回调身份)。
  React.useEffect(() => {
    for (const live of connections.current.values()) {
      bindState(live, paneById(definition, live.paneId));
    }
  }, [bindState, definition, state]);

  // `surface` 换身份 → 所有在世连接整组重绑(不销毁 iframe,pane 内部状态不丢)。
  React.useEffect(() => {
    for (const live of connections.current.values()) {
      bindSurface(live, paneById(definition, live.paneId));
    }
  }, [bindSurface, definition]);

  /** 把全部当前信号推给一条连接(新建连接时用:最后值即真值,晚连不丢)。 */
  const pushAllSignals = React.useCallback((port: MessagePort): void => {
    for (const [name, value] of Object.entries(signals ?? {})) {
      port.postMessage({ type: "pane:signal", name, value } satisfies PaneHostMessage);
    }
  }, [signals]);

  // 信号变更 → 只广播**变了的** key(逐 key 浅比较)。整包重推会让 pane 侧的订阅者
  // 收到大量无变化回调,而它们通常直接拿去 setState。
  const lastSignals = React.useRef<Record<string, unknown>>({});
  React.useEffect(() => {
    const next = signals ?? {};
    const prev = lastSignals.current;
    const changed = Object.entries(next).filter(([name, value]) => !Object.is(prev[name], value));
    lastSignals.current = { ...next };
    if (changed.length === 0) return;
    for (const live of connections.current.values()) {
      for (const [name, value] of changed) {
        live.port.postMessage({ type: "pane:signal", name, value } satisfies PaneHostMessage);
      }
    }
  }, [signals]);

  /**
   * `force`:跳过「同 epoch 已连接则跳过」的幂等守卫。
   *
   * 仅 `pane:ready` 用它 —— 那条消息的语义就是「guest 刚(重)启动、正在监听、需要一个新端口」。
   * 若沿用幂等守卫,下面那个补连扫描抢先建立的连接会把它挡掉;而扫描时 guest 脚本可能**还没跑**,
   * 那条 `pane:connected` 已经丢了。结果是宿主自以为连上、guest 却在空等 —— 比不补连更糟。
   */
  const connect = React.useCallback((instance: PaneInstance, force = false): void => {
    const frame = frames.current.get(instance.instanceId);
    if (frame?.contentWindow === null || frame?.contentWindow === undefined) return;
    if (!force && connections.current.get(instance.instanceId)?.epoch === instance.epoch) return;
    closeConnection(instance.instanceId, false);
    const pane = paneById(definition, instance.paneId);
    const channel = new MessageChannel();
    const live: LiveConnection = {
      epoch: instance.epoch,
      paneId: instance.paneId,
      port: channel.port1,
      cleanup: [],
    };
    connections.current.set(instance.instanceId, live);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const parsed = PaneGuestRequestSchema.safeParse(data);
      if (!parsed.success) {
        const requestId = typeof data === "object" && data !== null && typeof (data as { requestId?: unknown }).requestId === "string"
          ? (data as { requestId: string }).requestId
          : "invalid";
        channel.port1.postMessage({
          type: "pane:result",
          requestId,
          ok: false,
          error: new PaneHostError("INVALID_MESSAGE", "Pane request does not match protocol").toJSON(),
        } satisfies PaneHostMessage);
        return;
      }
      void handleRequest(instance, pane, parsed.data).then(
        (data) => channel.port1.postMessage({ type: "pane:result", requestId: parsed.data.requestId, ok: true, data } satisfies PaneHostMessage),
        (reason: unknown) => {
          const error = asPaneHostError(reason);
          if (error.code === "HOST_UNAVAILABLE") setHostError(error);
          onHostError?.(error);
          channel.port1.postMessage({ type: "pane:result", requestId: parsed.data.requestId, ok: false, error: error.toJSON() } satisfies PaneHostMessage);
        },
      );
    };
    channel.port1.start();
    bindSurface(live, pane);
    bindState(live, pane);
    // 信号在握手时即全量下推:pane 首帧就该拿到正确的主题等值,而不是先渲染错再纠正。
    pushAllSignals(channel.port1);
    frame.contentWindow.postMessage({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: instance.instanceId, paneId: instance.paneId, epoch: instance.epoch },
      grants: pane.capabilities,
      interactionMode: config.interactionMode ?? "standard",
    } satisfies PaneHostMessage, "*", [channel.port2]);
    // surface 订阅由 bindSurface 承担(且能随 surface 换身份重绑),故此处不再直接依赖 surface。
  }, [bindState, bindSurface, closeConnection, config.interactionMode, definition, handleRequest, onHostError, pushAllSignals]);

  React.useEffect(() => {
    const onGuestReady = (event: MessageEvent<unknown>): void => {
      const data = event.data as { type?: unknown; protocol?: unknown; paneId?: unknown } | undefined;
      if (data?.type !== "pane:ready" || data.protocol !== PANE_PROTOCOL_VERSION || typeof data.paneId !== "string") return;
      const instance = workspace.instances.find((candidate) => {
        const frame = frames.current.get(candidate.instanceId);
        return candidate.paneId === data.paneId && frame?.contentWindow === event.source;
      });
      // ready 表示当前 guest 尚无通道;旧同 epoch 记录属于已卸载文档,须重建。
      // force:guest 宣告就绪即以新端口重连,压过补连扫描可能建立的「半连接」(见 connect 的 force 说明)。
      if (instance !== undefined) connect(instance, true);
    };
    window.addEventListener("message", onGuestReady);
    return () => window.removeEventListener("message", onGuestReady);
  }, [connect, workspace.instances]);

  /**
   * ★ 补连扫描:建连的两个触发点(iframe `onLoad` 与 guest 的 `pane:ready` 消息)**都可能被错过**。
   *
   * `srcDoc` pane 不发网络请求,文档解析完即执行;当 workspace 状态从 localStorage 同步恢复
   * (页面刷新)时,iframe 在**首帧**就已存在,其 load 与 ready 都可能早于宿主挂上 ref /
   * 注册 window 监听。两个触发点同时落空 → 该 pane 永远停在未连接态。
   *
   * 故障表现极隐蔽:tab 在、iframe 在、guest 脚本也跑了,只是 `PaneGuestProvider` 一直等不到
   * `pane:connected`,渲染出一个空壳 —— 看起来像「pane 内容加载不出来」。首次进入会话反而正常
   * (那时 pane 是异步开出来的,宿主早已就绪),于是只在**刷新后**复现。
   *
   * 这里按 epoch 幂等地补一次;guest 侧的 `pane:connected` 监听在模块初始化时就装好且常驻,
   * 因此宿主迟到发起同样能连上。
   */
  React.useEffect(() => {
    for (const instance of workspace.instances) {
      if (connections.current.get(instance.instanceId)?.epoch === instance.epoch) continue;
      const frame = frames.current.get(instance.instanceId);
      if (frame?.contentWindow !== null && frame?.contentWindow !== undefined) connect(instance);
    }
  }, [connect, workspace.instances]);

  const openPane = (paneId: string): void => {
    dispatch({ type: "open", paneId, instanceId: nextId(paneId) });
    setPaletteOpen(false);
  };

  const closePane = (instanceId: string): void => {
    closeConnection(instanceId);
    dispatch({ type: "close", instanceId });
  };

  return (
    <section data-panes-host className={className} style={{ position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>
      <style>{hostInteractionStyles}</style>
      <header style={{ display: "flex", minHeight: 42, alignItems: "center", gap: 6, padding: "6px 8px", borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / .22)" }}>
        <nav aria-label="Panes" role="tablist" style={{ display: "flex", flex: 1, gap: 4, minWidth: 0, overflowX: "auto" }}>
          {workspace.instances.map((instance, index) => {
            const pane = paneById(definition, instance.paneId);
            const count = workspace.instances.filter((candidate) => candidate.paneId === instance.paneId);
            const ordinal = count.findIndex((candidate) => candidate.instanceId === instance.instanceId) + 1;
            const selected = instance.instanceId === workspace.activeInstanceId;
            return (
              <div key={instance.instanceId} role="presentation" draggable={advanced && config.allowTabReorder !== false}
                onDragStart={() => setDraggedId(instance.instanceId)} onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (draggedId !== undefined) dispatch({ type: "move", instanceId: draggedId, beforeInstanceId: instance.instanceId }); setDraggedId(undefined); }}
                style={{ display: "flex", alignItems: "center", border: `1px solid ${selected ? "hsl(var(--border))" : "transparent"}`, borderRadius: 8, background: selected ? "hsl(var(--background))" : "transparent", boxShadow: selected ? "0 1px 2px rgb(0 0 0 / .06)" : "none" }}>
                <button type="button" role="tab" aria-selected={selected} aria-controls={`pane-view-${instance.instanceId}`}
                  data-pane-tab
                  title={`${pane.title} · Alt+${index + 1}`} onClick={() => dispatch({ type: "activate", instanceId: instance.instanceId })}
                  style={{ ...buttonStyle, padding: "7px 5px 7px 9px", whiteSpace: "nowrap", color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                  {pane.icon !== undefined ? <span aria-hidden="true">{pane.icon} </span> : null}
                  {pane.title}{count.length > 1 ? ` ${ordinal}` : ""}
                </button>
                <button type="button" aria-label={`关闭 ${pane.title}`} title="关闭 Pane" onClick={() => closePane(instance.instanceId)}
                  data-pane-icon-button
                  style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: "4px 7px", color: "hsl(var(--muted-foreground))" }}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            );
          })}
        </nav>
        <button type="button" aria-label="新开 Pane" title="新开 Pane" onClick={() => setPaletteOpen(true)}
          data-pane-icon-button
          style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: "6px" }}>
          <Plus size={16} aria-hidden />
        </button>
        {config.showCommandPalette !== false ? <button type="button" aria-label="打开 Pane 切换器" title="Ctrl/Cmd+K" onClick={() => setPaletteOpen(true)}
          data-pane-icon-button
          style={{ ...buttonStyle, display: "grid", placeItems: "center", border: "1px solid hsl(var(--border))", padding: "6px" }}>
          <Command size={15} aria-hidden />
        </button> : null}
      </header>
      {hostError !== undefined ? <div role="alert" data-pane-host-error={hostError.code} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 10px", background: "hsl(var(--destructive) / .1)", color: "hsl(var(--destructive))", fontSize: 12 }}><span>{hostError.message}</span><button type="button" aria-label="关闭错误提示" onClick={() => setHostError(undefined)} style={{ ...buttonStyle, display: "grid", placeItems: "center" }}><X size={14} aria-hidden /></button></div> : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {workspace.instances.length === 0 ? <div style={{ height: "100%", display: "grid", placeItems: "center", color: "hsl(var(--muted-foreground))" }}><button type="button" onClick={() => setPaletteOpen(true)} style={{ ...buttonStyle, border: "1px solid hsl(var(--border))", padding: "8px 12px" }}>打开一个 Pane</button></div> : null}
        {workspace.instances.map((instance) => {
          const pane = paneById(definition, instance.paneId);
          const active = instance.instanceId === workspace.activeInstanceId;
          return <iframe key={`${instance.instanceId}:${instance.epoch}`} id={`pane-view-${instance.instanceId}`}
            ref={(node) => { if (node === null) frames.current.delete(instance.instanceId); else frames.current.set(instance.instanceId, node); }}
            title={pane.title} sandbox="allow-scripts" referrerPolicy="no-referrer"
            {...(pane.document.kind === "inline" ? { srcDoc: pane.document.srcDoc } : { src: pane.document.src })}
            onLoad={() => connect(instance)}
            style={{ display: active ? "block" : "none", width: "100%", height: "100%", border: 0 }} />;
        })}
      </div>
      {paletteOpen ? <div role="dialog" aria-modal="true" aria-label="新开 Pane" onMouseDown={() => setPaletteOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 30, display: "grid", placeItems: "start center", paddingTop: 60, background: "rgb(0 0 0 / .28)" }}>
        <div onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(360px, calc(100% - 24px))", padding: 8, border: "1px solid hsl(var(--border))", borderRadius: 12, background: "hsl(var(--popover, var(--background)))", boxShadow: "0 18px 45px rgb(0 0 0 / .18)" }}>
          <strong style={{ display: "block", padding: "7px 10px" }}>新开 Pane</strong>
          {definition.panes.map((pane, index) => {
            const openCount = workspace.instances.filter((instance) => instance.paneId === pane.id).length;
            const disabled = openCount >= pane.maxInstances || workspace.instances.length >= definition.maxOpenPanes;
            return <button key={pane.id} type="button" autoFocus={index === 0} disabled={disabled} onClick={() => openPane(pane.id)}
              data-pane-palette-item
              style={{ ...buttonStyle, width: "100%", display: "flex", justifyContent: "space-between", padding: "9px 10px", textAlign: "left", opacity: disabled ? .45 : 1 }}>
              <span>{pane.icon !== undefined ? `${pane.icon} ` : ""}{pane.title}</span>
              <span>{pane.maxInstances === UNLIMITED_PANE_COUNT ? `已开 ${openCount}` : `${openCount}/${pane.maxInstances}`}</span>
            </button>;
          })}
        </div>
      </div> : null}
    </section>
  );
}

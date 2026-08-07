import type {
  PaneCapabilities,
  PaneConnectedMessage,
  PaneErrorData,
  PaneHostMessage,
  PaneTheme,
} from "./contract.js";
// ★ 从零依赖的 protocol-version 取,**不要**从 contract 取:后者顶层的 z.object(...) 是打包器
// 眼里的副作用表达式,只为一个版本号 import 它会把整个 zod(约 62KB)内联进 guest bundle。
// guest 侧格外敏感 —— 内置 pane 的文档是内联进宿主 bundle 的字符串,每个 pane 重复一份。
import { PANE_PROTOCOL_VERSION } from "./protocol-version.js";
import { PaneHostError } from "./errors.js";
import { installGlobalTauriPaneBootstrap } from "./adapters/tauri-runtime.js";

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PaneGuestSurface {
  run(domain: string, action: string, args?: unknown): Promise<unknown>;
  getState<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  hasCommand(name: string): boolean;
}

/**
 * 会话级共享状态(spec panes-only-right-panel 任务 1.3;Req 2.1/2.2/2.3)。
 *
 * ★ 四个操作与**宿主侧既有的共享状态访问器逐一对应** —— 迁移方从旧槽搬进 pane 时,
 * 只需改「从哪拿到它」,调用形状一个字都不用改。这是把迁移成本压到最低的关键。
 *
 * 读与订阅是本地的(宿主按授权键主动推 `pane:state`,guest 侧只是缓存);
 * 写与删走上行请求,受 `grants.state.write` 授权。
 */
export interface PaneGuestState {
  get<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PaneGuestEvents {
  publish(topic: string, payload?: unknown): Promise<{ readonly delivered: number }>;
  subscribe(topic: string, listener: (payload: unknown, source: { readonly instanceId: string; readonly paneId: string }) => void): () => void;
}

export interface PaneGuestConnection {
  readonly instanceId: string;
  readonly paneId: string;
  readonly epoch: number;
  readonly interactionMode: "standard" | "advanced";
  readonly grants: PaneCapabilities;
  readonly theme?: PaneTheme;
  readonly surface: PaneGuestSurface;
  readonly state: PaneGuestState;
  readonly events: PaneGuestEvents;
  query<T = unknown>(route: string, query?: Record<string, string>): Promise<T>;
  mutate<T = unknown>(route: string, body: unknown): Promise<T>;
  upload(file: File): Promise<{ attachmentId: string; displayUrl: string }>;
  stageUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): Promise<void>;
  submitUserMessage(text: string, options?: { readonly attachmentIds?: readonly string[] }): Promise<void>;
  /**
   * 读宿主具名信号的当前值(最后值即真值;从未推送过 → undefined)。
   * 见 contract 的 `pane:signal`:搬运的是只存在于宿主 realm 的东西(主题、宿主 chrome 事件)。
   */
  getSignal<T = unknown>(name: string): T | undefined;
  /** 订阅宿主具名信号;**订阅即以当前值回调一次**(若已有值),故不依赖订阅早于推送。 */
  onSignal(name: string, listener: (value: unknown) => void): () => void;
  onLifecycle(listener: (state: "visible" | "hidden" | "closing") => void): () => void;
  onTheme(listener: (theme: PaneTheme) => void): () => void;
  close(): void;
}

function errorFromData(error: PaneErrorData): PaneHostError {
  return new PaneHostError(error.code, error.message, { retryable: error.retryable, status: error.status });
}

/**
 * ★ 返回值带 `rebind`:宿主**会重建连接并换用新 MessagePort**(合法行为 —— 它的 props
 * 随会话推进换身份),而 guest 若只在启动时握手一次,就会永远持有已废弃的旧 port,
 * 此后所有下行帧与上行响应统统进虚空。症状极隐蔽:pane 渲染正常、首帧数据也在
 * (旧 port 的缓冲),之后一切静默失效。
 *
 * 故连接对象持有**可变** port,由 `connectPaneGuest` 的常驻握手监听器在收到新的
 * `pane:connected` 时换绑。缓存的状态/信号一律保留 —— 宿主重连后会重推,保留只会更早可用。
 */
function createConnection(message: PaneConnectedMessage, initialPort: MessagePort, timeoutMs: number): {
  readonly connection: PaneGuestConnection;
  readonly rebind: (port: MessagePort) => void;
} {
  let port = initialPort;
  let sequence = 0;
  let closed = false;
  const pending = new Map<string, PendingCall>();
  const states = new Map<string, unknown>();
  const surfaceListeners = new Map<string, Set<(value: unknown) => void>>();
  const stateValues = new Map<string, unknown>();
  const stateListeners = new Map<string, Set<(value: unknown) => void>>();
  // 宿主具名信号:最后值即真值。与 states 分开存 —— 事实源不同(agent 快照 vs 宿主 realm)。
  const signals = new Map<string, unknown>();
  const signalListeners = new Map<string, Set<(value: unknown) => void>>();
  // 代理事件(pane ↔ pane):不保留最后值,故只有 listeners、没有值表。与 signals 刻意分开。
  const eventListeners = new Map<string, Set<(payload: unknown, source: { readonly instanceId: string; readonly paneId: string }) => void>>();
  const lifecycleListeners = new Set<(state: "visible" | "hidden" | "closing") => void>();
  const themeListeners = new Set<(theme: PaneTheme) => void>();
  let theme = message.theme;

  const request = <T,>(operation: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> => {
    if (closed) return Promise.reject(new PaneHostError("HOST_UNAVAILABLE", "Pane connection is closed"));
    const requestId = `${message.instance.instanceId}:${++sequence}`;
    port.postMessage({ type: "pane:request", requestId, operation, ...payload }, transfer);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new PaneHostError("REQUEST_TIMEOUT", "Pane request timed out", { retryable: true }));
      }, timeoutMs);
      pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
    });
  };

  const onHostMessage = (event: MessageEvent<PaneHostMessage>): void => {
    const data = event.data;
    if (data === null || typeof data !== "object" || !("type" in data)) return;
    if (data.type === "pane:result") {
      const call = pending.get(data.requestId);
      if (call === undefined) return;
      pending.delete(data.requestId);
      clearTimeout(call.timer);
      if (data.ok) call.resolve(data.data);
      else call.reject(errorFromData(data.error));
      return;
    }
    if (data.type === "pane:state") {
      stateValues.set(data.key, data.value);
      for (const listener of stateListeners.get(data.key) ?? []) listener(data.value);
      return;
    }
    if (data.type === "pane:surface") {
      states.set(data.key, data.value);
      for (const listener of surfaceListeners.get(data.key) ?? []) listener(data.value);
      return;
    }
    if (data.type === "pane:signal") {
      signals.set(data.name, data.value);
      for (const listener of signalListeners.get(data.name) ?? []) listener(data.value);
      // 边车 chrome 可能晚于首包 signal 才 bindPort；MessagePort 不重放。
      // 缓存到 window 并广播事件，保证首进 agent 顶栏 tabs 能立刻画上。
      if (data.name === "pi.workspace") {
        const w = globalThis.window as (Window & {
          __PI_WORKSPACE_SIGNAL__?: unknown;
        }) | undefined;
        if (w !== undefined) {
          w.__PI_WORKSPACE_SIGNAL__ = data.value;
          try {
            w.dispatchEvent(new CustomEvent("pi-workspace", { detail: data.value }));
          } catch {
            // ignore
          }
        }
      }
      return;
    }
    if (data.type === "pane:event") {
      for (const listener of eventListeners.get(data.topic) ?? []) listener(data.payload, data.source);
      return;
    }
    if (data.type === "pane:theme") {
      theme = data.theme;
      for (const listener of themeListeners) listener(data.theme);
      return;
    }
    if (data.type === "pane:lifecycle") {
      for (const listener of lifecycleListeners) listener(data.state);
    }
  };
  const publishHostPort = (p: MessagePort): void => {
    // 边车 chrome 与 guest 共用同一 port；经全局发布，避免 chrome 与 connect 抢事件口。
    const w = globalThis.window as (Window & { __PI_PANE_PORT__?: MessagePort }) | undefined;
    if (w === undefined) return;
    w.__PI_PANE_PORT__ = p;
    try {
      w.dispatchEvent(new CustomEvent("pi-pane-port", { detail: { port: p } }));
    } catch {
      // jsdom / 无 CustomEvent 时忽略
    }
  };
  const attach = (p: MessagePort): void => {
    // 用 addEventListener 而非 onmessage，避免独占、便于边车并行监听同一 port。
    p.addEventListener("message", onHostMessage as unknown as EventListener);
    p.start();
    publishHostPort(p);
  };
  attach(port);

  const grants = message.grants;
  const connection: PaneGuestConnection = {
    instanceId: message.instance.instanceId,
    paneId: message.instance.paneId,
    epoch: message.instance.epoch,
    interactionMode: message.interactionMode,
    grants,
    get theme() {
      return theme;
    },
    surface: {
      run: (domain, action, args) => request("surface.run", { domain, action, ...(args !== undefined ? { args } : {}) }),
      getState: <T,>(key: string) => states.get(key) as T | undefined,
      subscribe: (key, listener) => {
        const listeners = surfaceListeners.get(key) ?? new Set();
        listeners.add(listener);
        surfaceListeners.set(key, listeners);
        return () => listeners.delete(listener);
      },
      hasCommand: (name) => grants.surfaceCommands.some((grant) =>
        name === `surface:${grant.domain}` || grant.actions.some((action) => name === `surface:${grant.domain}:${action}`)),
    },
    state: {
      get: <T,>(key: string) => stateValues.get(key) as T | undefined,
      subscribe: (key, listener) => {
        const listeners = stateListeners.get(key) ?? new Set();
        listeners.add(listener);
        stateListeners.set(key, listeners);
        return () => listeners.delete(listener);
      },
      set: async (key, value) => { await request("state.set", { key, value }); },
      delete: async (key) => { await request("state.delete", { key }); },
    },
    events: {
      publish: (topic, payload) => request("event.publish", { topic, ...(payload !== undefined ? { payload } : {}) }),
      subscribe: (topic, listener) => {
        const listeners = eventListeners.get(topic) ?? new Set();
        listeners.add(listener);
        eventListeners.set(topic, listeners);
        return () => listeners.delete(listener);
      },
    },
    query: (route, query = {}) => request("route.query", { route, query }),
    mutate: (route, body) => request("route.mutate", { route, body }),
    upload: async (file) => {
      const bytes = await file.arrayBuffer();
      return request("attachment.put", { name: file.name, mimeType: file.type, bytes }, [bytes]);
    },
    stageUserMessage: (text, options) => request("conversation.stage", {
      text,
      ...(options?.attachmentIds !== undefined ? { attachmentIds: options.attachmentIds } : {}),
    }),
    submitUserMessage: (text, options) => request("conversation.submit", {
      text,
      ...(options?.attachmentIds !== undefined ? { attachmentIds: options.attachmentIds } : {}),
    }),
    getSignal: <T,>(name: string) => signals.get(name) as T | undefined,
    onSignal: (name, listener) => {
      const listeners = signalListeners.get(name) ?? new Set();
      listeners.add(listener);
      signalListeners.set(name, listeners);
      // ★ 订阅即以当前值回调一次(若已有)。信号是「最后值即真值」而非事件流:
      // pane 内的组件挂载时机不可控,若只等下一次推送,首帧就会用错值渲染
      // (例如宿主是暗色、pane 先亮一下再跳暗)。
      const current = signals.get(name);
      if (current !== undefined) listener(current);
      return () => listeners.delete(listener);
    },
    onLifecycle: (listener) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    onTheme: (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new PaneHostError("HOST_UNAVAILABLE", "Pane connection closed"));
      }
      pending.clear();
      port.close();
    },
  };

  /** 换绑到宿主新建的 port。旧 port 上的 in-flight 请求永远等不到响应,故就地拒绝。 */
  const rebind = (next: MessagePort): void => {
    for (const [, call] of pending) {
      clearTimeout(call.timer);
      call.reject(new PaneHostError("STALE_INSTANCE", "Pane connection was rebound by host", { retryable: true }));
    }
    pending.clear();
    const prev = port;
    port = next;
    // 先挂新 port 并通知边车，再关旧 port —— 否则 chrome 会拿着已 close 的口。
    attach(port);
    try { prev.removeEventListener("message", onHostMessage as unknown as EventListener); } catch { /* ignore */ }
    try { prev.close(); } catch { /* 已关闭则忽略 */ }
  };

  return { connection, rebind };
}

export function connectPaneGuest(options: {
  readonly expectedPaneId: string;
  readonly timeoutMs?: number;
  readonly window?: Window;
  readonly signal?: AbortSignal;
}): Promise<PaneGuestConnection> {
  const guestWindow = options.window ?? globalThis.window;
  installGlobalTauriPaneBootstrap(guestWindow);
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let readinessInterval: ReturnType<typeof setInterval> | undefined;
    // ★ 首次握手成功后**只清超时,不摘监听器** —— 宿主会重建连接并换用新 port
    // (它的 props 随会话推进换身份),guest 必须跟随换绑,否则此后所有帧进虚空。
    let handle: ReturnType<typeof createConnection> | undefined;
    const settleFirst = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (readinessInterval !== undefined) clearInterval(readinessInterval);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const cleanup = (): void => {
      settleFirst();
      guestWindow.removeEventListener("message", onConnect);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new PaneHostError("HOST_UNAVAILABLE", "Pane host handshake cancelled", { retryable: true }));
    };
    const onConnect = (event: MessageEvent<unknown>): void => {
      const data = event.data as Partial<PaneConnectedMessage> | undefined;
      if (event.source !== guestWindow.parent || data?.type !== "pane:connected" || event.ports.length !== 1) return;
      if (data.protocol !== PANE_PROTOCOL_VERSION || data.instance?.paneId !== options.expectedPaneId) return;
      const port = event.ports[0]!;
      if (handle !== undefined) {
        // 重新握手:换绑到新 port,连接对象与其缓存/订阅全部保持不变。
        handle.rebind(port);
        return;
      }
      settleFirst();
      handle = createConnection(data as PaneConnectedMessage, port, options.timeoutMs ?? 15_000);
      resolve(handle.connection);
    };
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }
    timeout = setTimeout(() => {
      cleanup();
      reject(new PaneHostError("HOST_UNAVAILABLE", "Pane host handshake timed out", { retryable: true }));
    }, options.timeoutMs ?? 15_000);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    guestWindow.addEventListener("message", onConnect);
    const announceReady = (): void => {
      // WebView2 首个脚本帧可能早于 Tauri runtime 注入；沿既有 ready 轮询补装桥。
      installGlobalTauriPaneBootstrap(guestWindow);
      guestWindow.parent.postMessage({
        type: "pane:ready",
        protocol: PANE_PROTOCOL_VERSION,
        paneId: options.expectedPaneId,
      }, "*");
    };
    announceReady();
    // Host effect 可能晚于 srcDoc 脚本；有界重发使握手不再依赖 iframe load 的竞态。
    readinessInterval = setInterval(announceReady, 250);
  });
}

import type { PaneDocument } from "../contract.js";
import type { PaneViewAdapter } from "../host-ports.js";
import {
  createTauriPaneViewAdapter,
  TAURI_PANE_RELAY_BIND_COMMAND,
  TAURI_PANE_RELAY_GUEST_EVENT,
  TAURI_PANE_RELAY_HOST_EVENT,
  type TauriPaneMountTarget,
  type TauriPaneWebview,
} from "./tauri.js";
import { installTauriPaneBootstrap } from "./tauri-bootstrap.js";

const INSTANCE_HASH_KEY = "pi-pane-instance";
const PANE_LABEL_PREFIX = "pane-";
const BOOTSTRAP_MARKER = Symbol.for("pi-web.pane.tauri-bootstrap");
const HOST_ADAPTER_MARKER = Symbol.for("pi-web.pane.tauri-host-adapter");
const HOST_OVERLAY_MARKER = Symbol.for("pi-web.pane.tauri-host-overlay");
const OVERLAY_INSTANCE_ID = "panes-overlay-menu";
const OVERLAY_LABEL = "pane-overlay-menu";
const TAURI_PANE_HOST_LAYOUT_EVENT = "pane-host-layout";

interface TauriEvent<T = unknown> {
  readonly payload: T;
}

interface TauriWebview {
  setBounds(x: number, y: number, width: number, height: number): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  reload?(): Promise<void>;
}

interface TauriWindowHandle {
  innerPosition(): Promise<{ readonly x: number; readonly y: number }>;
  scaleFactor(): Promise<number>;
  onMoved?(listener: () => void): Promise<() => void>;
  onResized?(listener: () => void): Promise<() => void>;
}

interface TauriRuntime {
  readonly core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  };
  readonly event: {
    listen(event: string, listener: (event: TauriEvent) => void): Promise<() => void>;
  };
  readonly webview?: {
    getCurrentWebview?(): { readonly label: string };
  };
  readonly window: {
    getCurrentWindow(): TauriWindowHandle;
  };
}

export type TauriPaneLayoutMode = "workspace" | "host-fullscreen";

export interface TauriPaneLayoutMetrics {
  /** content-well 顶边相对窗口 client 顶（tabs chrome 高度）。 */
  readonly topHeight?: number;
  /** content-well 左缘（chat + resize 之右）。 */
  readonly leftWidth?: number;
  /** content-well 宽度。 */
  readonly paneWidth?: number;
  readonly paneRatio?: number;
  /** content-well 底边距窗口底。 */
  readonly bottomHeight?: number;
  readonly minWidth?: number;
  readonly scaleFactor?: number;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  transformCallback(callback: (event: TauriEvent) => void): number;
  unregisterCallback(callbackId: number): void;
  readonly metadata?: { readonly currentWebview?: { readonly label?: string } };
}

type TauriWindow = Window & {
  readonly __TAURI__?: TauriRuntime;
  readonly __TAURI_INTERNALS__?: TauriInternals;
  readonly __PI_TAURI_PANE_LABEL__?: string;
  readonly [BOOTSTRAP_MARKER]?: () => void;
  readonly [HOST_ADAPTER_MARKER]?: PaneViewAdapter<TauriPaneMountTarget>;
  readonly [HOST_OVERLAY_MARKER]?: TauriPaneOverlayController;
};

export interface TauriPaneOverlayItem {
  readonly id: string;
  readonly label: string;
  readonly meta?: string;
  readonly disabled?: boolean;
}

export interface TauriPaneOverlayOpenOptions {
  readonly title: string;
  readonly items: readonly TauriPaneOverlayItem[];
  readonly anchor: Element;
  readonly placement?: "anchor-end" | "center";
  readonly onSelect: (id: string) => void;
  /** 菜单关闭（选中、取消、遮罩）时回调。 */
  readonly onClose?: () => void;
}

export interface TauriPaneOverlayController {
  open(options: TauriPaneOverlayOpenOptions): Promise<void>;
  close(): void;
}

interface PaneScreenBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface FrameBoundsObserver {
  readonly sync: () => void;
  readonly dispose: () => void;
}

/**
 * ResizeObserver 不会感知祖先的 transform；Pane 槽却会随宿主的缓动而移动。
 * 侦测到尺寸、滚动或 transition 后，逐帧取实际 rect，直到稳定一小段时间。
 */
function observeFrameBounds(options: {
  readonly target: Window;
  readonly observed: Element;
  readonly measure: () => PaneScreenBounds | undefined;
  readonly apply: (bounds: PaneScreenBounds) => Promise<void>;
  readonly isActive: () => boolean;
}): FrameBoundsObserver {
  const { target, observed, measure, apply, isActive } = options;
  let frame: number | undefined;
  let dirty = false;
  let disposed = false;
  let lastBounds = "";
  let sampleUntil = 0;
  const now = (): number => target.performance.now();
  const schedule = (): void => {
    if (frame === undefined && !disposed) frame = target.requestAnimationFrame(tick);
  };
  const tick = (): void => {
    frame = undefined;
    if (disposed || !isActive()) {
      dirty = false;
      return;
    }
    const shouldSample = dirty || now() < sampleUntil;
    dirty = false;
    if (shouldSample) {
      const bounds = measure();
      if (bounds !== undefined && bounds.width > 0 && bounds.height > 0) {
        const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
        if (key !== lastBounds) {
          lastBounds = key;
          // 矩形持续变化即保持逐帧采样，适配宿主自身的 easing 曲线。
          sampleUntil = now() + 160;
          void apply(bounds).catch(() => {
            lastBounds = "";
          });
        }
      }
    }
    if (dirty || now() < sampleUntil) schedule();
  };
  const sync = (): void => {
    if (!isActive()) return;
    dirty = true;
    sampleUntil = Math.max(sampleUntil, now() + 260);
    schedule();
  };
  const isRelatedMotion = (event: Event): boolean => {
    const eventTarget = event.target;
    return eventTarget instanceof Node
      && (eventTarget === observed
        || observed.contains(eventTarget)
        || eventTarget.contains(observed));
  };
  const syncMotion = (event: Event): void => {
    if (isRelatedMotion(event)) sync();
  };
  const observer = new ResizeObserver(sync);
  observer.observe(observed);
  target.addEventListener("resize", sync);
  target.addEventListener("scroll", sync, true);
  target.addEventListener("transitionrun", syncMotion, true);
  target.addEventListener("animationstart", syncMotion, true);
  return {
    sync,
    dispose() {
      disposed = true;
      dirty = false;
      observer.disconnect();
      target.removeEventListener("resize", sync);
      target.removeEventListener("scroll", sync, true);
      target.removeEventListener("transitionrun", syncMotion, true);
      target.removeEventListener("animationstart", syncMotion, true);
      if (frame !== undefined) target.cancelAnimationFrame(frame);
    },
  };
}

function tauriRuntime(target: Window = window): TauriRuntime | undefined {
  return (target as TauriWindow).__TAURI__;
}

/** 仅上报语义布局；bounds 与 Webview 生命周期仍由 Rust 真源管理。 */
export function setTauriPaneLayoutMode(
  mode: TauriPaneLayoutMode,
  target: Window = window,
): Promise<void> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return Promise.resolve();
  return runtime.core.invoke("pane_layout_set_mode", { mode }).then(() => undefined);
}

/** 宿主槽位真正变化时上报一次，避免持续读取 DOM 坐标。 */
export function setTauriPaneLayoutMetrics(
  metrics: TauriPaneLayoutMetrics,
  target: Window = window,
): Promise<void> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return Promise.resolve();
  return runtime.core.invoke("pane_layout_set_metrics", { metrics }).then(() => undefined);
}

/** 是否启用内部 child WebView 布局（host 铺满 + content-well 盖 child）。 */
export function isTauriNativePaneLayout(target: Window = window): Promise<boolean> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return Promise.resolve(false);
  return runtime.core.invoke("pane_layout_is_native")
    .then((value) => value === true)
    .catch(() => false);
}

/**
 * 由 content-well 元素量取并上报 native 槽位几何。
 * host 铺满窗口；child 只盖本矩形，tabs/resize 留在 host。
 */
export function publishTauriContentWellMetrics(
  well: Element,
  options: { readonly minWidth?: number; readonly target?: Window } = {},
): Promise<void> {
  const target = options.target ?? window;
  const rect = well.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return Promise.resolve();
  const bottomHeight = Math.max(0, target.innerHeight - rect.bottom);
  return setTauriPaneLayoutMetrics({
    leftWidth: Math.max(0, rect.left),
    topHeight: Math.max(0, rect.top),
    paneWidth: Math.max(1, rect.width),
    bottomHeight,
    minWidth: options.minWidth ?? 240,
  }, target);
}

function tauriGuestRuntime(target: Window): {
  readonly label?: string;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, listener: (event: TauriEvent) => void): Promise<() => void>;
} | undefined {
  const full = tauriRuntime(target);
  if (full !== undefined) {
    return {
      label: full.webview?.getCurrentWebview?.().label,
      invoke: (command, args) => full.core.invoke(command, args),
      listen: (event, listener) => full.event.listen(event, listener),
    };
  }
  const internals = (target as TauriWindow).__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWebview?.label
    ?? (target as TauriWindow).__PI_TAURI_PANE_LABEL__;
  if (internals === undefined) return undefined;
  return {
    label,
    invoke: (command, args) => internals.invoke(command, args),
    async listen(event, listener) {
      const handler = internals.transformCallback(listener);
      const eventId = await internals.invoke("plugin:event|listen", {
        event,
        target: { kind: "Any" },
        handler,
      });
      return () => {
        internals.unregisterCallback(handler);
        void internals.invoke("plugin:event|unlisten", { event, eventId }).catch(() => undefined);
      };
    },
  };
}

export function isTauriPaneRuntime(target: Window = window): boolean {
  const runtime = tauriRuntime(target);
  return runtime?.core?.invoke !== undefined
    && runtime.window?.getCurrentWindow !== undefined;
}

export function resolveTauriPaneInstanceId(
  href: string,
  label?: string,
): string | undefined {
  const location = new URL(href);
  const queryInstanceId = location.searchParams.get(INSTANCE_HASH_KEY) ?? undefined;
  const labelInstanceId = label?.startsWith(PANE_LABEL_PREFIX) === true
    ? label.slice(PANE_LABEL_PREFIX.length).replace(/-\d+$/, "")
    : undefined;
  return queryInstanceId
    ?? labelInstanceId
    ?? new URLSearchParams(location.hash.slice(1)).get(INSTANCE_HASH_KEY)
    ?? undefined;
}

/**
 * Guest 顶层 WebView 内重建 window/MessageChannel 握手；connectPaneGuest 仍走同一协议。
 * Windows WebView2 创建子 WebView 时会丢弃 fragment；宿主另把 instanceId 写入 query。
 * 原生 label 还含防重建冲突的 epoch，故不可优先当 instanceId 使用。
 */
export function installGlobalTauriPaneBootstrap(target: Window = window): void {
  const paneWindow = target as TauriWindow;
  if (paneWindow[BOOTSTRAP_MARKER] !== undefined) return;
  const install = (
    instanceId: string,
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
    onRelayMessage: (listener: (event: TauriEvent) => void) => () => void,
  ): void => {
    const dispose = installTauriPaneBootstrap({
      instanceId,
      window: target,
      invoke,
      onRelayMessage: (listener) => onRelayMessage(({ payload }) => listener(payload)),
    });
    Object.defineProperty(paneWindow, BOOTSTRAP_MARKER, { configurable: true, value: dispose });
    target.addEventListener("beforeunload", dispose, { once: true });
  };
  const runtime = tauriGuestRuntime(target);
  if (runtime === undefined) return;
  const instanceId = resolveTauriPaneInstanceId(target.location.href, runtime.label);
  if (instanceId !== undefined && instanceId.length > 0) {
    install(
      instanceId,
      (command, args) => runtime.invoke(command, args),
      (listener) => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void runtime.listen(TAURI_PANE_RELAY_GUEST_EVENT, listener).then((off) => {
          if (disposed) off();
          else unlisten = off;
        });
        return () => {
          disposed = true;
          unlisten?.();
        };
      },
    );
  }
}

export function tauriPaneDocumentUrl(document: PaneDocument, instanceId: string): string {
  if (document.kind === "inline") throw new Error("Tauri native Pane requires a URL-backed HTML document");
  const url = new URL(document.src, globalThis.document.baseURI);
  url.searchParams.set(INSTANCE_HASH_KEY, instanceId);
  url.hash = `${INSTANCE_HASH_KEY}=${encodeURIComponent(instanceId)}`;
  return url.href;
}

/** 桌面端共享原生弹层；添加 Pane 与收起标签菜单复用同一 WebView。 */
export function createGlobalTauriPaneOverlay(
  target: Window = window,
): TauriPaneOverlayController | undefined {
  const paneWindow = target as TauriWindow;
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return undefined;
  const existing = paneWindow[HOST_OVERLAY_MARKER];
  if (existing !== undefined) return existing;
  let token = 0;
  let shownToken = 0;
  let current: TauriPaneOverlayOpenOptions | undefined;
  let boundsRevision = 0;
  let follow: FrameBoundsObserver | undefined;
  let unlistenMoved: (() => void) | undefined;
  let unlistenResized: (() => void) | undefined;
  const stopFollowing = (): void => {
    follow?.dispose();
    follow = undefined;
    unlistenMoved?.();
    unlistenMoved = undefined;
    unlistenResized?.();
    unlistenResized = undefined;
  };
  const hide = (): void => {
    const closing = current;
    current = undefined;
    stopFollowing();
    void runtime.core.invoke("pane_webview_window_control", {
      label: OVERLAY_LABEL,
      action: "hide",
    }).catch(() => undefined);
    closing?.onClose?.();
  };
  const listenerReady = runtime.event.listen(TAURI_PANE_RELAY_HOST_EVENT, ({ payload }) => {
    const envelope = payload as {
      readonly instanceId?: unknown;
      readonly message?: {
        readonly type?: unknown;
        readonly token?: unknown;
        readonly value?: unknown;
      };
    };
    if (
      envelope.instanceId !== OVERLAY_INSTANCE_ID ||
      envelope.message?.token !== token
    ) return;
    if (envelope.message.type === "pane:overlay-ready") {
      if (shownToken === token) return;
      shownToken = token;
      void runtime.core.invoke("pane_webview_window_control", {
        label: OVERLAY_LABEL,
        action: "show",
      }).then(() => runtime.core.invoke("pane_webview_window_control", {
        label: OVERLAY_LABEL,
        action: "focus",
      })).catch(() => undefined);
      return;
    }
    if (envelope.message.type === "pane:overlay-select") {
      const selected = current?.onSelect;
      const value = envelope.message.value;
      hide();
      if (typeof value === "string") selected?.(value);
      return;
    }
    if (envelope.message.type === "pane:overlay-close") hide();
  });
  // 壳层在主窗 resize/move 的同一事件循环广播；不等待浏览器 resize 冒泡。
  void runtime.event.listen(TAURI_PANE_HOST_LAYOUT_EVENT, () => follow?.sync())
    .catch(() => undefined);
  const controller: TauriPaneOverlayController = {
    async open(options) {
      stopFollowing();
      current = options;
      const currentToken = ++token;
      shownToken = 0;
      await listenerReady;
      const hostWindow = runtime.window.getCurrentWindow();
      let [origin, scaleFactor] = await Promise.all([
        hostWindow.innerPosition(),
        hostWindow.scaleFactor(),
      ]);
      const width = Math.min(340, Math.max(220, target.innerWidth - 16));
      const height = Math.min(380, 48 + options.items.length * 38);
      const screenBounds = (): PaneScreenBounds => {
        const anchor = options.anchor.getBoundingClientRect();
        const left = options.placement === "center"
          ? Math.max(8, (target.innerWidth - width) / 2)
          : Math.max(8, Math.min(anchor.right - width, target.innerWidth - width - 8));
        const top = options.placement === "center"
          ? Math.max(40, Math.min((target.innerHeight - height) / 3, target.innerHeight - height - 8))
          : Math.max(8, Math.min(anchor.bottom + 4, target.innerHeight - height - 8));
        return {
          x: (Number.isFinite(target.screenX) ? target.screenX : origin.x / scaleFactor) + left,
          y: (Number.isFinite(target.screenY) ? target.screenY : origin.y / scaleFactor) + top,
          width,
          height,
        };
      };
      const initialBounds = screenBounds();
      const style = getComputedStyle(options.anchor);
      const url = new URL("/pane-overlay.html", target.location.href);
      url.searchParams.set("instanceId", OVERLAY_INSTANCE_ID);
      url.searchParams.set("token", String(currentToken));
      url.searchParams.set("title", options.title);
      url.searchParams.set("items", JSON.stringify(options.items));
      url.searchParams.set("theme", JSON.stringify({
        colorScheme: style.colorScheme,
        background: style.getPropertyValue("--popover").trim()
          || style.getPropertyValue("--background").trim(),
        foreground: style.getPropertyValue("--popover-foreground").trim()
          || style.getPropertyValue("--foreground").trim(),
        border: style.getPropertyValue("--border").trim(),
        accent: style.getPropertyValue("--accent").trim(),
        muted: style.getPropertyValue("--muted-foreground").trim(),
      }));
      await runtime.core.invoke(TAURI_PANE_RELAY_BIND_COMMAND, {
        instanceId: OVERLAY_INSTANCE_ID,
        epoch: currentToken,
        label: OVERLAY_LABEL,
      });
      await runtime.core.invoke("pane_webview_window_create", {
        label: OVERLAY_LABEL,
        url: url.href,
        x: initialBounds.x,
        y: initialBounds.y,
        width,
        height,
        visible: false,
      });
      const setBounds = (bounds: PaneScreenBounds): Promise<void> => runtime.core.invoke(
        "pane_webview_window_control",
        {
          label: OVERLAY_LABEL,
          action: "set-bounds",
          ...bounds,
          scaleFactor,
          revision: ++boundsRevision,
        },
      ).then(() => undefined);
      follow = observeFrameBounds({
        target,
        observed: options.anchor,
        measure: screenBounds,
        apply: setBounds,
        isActive: () => current === options,
      });
      follow.sync();
      const refreshMetrics = async (): Promise<void> => {
        [origin, scaleFactor] = await Promise.all([
          hostWindow.innerPosition(),
          hostWindow.scaleFactor(),
        ]);
        follow?.sync();
      };
      void hostWindow.onMoved?.(() => {
        follow?.sync();
        void refreshMetrics().catch(() => undefined);
      }).then((off) => {
        if (current !== options) off();
        else unlistenMoved = off;
      });
      void hostWindow.onResized?.(() => {
        follow?.sync();
        void refreshMetrics().catch(() => undefined);
      }).then((off) => {
        if (current !== options) off();
        else unlistenResized = off;
      });
    },
    close: hide,
  };
  Object.defineProperty(paneWindow, HOST_OVERLAY_MARKER, {
    configurable: true,
    value: controller,
  });
  return controller;
}

function observeBounds(
  container: HTMLElement,
  view: TauriWebview,
  isVisible: () => boolean,
): FrameBoundsObserver {
  const target = container.ownerDocument.defaultView ?? window;
  return observeFrameBounds({
    target,
    observed: container,
    measure: () => {
      const rect = container.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
    },
    apply: ({ x, y, width, height }) => view.setBounds(x, y, width, height),
    isActive: isVisible,
  });
}

/** 主窗口真实 Tauri API → 既有通用 adapter；浏览器环境返回 undefined。 */
export function createGlobalTauriPaneViewAdapter(
  target: Window = window,
): PaneViewAdapter<TauriPaneMountTarget> | undefined {
  const paneWindow = target as TauriWindow;
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return undefined;
  const existing = paneWindow[HOST_ADAPTER_MARKER];
  if (existing !== undefined) return existing;
  const cleanup = runtime.core.invoke("pane_webview_cleanup")
    // WebView2 关闭后标签注册表异步释放；让同标签重建越过一帧。
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    .catch(() => undefined);
  // Native child layout owns bounds in Rust; only the legacy floating path
  // tracks the DOM slot.
  const nativeLayout = runtime.core.invoke("pane_layout_is_native")
    .then((value) => value === true)
    .catch(() => false);
  const pendingCreates: Array<{
    readonly container: HTMLElement;
    readonly instanceId: string;
    readonly resolve: () => void;
  }> = [];
  let createRunning = false;
  let activeCreateInstanceId: string | undefined;
  let activeCreateWatchdog: ReturnType<typeof setTimeout> | undefined;
  let createPump: ReturnType<typeof setTimeout> | undefined;
  const activeBounds = new Set<FrameBoundsObserver>();
  // 原生 Resize 先到此处，随后每帧按真实 DOM rect 细调；避免 WebView 等待页面事件。
  void runtime.event.listen(TAURI_PANE_HOST_LAYOUT_EVENT, () => {
    for (const bounds of activeBounds) bounds.sync();
  }).catch(() => undefined);
  const scheduleCreate = (): void => {
    if (createRunning || createPump !== undefined || pendingCreates.length === 0) return;
    createPump = setTimeout(() => {
      createPump = undefined;
      if (createRunning || pendingCreates.length === 0) return;
      const activeIndex = pendingCreates.findIndex(
        (job) => job.container.style.display !== "none",
      );
      const [job] = pendingCreates.splice(activeIndex >= 0 ? activeIndex : 0, 1);
      if (job === undefined) return;
      createRunning = true;
      activeCreateInstanceId = job.instanceId;
      activeCreateWatchdog = setTimeout(() => releaseCreate(job.instanceId), 10_000);
      job.resolve();
    }, 16);
  };
  const acquireCreate = (container: HTMLElement, instanceId: string): Promise<void> =>
    new Promise((resolve) => {
      pendingCreates.push({ container, instanceId, resolve });
      scheduleCreate();
    });
  const releaseCreate = (instanceId?: string): void => {
    if (
      !createRunning ||
      (instanceId !== undefined && activeCreateInstanceId !== instanceId)
    ) return;
    if (activeCreateWatchdog !== undefined) clearTimeout(activeCreateWatchdog);
    activeCreateWatchdog = undefined;
    activeCreateInstanceId = undefined;
    createRunning = false;
    setTimeout(scheduleCreate, 120);
  };
  const relayListeners = new Set<(payload: unknown) => void>();
  const relayListenerReady = runtime.event.listen(TAURI_PANE_RELAY_HOST_EVENT, ({ payload }) => {
    const envelope = payload as {
      readonly instanceId?: unknown;
      readonly message?: { readonly type?: unknown };
    };
    if (
      typeof envelope.instanceId === "string" &&
      envelope.instanceId === activeCreateInstanceId &&
      envelope.message?.type === "pane:ready"
    ) releaseCreate(envelope.instanceId);
    for (const listener of relayListeners) listener(payload);
  }).catch(() => undefined);
  const adapter = createTauriPaneViewAdapter({
    invoke: (command, args) => runtime.core.invoke(command, args),
    onRelayMessage(listener) {
      relayListeners.add(listener);
      return () => relayListeners.delete(listener);
    },
    async createPaneWebview({ label, url, instanceId, container, visible }): Promise<TauriPaneWebview> {
      if (container === undefined) throw new Error("Tauri Pane WebView requires a mount container");
      const useNativeLayout = await nativeLayout;
      await Promise.all([cleanup, relayListenerReady]);
      await acquireCreate(container, instanceId);
      const hostWindow = runtime.window.getCurrentWindow();
      let shown = visible === true;
      let hostOrigin = { x: 0, y: 0 };
      let hostScaleFactor = 1;
      let metricsRevision = 0;
      const refreshWindowMetrics = async (): Promise<void> => {
        const revision = ++metricsRevision;
        const [origin, scaleFactor] = await Promise.all([
          hostWindow.innerPosition(),
          hostWindow.scaleFactor(),
        ]);
        if (revision !== metricsRevision) return;
        hostOrigin = origin;
        hostScaleFactor = scaleFactor;
      };
      try {
        await refreshWindowMetrics();
      } catch (error) {
        releaseCreate(activeCreateInstanceId);
        throw error;
      }
      const screenBounds = (
        x: number,
        y: number,
        width: number,
        height: number,
      ): Promise<{
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly scaleFactor: number;
      }> => {
        const browserOriginX = Number.isFinite(target.screenX)
          ? target.screenX
          : hostOrigin.x / hostScaleFactor;
        const browserOriginY = Number.isFinite(target.screenY)
          ? target.screenY
          : hostOrigin.y / hostScaleFactor;
        return Promise.resolve({
          x: browserOriginX + x,
          y: browserOriginY + y,
          width,
          height,
          scaleFactor: hostScaleFactor,
        });
      };
      const rect = container.getBoundingClientRect();
      const preload = await screenBounds(
        rect.left,
        rect.top,
        Math.max(1, rect.width),
        Math.max(1, rect.height),
      );
      try {
        await runtime.core.invoke("pane_webview_window_create", {
          label,
          url,
          x: preload.x,
          y: preload.y,
          width: preload.width,
          height: preload.height,
          visible: shown,
        });
      } catch (error) {
        releaseCreate(instanceId);
        throw error;
      }
      // 活跃 Pane 完成 readiness 后方节流创建后台 Pane；切换 Tab 可提升待建优先级。
      const control = (
        action: "show" | "hide" | "reload" | "close" | "set-bounds",
        bounds?: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
          readonly scaleFactor: number;
        },
        revision?: number,
      ): Promise<unknown> => runtime.core.invoke("pane_webview_window_control", {
        label,
        action,
        ...bounds,
        revision,
      });
      let boundsRevision = 0;
      const view: TauriWebview = {
        setBounds: async (x, y, width, height) => {
          await control(
            "set-bounds",
            await screenBounds(x, y, width, height),
            ++boundsRevision,
          );
        },
        show: async () => { await control("show"); },
        hide: async () => { await control("hide"); },
        reload: async () => { await control("reload"); },
        close: async () => { await control("close"); },
      };
      const bounds = useNativeLayout
        ? undefined
        : observeBounds(container, view, () => shown);
      if (bounds !== undefined) activeBounds.add(bounds);
      let disposed = false;
      let unlistenMoved: (() => void) | undefined;
      let unlistenResized: (() => void) | undefined;
      if (!useNativeLayout) {
        void hostWindow.onMoved?.(() => {
          // screenX/screenY 已可同步读到；先推一帧，异步刷新 DPI 后再校正一次。
          bounds?.sync();
          void refreshWindowMetrics().then(() => bounds?.sync());
        }).then((off) => {
          if (disposed) off();
          else unlistenMoved = off;
        });
        void hostWindow.onResized?.(() => {
          bounds?.sync();
          void refreshWindowMetrics().then(() => bounds?.sync());
        }).then((off) => {
          if (disposed) off();
          else unlistenResized = off;
        });
      }
      const place = async (): Promise<void> => {
        if (useNativeLayout) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        await view.setBounds(rect.left, rect.top, rect.width, rect.height);
      };
      return {
        show: async () => {
          shown = true;
          await place();
          await view.show();
          bounds?.sync();
        },
        hide: async () => {
          shown = false;
          await view.hide();
        },
        reload: () => view.reload?.() ?? Promise.resolve(),
        close: async () => {
          shown = false;
          disposed = true;
          releaseCreate(instanceId);
          if (bounds !== undefined) {
            activeBounds.delete(bounds);
            bounds.dispose();
          }
          unlistenMoved?.();
          unlistenResized?.();
          await view.hide().catch(() => undefined);
          await view.close();
        },
      };
    },
  }, { allowedProtocols: ["http:", "https:"] });
  Object.defineProperty(paneWindow, HOST_ADAPTER_MARKER, {
    configurable: true,
    value: adapter,
  });
  return adapter;
}

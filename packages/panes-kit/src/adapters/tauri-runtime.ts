import { createLogger } from "@blksails/pi-web-logger";
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

/**
 * 几何链路诊断（spec desktop-pane-chrome-occlusion，Req 3.1/3.2/3.5）。
 *
 * ★ 为什么这条链路非留痕不可：量槽、上报、门查询三处原本都是 fail-soft 且**一处痕迹都不留**。
 *   叠加起来的效果是「chrome 被盖住，但没有任何一层报错」——本缺陷只能靠肉眼在真机上撞见，
 *   调查成本几乎全部花在「分不清断在哪一环」上。诊断的价值不在于有日志，而在于**能判别候选**。
 *
 * 沿用仓库既有约定：默认关闭、不重新编译即可开启（`configureLogger`）。
 */
const log = createLogger({ namespace: "panes:geometry" });

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

/** 量槽失败的原因。★ 必须可分辨——「没量到」与「量到 0」是两回事。 */
export type MeasureRejection =
  /** 元素已从文档树摘除。 */
  | "detached"
  /** 量到了，但宽或高小于可用阈值（侧栏收起 / 首帧未布局）。 */
  | "too-small";

/**
 * 量槽结果。
 *
 * ★ 之所以不能继续返回裸 `undefined`：调用方无从区分「元素没了」「还没布局」「尺寸真的是 0」，
 *   于是只能一律当作「跳过」，而跳过的后果是几何永远到不了布局侧、pane 停在默认矩形上。
 */
export type MeasureOutcome =
  | { readonly kind: "measured"; readonly metrics: TauriPaneLayoutMetrics }
  | {
      readonly kind: "unavailable";
      readonly reason: MeasureRejection;
      /** 被丢弃时的实测矩形；`detached` 时不可得，为 `undefined`。 */
      readonly rect: { readonly width: number; readonly height: number } | undefined;
    };

/**
 * 上报结果。调用方（宿主几何门控）据此决定是否放行 `show`。
 *
 * `skipped-unchanged` 与 `delivered` 同样表示「布局侧处于已知态」——几何没变说明先前已送达过。
 */
export type PublishOutcome =
  | { readonly kind: "delivered" }
  | { readonly kind: "skipped-unchanged" }
  | { readonly kind: "not-measured"; readonly reason: MeasureRejection }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * native 几何门的探测结果。
 *
 * ★ 现状把「命令报错」与「本来就不是 native」压成同一个 `false`，两种完全不同的状况因此
 *   无法分辨。而它们的后果天差地别：前者是故障（几何上报会整条不装），后者是正常的网页/回退形态。
 */
export type NativeLayoutProbe =
  | { readonly kind: "native" }
  | { readonly kind: "not-native" }
  /** 运行时不存在（非 Tauri 宿主），连问都问不到。 */
  | { readonly kind: "no-runtime" }
  | { readonly kind: "query-failed"; readonly reason: string };

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
  readonly selected?: boolean;
}

export interface TauriPaneOverlayOpenOptions {
  readonly title: string;
  readonly items: readonly TauriPaneOverlayItem[];
  /**
   * 侧栏 content-well（或与 content webview 同槽的元素）。
   * overlay child 的位置/大小与之贴合；内部蒙版铺满该槽。
   */
  readonly cover: Element;
  /** 菜单卡片在槽内的对齐（相对槽，非整窗）。 */
  readonly placement?: "anchor-end" | "center";
  /** 可选：用于主题采样；缺省用 cover。 */
  readonly anchor?: Element;
  readonly onSelect: (id: string) => void;
  /** 菜单关闭（选中、取消、遮罩）时回调。 */
  readonly onClose?: () => void;
}

export interface TauriPaneOverlayController {
  open(options: TauriPaneOverlayOpenOptions): Promise<void>;
  close(): void;
  /**
   * 启动时预建隐藏 overlay child（空 shell）。首开只 configure+show，免冷创建延迟。
   */
  warm(): Promise<void>;
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

/** 隐藏全部 content pane（保活）；侧栏收起 / 无侧栏页用。 */
export function hideTauriContentPanes(target: Window = window): Promise<void> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return Promise.resolve();
  return runtime.core
    .invoke("pane_webview_hide_all")
    .then(() => undefined)
    .catch(() => setTauriPaneLayoutMode("host-fullscreen", target));
}

/** 销毁全部 pane webview（卸载 / 换源 / 登出）。 */
export function destroyTauriContentPanes(target: Window = window): Promise<void> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) return Promise.resolve();
  return runtime.core
    .invoke("pane_webview_cleanup")
    .then(() => undefined)
    .catch(() => undefined);
}

/** 宿主槽位真正变化时上报一次，避免持续读取 DOM 坐标。 */
export function setTauriPaneLayoutMetrics(
  metrics: TauriPaneLayoutMetrics,
  target: Window = window,
): Promise<PublishOutcome> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) {
    // 非 Tauri 宿主：本函数无事可做，也不是故障。不留痕，避免网页形态刷屏。
    return Promise.resolve({ kind: "skipped-unchanged" });
  }
  return runtime.core.invoke("pane_layout_set_metrics", { metrics })
    .then((): PublishOutcome => ({ kind: "delivered" }))
    .catch((reason: unknown): PublishOutcome => {
      // ★ 原实现没有 catch：拒绝会作为未处理的异步拒绝逃逸出去，既不报错也不影响流程，
      //   于是「几何没送到」在任何地方都留不下痕迹。布局侧的校验拒绝正是从这里消失的。
      const message = reason instanceof Error ? reason.message : String(reason);
      log.warn("几何上报未送达", { metrics, reason: message });
      return { kind: "failed", reason: message };
    });
}

/**
 * 探测 native 几何门，四态可分辨（Req 3.2）。
 *
 * ★ 与 {@link isTauriNativePaneLayout} 的区别正是本 spec 的重点：后者把 `query-failed`
 *   压成 `false`，与「本来就不是 native」不可区分。而这两者的后果完全不同——前者意味着
 *   几何上报链路整条不会安装（child WebView 却照建），也就是 chrome 被永久盖住。
 */
export function probeTauriNativePaneLayout(
  target: Window = window,
): Promise<NativeLayoutProbe> {
  const runtime = tauriRuntime(target);
  if (runtime === undefined || !isTauriPaneRuntime(target)) {
    return Promise.resolve({ kind: "no-runtime" });
  }
  return runtime.core.invoke("pane_layout_is_native")
    .then((value): NativeLayoutProbe =>
      value === true ? { kind: "native" } : { kind: "not-native" })
    .catch((reason: unknown): NativeLayoutProbe => {
      const message = reason instanceof Error ? reason.message : String(reason);
      log.warn("native 几何门查询失败，几何上报将不会安装", { reason: message });
      return { kind: "query-failed", reason: message };
    });
}

/**
 * 是否启用内部 child WebView 布局（host 铺满 + content-well 盖 child）。
 *
 * 保留布尔形态供既有调用点使用；需要分辨故障与形态时用 {@link probeTauriNativePaneLayout}。
 */
export function isTauriNativePaneLayout(target: Window = window): Promise<boolean> {
  return probeTauriNativePaneLayout(target).then((probe) => probe.kind === "native");
}

/**
 * 由 content-well 元素量取并上报 native 槽位几何。
 * host 铺满窗口；child 只盖本矩形，tabs/resize 留在 host。
 *
 * **单路 rAF 合并**：拖拽时 ResizeObserver + 显式 sync 事件会叠两层；
 * 同帧多次调用只发一次 IPC，且几何未变（≤0.5px）则跳过，避免过度插帧。
 *
 * **show 前**请用 `ensureTauriContentWellMetrics`（同步量 + await IPC），
 * 勿只调 publish（仅排 rAF，show 会抢在错误/默认槽上）。
 */
let metricsRaf = 0;
let metricsTarget: Window | undefined;
let metricsWell: Element | undefined;
let metricsMinWidth = 240;
let lastMetricsKey = "";

function cancelMetricsRaf(): void {
  if (metricsRaf !== 0 && metricsTarget !== undefined) {
    metricsTarget.cancelAnimationFrame(metricsRaf);
  }
  metricsRaf = 0;
}

export function measureContentWell(
  well: Element,
  target: Window,
  minWidth: number,
): MeasureOutcome {
  if (!well.isConnected) {
    log.debug("量槽跳过：元素已摘除", { minWidth });
    return { kind: "unavailable", reason: "detached", rect: undefined };
  }
  const rect = well.getBoundingClientRect();
  // 槽宽高过小（侧栏收起/未布局）勿上报，避免把 Rust 槽压成 1×1 白屏。
  if (!(rect.width >= 48) || !(rect.height >= 48)) {
    // ★ 留痕而非静默丢弃：这一条是 C2 候选（首帧未布局）的唯一观测点。原实现返回裸
    //   `undefined`，调用方只能当作「跳过」继续往下走 show，pane 就停在布局侧的默认矩形上。
    log.debug("量槽跳过：槽尺寸不足", { width: rect.width, height: rect.height });
    return {
      kind: "unavailable",
      reason: "too-small",
      rect: { width: rect.width, height: rect.height },
    };
  }
  return {
    kind: "measured",
    metrics: {
      leftWidth: Math.max(0, rect.left),
      topHeight: Math.max(0, rect.top),
      paneWidth: Math.max(48, rect.width),
      bottomHeight: Math.max(0, target.innerHeight - rect.bottom),
      minWidth,
    },
  };
}

function metricsKey(m: TauriPaneLayoutMetrics): string {
  return [
    (m.leftWidth ?? 0).toFixed(1),
    (m.topHeight ?? 0).toFixed(1),
    (m.paneWidth ?? 0).toFixed(1),
    (m.bottomHeight ?? 0).toFixed(1),
    String(m.minWidth ?? 240),
  ].join("|");
}

function flushContentWellMetrics(): Promise<PublishOutcome> {
  metricsRaf = 0;
  const target = metricsTarget ?? window;
  const well = metricsWell;
  const minWidth = metricsMinWidth;
  metricsWell = undefined;
  metricsTarget = undefined;
  if (well === undefined) return Promise.resolve({ kind: "skipped-unchanged" });
  const outcome = measureContentWell(well, target, minWidth);
  if (outcome.kind === "unavailable") {
    return Promise.resolve({ kind: "not-measured", reason: outcome.reason });
  }
  const key = metricsKey(outcome.metrics);
  if (key === lastMetricsKey) return Promise.resolve({ kind: "skipped-unchanged" });
  lastMetricsKey = key;
  return setTauriPaneLayoutMetrics(outcome.metrics, target);
}

export function publishTauriContentWellMetrics(
  well: Element,
  options: { readonly minWidth?: number; readonly target?: Window } = {},
): Promise<void> {
  metricsWell = well;
  metricsTarget = options.target ?? window;
  metricsMinWidth = options.minWidth ?? 240;
  if (metricsRaf !== 0) return Promise.resolve();
  const win = metricsTarget;
  metricsRaf = win.requestAnimationFrame(() => {
    void flushContentWellMetrics();
  });
  return Promise.resolve();
}

function waitAnimationFrame(target: Window): Promise<void> {
  return new Promise((resolve) => {
    target.requestAnimationFrame(() => resolve());
  });
}

/**
 * 立刻量 content-well 并 **await** IPC（取消待发 rAF）。
 * 用于 pane:ready / show 之前；拖拽路径只用 publish（单 rAF），勿对每帧 ensure。
 *
 * settle：最多 4 帧等几何稳定，**只在稳定/末帧发一次 IPC**（中间帧不灌 set_metrics）。
 */
export async function ensureTauriContentWellMetrics(
  well: Element,
  options: {
    readonly minWidth?: number;
    readonly target?: Window;
    /** 忽略 lastMetricsKey，强制下发。 */
    readonly force?: boolean;
    /** 等布局稳定再下发；默认 false（跟手）。首 show 可 true。 */
    readonly settle?: boolean;
  } = {},
): Promise<PublishOutcome> {
  const target = options.target ?? window;
  const minWidth = options.minWidth ?? 240;
  cancelMetricsRaf();
  metricsWell = undefined;
  metricsTarget = undefined;

  // ★ 返回值不再是 void：宿主几何门控要据此决定「是否放行 show」（Req 4.2）。
  //   原实现无论量没量到都静默返回，调用方无从判断布局侧是否已处于已知态。
  const publishOnce = async (force: boolean): Promise<PublishOutcome> => {
    const outcome = measureContentWell(well, target, minWidth);
    if (outcome.kind === "unavailable") {
      return { kind: "not-measured", reason: outcome.reason };
    }
    const key = metricsKey(outcome.metrics);
    if (!force && key === lastMetricsKey) return { kind: "skipped-unchanged" };
    lastMetricsKey = key;
    return await setTauriPaneLayoutMetrics(outcome.metrics, target);
  };

  if (options.settle !== true) {
    return await publishOnce(options.force === true);
  }

  // 稳定采样：中间帧只量不算 IPC，避免「多层插帧」感。
  let prev = "";
  let lastRejection: MeasureRejection | undefined;
  for (let i = 0; i < 4; i += 1) {
    const outcome = measureContentWell(well, target, minWidth);
    if (outcome.kind === "measured") {
      const key = metricsKey(outcome.metrics);
      if (key === prev && i > 0) {
        lastMetricsKey = key;
        return await setTauriPaneLayoutMetrics(outcome.metrics, target);
      }
      prev = key;
    } else {
      lastRejection = outcome.reason;
    }
    await waitAnimationFrame(target);
  }
  const final = await publishOnce(true);
  // 四帧里一次都没量到：把最后一次的拒绝原因带出去，别报成「跳过」。
  if (final.kind === "not-measured" && lastRejection !== undefined) {
    return { kind: "not-measured", reason: lastRejection };
  }
  return final;
}

/** 测试/强制立即刷出待发 metrics（跳过 rAF）。 */
export function flushTauriContentWellMetricsNow(): void {
  cancelMetricsRaf();
  void flushContentWellMetrics();
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
  let shellReady = false;
  let warmPromise: Promise<void> | undefined;
  let current: TauriPaneOverlayOpenOptions | undefined;
  let boundsRevision = 0;
  let follow: FrameBoundsObserver | undefined;
  let unlistenMoved: (() => void) | undefined;
  let unlistenResized: (() => void) | undefined;
  let hostOrigin = { x: 0, y: 0 };
  let hostScale = 1;
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
  const raiseOverlay = (): Promise<unknown> =>
    runtime.core.invoke("pane_webview_window_control", {
      label: OVERLAY_LABEL,
      action: "show",
    }).then(() => runtime.core.invoke("pane_webview_window_control", {
      label: OVERLAY_LABEL,
      action: "focus",
    }));
  const listenerReady = runtime.event.listen(TAURI_PANE_RELAY_HOST_EVENT, ({ payload }) => {
    const envelope = payload as {
      readonly instanceId?: unknown;
      readonly message?: {
        readonly type?: unknown;
        readonly token?: unknown;
        readonly value?: unknown;
      };
    };
    if (envelope.instanceId !== OVERLAY_INSTANCE_ID) return;
    const msgToken = envelope.message?.token;
    // warm shell ready (token 0)
    if (envelope.message?.type === "pane:overlay-ready" && msgToken === 0) {
      shellReady = true;
      return;
    }
    if (msgToken !== token) return;
    if (envelope.message?.type === "pane:overlay-ready") {
      if (shownToken === token) return;
      shownToken = token;
      // 立刻抬起 + 短延迟再 focus，压过 content 抢焦。
      void raiseOverlay()
        .then(() => new Promise((r) => setTimeout(r, 40)))
        .then(() => (shownToken === token && current !== undefined ? raiseOverlay() : undefined))
        .then(() => new Promise((r) => setTimeout(r, 160)))
        .then(() => (shownToken === token && current !== undefined ? raiseOverlay() : undefined))
        .catch(() => undefined);
      return;
    }
    if (envelope.message?.type === "pane:overlay-select") {
      const selected = current?.onSelect;
      const value = envelope.message.value;
      hide();
      if (typeof value === "string") selected?.(value);
      return;
    }
    if (envelope.message?.type === "pane:overlay-close") hide();
  });
  void runtime.event.listen(TAURI_PANE_HOST_LAYOUT_EVENT, () => follow?.sync())
    .catch(() => undefined);

  const shellUrl = (): string => {
    const url = new URL("/pane-overlay.html", target.location.href);
    url.searchParams.set("instanceId", OVERLAY_INSTANCE_ID);
    url.searchParams.set("token", "0");
    url.searchParams.set("title", "");
    url.searchParams.set("items", "[]");
    return url.href;
  };

  /**
   * 只确保隐藏壳已建（BIND+CREATE token=0 空壳）；resolve 快，供 open 串行导航。
   * 拆开是为了消除「warm 建壳」与「open navigate」对同一 label 的并发 create 竞态。
   */
  let shellPromise: Promise<void> | undefined;
  const ensureShellCreated = (): Promise<void> => {
    if (shellPromise !== undefined) return shellPromise;
    shellPromise = (async () => {
      await listenerReady;
      try {
        const hostWindow = runtime.window.getCurrentWindow();
        const [origin, scaleFactor] = await Promise.all([
          hostWindow.innerPosition(),
          hostWindow.scaleFactor(),
        ]);
        hostOrigin = origin;
        hostScale = scaleFactor;
      } catch {
        // open 时再刷 metrics
      }
      const x = Number.isFinite(target.screenX) ? target.screenX - 200 : -200;
      const y = Number.isFinite(target.screenY) ? target.screenY - 200 : -200;
      await runtime.core.invoke(TAURI_PANE_RELAY_BIND_COMMAND, {
        instanceId: OVERLAY_INSTANCE_ID,
        epoch: 0,
        label: OVERLAY_LABEL,
      });
      await runtime.core.invoke("pane_webview_window_create", {
        label: OVERLAY_LABEL,
        url: shellUrl(),
        x,
        y,
        width: 320,
        height: 240,
        visible: false,
      });
    })().catch((err) => {
      shellPromise = undefined;
      throw err;
    });
    return shellPromise;
  };

  /**
   * 预热只建隐藏壳，拉起 WebView2 进程；**open 一律 navigate 带参**，
   * 不走 to_guest configure（子 webview 事件监听/epoch 易静默失败 → 菜单永不 show）。
   */
  const ensureWarm = (): Promise<void> => {
    if (warmPromise !== undefined) return warmPromise;
    if (shellReady) return Promise.resolve();
    warmPromise = (async () => {
      await ensureShellCreated();
      // 最多等 1.5s 记 shellReady；超时仍算 warm 完成（open 会 navigate 复用 label）。
      const deadline = Date.now() + 1_500;
      while (!shellReady && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
    })().catch((err) => {
      warmPromise = undefined;
      throw err;
    });
    return warmPromise;
  };

  const controller: TauriPaneOverlayController = {
    warm: () => ensureWarm().catch(() => undefined),
    async open(options) {
      stopFollowing();
      current = options;
      const currentToken = ++token;
      shownToken = 0;
      await listenerReady;
      // 先确保壳已建（无并发 create 竞态）；失败不挡 open（下面 create/navigate 自建）。
      await ensureShellCreated().catch(() => undefined);
      const hostWindow = runtime.window.getCurrentWindow();
      try {
        const [origin, scaleFactor] = await Promise.all([
          hostWindow.innerPosition(),
          hostWindow.scaleFactor(),
        ]);
        hostOrigin = origin;
        hostScale = scaleFactor;
      } catch {
        // keep last
      }
      // 槽位 = 侧栏 content-well：与 content child webview 同位置同大小。
      const screenBounds = (): PaneScreenBounds => {
        const rect = options.cover.getBoundingClientRect();
        const originX = Number.isFinite(target.screenX)
          ? target.screenX
          : hostOrigin.x / hostScale;
        const originY = Number.isFinite(target.screenY)
          ? target.screenY
          : hostOrigin.y / hostScale;
        return {
          x: originX + rect.left,
          y: originY + rect.top,
          width: Math.max(48, rect.width),
          height: Math.max(48, rect.height),
        };
      };
      const initialBounds = screenBounds();
      const themeEl = options.anchor ?? options.cover;
      const style = getComputedStyle(themeEl);
      const theme = {
        colorScheme: style.colorScheme,
        background: style.getPropertyValue("--popover").trim()
          || style.getPropertyValue("--background").trim(),
        foreground: style.getPropertyValue("--popover-foreground").trim()
          || style.getPropertyValue("--foreground").trim(),
        border: style.getPropertyValue("--border").trim(),
        accent: style.getPropertyValue("--accent").trim(),
        muted: style.getPropertyValue("--muted-foreground").trim(),
      };
      // 绑定 epoch=0：guest 上行 ready 亦 epoch 0；会话号在 message.token。
      await runtime.core.invoke(TAURI_PANE_RELAY_BIND_COMMAND, {
        instanceId: OVERLAY_INSTANCE_ID,
        epoch: 0,
        label: OVERLAY_LABEL,
      });

      // URL 带参 navigate；同次 Rust 调用即 show，勿再等 guest ready 才显（首击/切 tab 会丢 z-order）。
      const url = new URL("/pane-overlay.html", target.location.href);
      url.searchParams.set("instanceId", OVERLAY_INSTANCE_ID);
      url.searchParams.set("token", String(currentToken));
      url.searchParams.set("title", options.title);
      url.searchParams.set("items", JSON.stringify(options.items));
      url.searchParams.set("placement", options.placement ?? "center");
      url.searchParams.set("theme", JSON.stringify(theme));
      await runtime.core.invoke("pane_webview_window_create", {
        label: OVERLAY_LABEL,
        url: url.href,
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width,
        height: initialBounds.height,
        visible: true,
      });

      const setBounds = (bounds: PaneScreenBounds): Promise<void> => runtime.core.invoke(
        "pane_webview_window_control",
        {
          label: OVERLAY_LABEL,
          action: "set-bounds",
          ...bounds,
          scaleFactor: hostScale,
          revision: ++boundsRevision,
        },
      ).then(() => undefined);
      follow = observeFrameBounds({
        target,
        observed: options.cover,
        measure: screenBounds,
        apply: setBounds,
        isActive: () => current === options,
      });
      follow.sync();
      const refreshMetrics = async (): Promise<void> => {
        try {
          const [origin, scaleFactor] = await Promise.all([
            hostWindow.innerPosition(),
            hostWindow.scaleFactor(),
          ]);
          hostOrigin = origin;
          hostScale = scaleFactor;
        } catch {
          // ignore
        }
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

      // ready 丢失时的兜底：1.2s 后若仍未 show 且仍是本次 open，强制 raise 一次。
      void (async () => {
        await new Promise((r) => setTimeout(r, 1_200));
        if (current !== options || shownToken === currentToken) return;
        shownToken = currentToken;
        await raiseOverlay().catch(() => undefined);
      })();
    },
    close: hide,
  };
  Object.defineProperty(paneWindow, HOST_OVERLAY_MARKER, {
    configurable: true,
    value: controller,
  });
  // 创建 controller 即后台 warm，不阻塞 UI。
  void controller.warm();
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

/** content pane 预热池大小：启动预建隐藏壳，首开 navigate 复用。 */
const CONTENT_WARM_POOL_SIZE = 1;
const CONTENT_WARM_LABEL_PREFIX = "pane-warm-";

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
  // 预热池：ready 可领；claimed 在用；warming 创建中。
  type WarmSlot = { readonly label: string; state: "warming" | "ready" | "claimed" };
  const warmPool: WarmSlot[] = [];
  let warmSeq = 0;
  let warmFillPromise: Promise<void> | undefined;
  const warmShellUrl = (): string => {
    const url = new URL("/pane-warm.html", target.location.href);
    return url.href;
  };
  const createWarmShell = async (label: string): Promise<void> => {
    // 屏外占位；native layout 会忽略坐标，仅 visible:false 即可。
    const x = Number.isFinite(target.screenX) ? target.screenX - 200 : -200;
    const y = Number.isFinite(target.screenY) ? target.screenY - 200 : -200;
    await runtime.core.invoke("pane_webview_window_create", {
      label,
      url: warmShellUrl(),
      x,
      y,
      width: 320,
      height: 240,
      visible: false,
    });
  };
  const fillWarmPool = (): Promise<void> => {
    if (warmFillPromise !== undefined) return warmFillPromise;
    warmFillPromise = (async () => {
      await cleanup;
      while (warmPool.filter((s) => s.state === "ready" || s.state === "warming").length < CONTENT_WARM_POOL_SIZE) {
        const label = `${CONTENT_WARM_LABEL_PREFIX}${warmSeq++}`;
        const slot: WarmSlot = { label, state: "warming" };
        warmPool.push(slot);
        try {
          await createWarmShell(label);
          if (slot.state === "warming") slot.state = "ready";
        } catch {
          const idx = warmPool.indexOf(slot);
          if (idx >= 0) warmPool.splice(idx, 1);
        }
      }
    })().finally(() => {
      warmFillPromise = undefined;
    });
    return warmFillPromise;
  };
  const claimWarmLabel = (): string | undefined => {
    const slot = warmPool.find((s) => s.state === "ready");
    if (slot === undefined) {
      void fillWarmPool().catch(() => undefined);
      return undefined;
    }
    slot.state = "claimed";
    // 后台补一枚，供下一次新开。
    void fillWarmPool().catch(() => undefined);
    return slot.label;
  };
  const waitWarmLabel = async (timeoutMs: number): Promise<string | undefined> => {
    void fillWarmPool().catch(() => undefined);
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      const claimed = claimWarmLabel();
      if (claimed !== undefined) return claimed;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    return claimWarmLabel();
  };
  const releaseWarmLabel = async (label: string): Promise<boolean> => {
    const slot = warmPool.find((s) => s.label === label);
    if (slot === undefined) return false;
    try {
      await runtime.core.invoke("pane_webview_window_control", {
        label,
        action: "hide",
      }).catch(() => undefined);
      // 回到空壳，避免下一 claim 仍显示旧 pane 文档一帧。
      await createWarmShell(label);
      slot.state = "ready";
      return true;
    } catch {
      const idx = warmPool.indexOf(slot);
      if (idx >= 0) warmPool.splice(idx, 1);
      void fillWarmPool().catch(() => undefined);
      return false;
    }
  };
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
  // 启动即预建隐藏 content webview；cleanup 完成后执行。
  void fillWarmPool().catch(() => undefined);
  const adapter = createTauriPaneViewAdapter({
    invoke: (command, args) => runtime.core.invoke(command, args),
    onRelayMessage(listener) {
      relayListeners.add(listener);
      return () => relayListeners.delete(listener);
    },
    claimWarmLabel,
    waitWarmLabel,
    releaseWarmLabel,
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

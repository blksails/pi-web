/**
 * PanesHost 元素存在性/可见性 → 侧栏 native webview 生命周期（公共能力）。
 *
 * - 未挂载（disconnect / unmount）→ destroy 全部 content pane webview
 * - 已挂载但不可见（收起侧栏、opacity/display、祖先折叠）→ hide 全部
 * - 已挂载且可见 → 通知恢复（可选 restore）
 *
 * 不依赖具体宿主路由；只要挂了 `[data-panes-host]` 即可。
 */

export type PanesHostPresenceState = "missing" | "hidden" | "visible";

export interface PanesHostPresenceBackend {
  /** 隐藏全部 content pane（保留实例）。 */
  hideAll(): void | Promise<void>;
  /** 销毁全部 pane webview。 */
  destroyAll(): void | Promise<void>;
  /** 宿主重新可见时可选恢复布局/当前 tab。 */
  restoreVisible?(): void | Promise<void>;
}

export interface ObservePanesHostPresenceOptions {
  readonly backend?: PanesHostPresenceBackend;
  readonly target?: Window;
  readonly onStateChange?: (state: PanesHostPresenceState) => void;
  /** 判定「不可见」的最小面积（px²）；默认 32×32。 */
  readonly minVisibleArea?: number;
}

const HOST_SELECTOR = "[data-panes-host]";

function tauriInvoke(
  target: Window,
  command: string,
): Promise<void> {
  const tauri = (target as Window & {
    readonly __TAURI__?: { readonly core?: { invoke?(cmd: string, args?: Record<string, unknown>): Promise<unknown> } };
  }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (typeof invoke !== "function") return Promise.resolve();
  return invoke(command).then(() => undefined).catch(() => undefined);
}

/** 默认后端：Tauri desktop shell。非桌面环境 no-op。 */
export function createDefaultPanesHostPresenceBackend(
  target: Window = window,
): PanesHostPresenceBackend {
  return {
    hideAll: () => tauriInvoke(target, "pane_webview_hide_all"),
    destroyAll: () => tauriInvoke(target, "pane_webview_cleanup"),
    restoreVisible: () => {
      const invoke = (target as Window & {
        readonly __TAURI__?: { readonly core?: { invoke?(cmd: string, args?: Record<string, unknown>): Promise<unknown> } };
      }).__TAURI__?.core?.invoke;
      if (typeof invoke === "function") {
        void invoke("pane_layout_set_mode", { mode: "workspace" }).catch(() => undefined);
      }
      target.dispatchEvent(new Event("pi-panes-content-well-sync"));
      target.dispatchEvent(new Event("pi-panes-restore-visible"));
    },
  };
}

/**
 * 判定元素相对「用户可感知可见」：
 * 自身或祖先 display/visibility/opacity/aria-hidden/data-pi-panel-collapsed，
 * 以及几何面积。
 */
export function isPanesHostElementVisible(
  el: Element,
  options: { readonly minVisibleArea?: number; readonly target?: Window } = {},
): boolean {
  if (!el.isConnected) return false;
  const minArea = options.minVisibleArea ?? 32 * 32;
  const win = options.target ?? el.ownerDocument.defaultView ?? window;

  let node: Element | null = el;
  while (node !== null) {
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.getAttribute("data-pi-panel-collapsed") === "true") return false;
    if (node.getAttribute("data-pi-panel-open") === "false") return false;
    const style = win.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    node = node.parentElement;
  }

  const rect = el.getBoundingClientRect();
  if (!(rect.width * rect.height >= minArea)) return false;
  // 完全在视口外也算不可见（侧栏拖出屏幕等）。
  if (
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= win.innerHeight ||
    rect.left >= win.innerWidth
  ) {
    return false;
  }
  return true;
}

function resolveState(
  el: Element | null,
  options: { readonly minVisibleArea?: number; readonly target?: Window },
): PanesHostPresenceState {
  if (el === null || !el.isConnected) return "missing";
  return isPanesHostElementVisible(el, options) ? "visible" : "hidden";
}

/**
 * 监控单个 PanesHost 根节点。返回 dispose；dispose 时按 **missing** 销毁 webview。
 */
export function observePanesHostPresence(
  host: Element,
  options: ObservePanesHostPresenceOptions = {},
): () => void {
  const target = options.target ?? host.ownerDocument.defaultView ?? window;
  const backend = options.backend ?? createDefaultPanesHostPresenceBackend(target);
  const minVisibleArea = options.minVisibleArea;
  let disposed = false;
  let last: PanesHostPresenceState | undefined;
  let frame = 0;

  const apply = (state: PanesHostPresenceState, force = false): void => {
    if (!force && (disposed || state === last)) return;
    last = state;
    options.onStateChange?.(state);
    if (state === "missing") {
      void Promise.resolve(backend.destroyAll()).catch(() => undefined);
      return;
    }
    if (state === "hidden") {
      void Promise.resolve(backend.hideAll()).catch(() => undefined);
      return;
    }
    void Promise.resolve(backend.restoreVisible?.()).catch(() => undefined);
  };

  const evaluate = (): void => {
    if (disposed) return;
    apply(resolveState(host.isConnected ? host : null, { minVisibleArea, target }));
  };

  const schedule = (): void => {
    if (disposed) return;
    if (frame !== 0) return;
    frame = target.requestAnimationFrame(() => {
      frame = 0;
      evaluate();
    });
  };

  evaluate();

  const ro =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => schedule());
  ro?.observe(host);

  const io =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(() => schedule(), {
          root: null,
          threshold: [0, 0.01, 0.1],
        });
  io?.observe(host);

  const mo =
    typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver(() => schedule());
  mo?.observe(host, {
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden", "data-pi-panel-collapsed"],
  });
  // 祖先折叠（aside data-pi-panel-open）也要感知
  if (host.parentElement !== null && mo !== undefined) {
    mo.observe(host.parentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden", "data-pi-panel-open", "data-pi-panel-collapsed"],
      subtree: false,
    });
    let ancestor: Element | null = host.parentElement.parentElement;
    let depth = 0;
    while (ancestor !== null && depth < 6) {
      mo.observe(ancestor, {
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden", "data-pi-panel-open", "data-pi-panel-collapsed"],
      });
      ancestor = ancestor.parentElement;
      depth += 1;
    }
  }

  target.addEventListener("resize", schedule);
  target.addEventListener("pi-panes-content-well-sync", schedule);

  return () => {
    if (disposed) return;
    if (frame !== 0) target.cancelAnimationFrame(frame);
    ro?.disconnect();
    io?.disconnect();
    mo?.disconnect();
    target.removeEventListener("resize", schedule);
    target.removeEventListener("pi-panes-content-well-sync", schedule);
    // 元素卸载 = missing → 销毁（force，无视 disposed 短路）
    apply("missing", true);
    disposed = true;
  };
}

/**
 * 在 document 内查找 `[data-panes-host]` 并绑定监控（可选多实例，各自独立）。
 * 返回总 dispose。
 */
export function observeAllPanesHostsInDocument(
  doc: Document = document,
  options: ObservePanesHostPresenceOptions = {},
): () => void {
  const disposers = new Map<Element, () => void>();
  const bind = (el: Element): void => {
    if (disposers.has(el)) return;
    disposers.set(el, observePanesHostPresence(el, options));
  };
  const unbind = (el: Element): void => {
    const off = disposers.get(el);
    if (off === undefined) return;
    off();
    disposers.delete(el);
  };

  doc.querySelectorAll(HOST_SELECTOR).forEach(bind);

  const mo =
    typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver((records) => {
          for (const record of records) {
            record.removedNodes.forEach((node) => {
              if (!(node instanceof Element)) return;
              if (node.matches(HOST_SELECTOR)) unbind(node);
              node.querySelectorAll?.(HOST_SELECTOR).forEach(unbind);
            });
            record.addedNodes.forEach((node) => {
              if (!(node instanceof Element)) return;
              if (node.matches(HOST_SELECTOR)) bind(node);
              node.querySelectorAll?.(HOST_SELECTOR).forEach(bind);
            });
          }
        });
  mo?.observe(doc.documentElement, { childList: true, subtree: true });

  return () => {
    mo?.disconnect();
    for (const off of disposers.values()) off();
    disposers.clear();
  };
}

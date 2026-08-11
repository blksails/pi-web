/**
 * PanesHost 元素存在性/可见性 → 侧栏 native webview 生命周期（**唯一**公共闸门）。
 *
 * - 未挂载（disconnect / unmount / 路由切走）→ hide 全部 content pane webview（保活）
 * - 已挂载但不可见（收起侧栏、opacity/display、祖先折叠）→ hide 全部（保活）
 * - 已挂载且可见 → restore（workspace + 重采几何）
 *
 * ## 为何设置页也会被盖住？
 * `/settings` 是**完整 SPA 路由**（不是浮层）：切过去时会话树卸载，`[data-panes-host]`
 * 从 document 消失。正确反应是 **missing→hide**；会话未退出时不得销毁 iframe/webview。
 * 真正退出会话时，由会话业务显式调用 destroy。
 *
 * ## 收敛安装点
 * 用 `installDocumentPanesHostPresence()` 在应用根装**一次** document 级观察：
 * MutationObserver 看 host 增删，不依赖某个 React effect 是否绑上 ref。
 * 设置/登录等业务页 **零** pane 生命周期代码。
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
 * 侧栏/折叠等**显式** chrome 隐藏（不含面积）。
 * show 决策用此函数：jsdom 与布局首帧 rect=0 时不得误判为 hidden。
 */
export function isPanesHostChromeHidden(
  el: Element,
  options: { readonly target?: Window } = {},
): boolean {
  if (!el.isConnected) return true;
  const win = options.target ?? el.ownerDocument.defaultView ?? window;
  let node: Element | null = el;
  while (node !== null) {
    // Radix Dialog 仅给 portal 外的 app 根设置 aria-hidden；这不代表视觉隐藏。
    // 只认 host 自身，避免打开 modal 时把 Pane 误判为不可见。
    if (node === el && node.getAttribute("aria-hidden") === "true") return true;
    if (node.getAttribute("data-pi-panel-collapsed") === "true") return true;
    if (node.getAttribute("data-pi-panel-open") === "false") return true;
    const style = win.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return true;
    node = node.parentElement;
  }
  return false;
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
  if (isPanesHostChromeHidden(el, options)) return false;
  const minArea = options.minVisibleArea ?? 32 * 32;
  const win = options.target ?? el.ownerDocument.defaultView ?? window;

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
 * 监控单个 PanesHost 根节点。返回 dispose；dispose 时按 **missing** 隐藏 webview，保留实例。
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
      // 路由暂时卸载 host 只 hide，保留当前会话的 iframe/webview；destroy 由显式退出会话负责。
      void Promise.resolve(backend.hideAll()).catch(() => undefined);
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

  // 不听 pi-panes-content-well-sync：那是几何刷新通道，拖拽时每帧都会打，
  // 叠进 presence 评估会多余 rAF + 偶发 restore 风暴。
  target.addEventListener("resize", schedule);

  return () => {
    if (disposed) return;
    if (frame !== 0) target.cancelAnimationFrame(frame);
    ro?.disconnect();
    io?.disconnect();
    mo?.disconnect();
    target.removeEventListener("resize", schedule);
    // 元素卸载 = missing → 隐藏并保活（force，无视 disposed 短路）
    apply("missing", true);
    disposed = true;
  };
}

/**
 * 在 document 内查找 `[data-panes-host]` 并绑定监控（可选多实例，各自独立）。
 * 返回总 dispose。
 *
 * 路由切到无 host 的页（如 `/settings`）时，host 节点从树移除 → unbind → hide。
 */
export function observeAllPanesHostsInDocument(
  doc: Document = document,
  options: ObservePanesHostPresenceOptions = {},
): () => void {
  const target = options.target ?? doc.defaultView ?? window;
  const backend = options.backend ?? createDefaultPanesHostPresenceBackend(target);
  const merged = { ...options, backend };
  const disposers = new Map<Element, () => void>();
  const bind = (el: Element): void => {
    if (disposers.has(el)) return;
    disposers.set(el, observePanesHostPresence(el, merged));
  };
  const unbind = (el: Element): void => {
    const off = disposers.get(el);
    if (off === undefined) return;
    off();
    disposers.delete(el);
  };

  /** 扫离线 host + 无 host 时强制 hide（防 SPA 跳转漏扫，但保活当前会话）。 */
  const sweep = (): void => {
    for (const el of [...disposers.keys()]) {
      if (!el.isConnected) unbind(el);
    }
    doc.querySelectorAll(HOST_SELECTOR).forEach(bind);
    if (doc.querySelector(HOST_SELECTOR) === null) {
      void Promise.resolve(backend.hideAll()).catch(() => undefined);
    }
  };

  doc.querySelectorAll(HOST_SELECTOR).forEach(bind);
  // 冷进无 host：仅隐藏，避免尚未退出的会话失去可复用 webview。
  if (doc.querySelector(HOST_SELECTOR) === null) {
    void Promise.resolve(backend.hideAll()).catch(() => undefined);
  }

  const mo =
    typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver((records) => {
          for (const record of records) {
            record.removedNodes.forEach((node) => {
              if (!(node instanceof Element)) return;
              if (node.matches?.(HOST_SELECTOR)) unbind(node);
              node.querySelectorAll?.(HOST_SELECTOR).forEach(unbind);
            });
            record.addedNodes.forEach((node) => {
              if (!(node instanceof Element)) return;
              if (node.matches?.(HOST_SELECTOR)) bind(node);
              node.querySelectorAll?.(HOST_SELECTOR).forEach(bind);
            });
          }
          sweep();
        });
  mo?.observe(doc.documentElement, { childList: true, subtree: true });

  const onNav = (): void => {
    // SPA / 返回前进：MO 偶发漏扫时补一刀。
    queueMicrotask(sweep);
  };
  target.addEventListener("popstate", onNav);
  target.addEventListener("pageshow", onNav);

  return () => {
    mo?.disconnect();
    target.removeEventListener("popstate", onNav);
    target.removeEventListener("pageshow", onNav);
    for (const off of disposers.values()) off();
    disposers.clear();
  };
}

/** 应用根单例：document 级 presence。重复 install 会先卸旧再装新。 */
let documentPresenceOff: (() => void) | undefined;

/**
 * 在应用入口装一次（如 `Providers`）。此后任意路由挂/卸 `[data-panes-host]`
 * 都由本闸处理 hide/restore；destroy 仍由显式会话终止路径负责。
 *
 * 另导出 `notifyPanesHostPresenceSweep` 供路由变更后主动扫（无 host → hide）。
 */
export function installDocumentPanesHostPresence(
  doc: Document = document,
  options: ObservePanesHostPresenceOptions = {},
): () => void {
  documentPresenceOff?.();
  documentPresenceOff = observeAllPanesHostsInDocument(doc, options);
  return () => {
    if (documentPresenceOff !== undefined) {
      documentPresenceOff();
      documentPresenceOff = undefined;
    }
  };
}

/** 路由 pathname 变化后调用：无 `[data-panes-host]` 则 hide，保活当前会话。 */
export function notifyPanesHostPresenceSweep(
  doc: Document = document,
  target: Window = window,
): void {
  if (doc.querySelector(HOST_SELECTOR) !== null) return;
  const backend = createDefaultPanesHostPresenceBackend(target);
  void Promise.resolve(backend.hideAll()).catch(() => undefined);
}

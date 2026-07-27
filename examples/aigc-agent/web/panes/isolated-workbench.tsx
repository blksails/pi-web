/**
 * 隔离宿主入口 —— **一个 iframe 一个域**(搜图 / 素材 / 画布 各占一个一级 pane)。
 *
 * 为何要这一份:pi-clouds cloud 的隔离车道(`pane-loader`)要求 dist entry 是一个
 * **自挂载的 pane guest**(自己 `connectPaneGuest` 握手 + 自 mount);而 webext 入口
 * `.pi/web/web.config.tsx` 导出的是 `defineWebExtension({...})` **描述符对象**,供宿主消费,
 * 既不握手也不 mount —— 直接喂给 pane-loader 只会加载出一个对象、屏幕空白。
 *
 * 同源宿主(pi-web)与隔离宿主的形态**一致**:右栏 PanesHost 多个一级 tab、每域各占一个
 * iframe。差别只在文档来源 —— 同源用 `srcDoc` 内联(build.ts 打的自含 HTML),隔离用
 * pane-loader 的 URL 文档加载本产物。故本文件只按 `window.__PANE_ID__` 渲染**对应那一个**域,
 * 复用**同一批** guest 组件(零重写):`SearchApp` / `MaterialsApp` / `CanvasPane`。
 *
 * 三者原文件末尾的自 mount 受 `getElementById("root")` 守卫,而本入口挂在 `#pane-root`
 * (pane-loader 的容器),故 import 它们不会触发重复挂载。
 *
 * ★ 每个 iframe 一条 guest 通道,paneId 由 pane-loader 写进 `window.__PANE_ID__`
 * (它从自身 URL query 读,零服务端插值)。宿主按同一 paneId 下发该 pane 自己的 grants。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { PaneGuestProvider } from "@blksails/pi-web-panes-kit/react";
import { SearchApp } from "./search.js";
import { MaterialsApp } from "./materials.js";
import { CanvasPane } from "./canvas.js";

/**
 * 构建期注入的样式(`build.ts` 经 esbuild `define`)。
 * 同源形态下这些样式由 `build.ts` 写进 pane 的自含 HTML;隔离形态下 HTML 是**宿主的**
 * pane-loader(第一方,不含本源样式),故产物须自带并自注入。
 */
declare const __AIGC_PANE_CSS__: string;

function injectStyles(): void {
  if (document.getElementById("aigc-pane-styles") !== null) return;
  const el = document.createElement("style");
  el.id = "aigc-pane-styles";
  el.textContent = __AIGC_PANE_CSS__;
  document.head.appendChild(el);
}

/**
 * 一个 iframe 只渲染**一个**域 —— 渲染谁由 `window.__PANE_ID__` 决定(pane-loader 从自身 URL
 * query 读、写进全局)。故同一份产物在三个 iframe 里各渲一域,彼此是独立 realm、真隔离,
 * 与同源宿主的 `aigcPanesDefinition` 三 pane 一一对应。
 *
 * 曾经在此自绘过一排按钮把三域塞进同一个 iframe 内部切页 —— 那是错的:既非一级 tab,
 * 三域也共享同一 realm(一个域崩了拖垮另外两个),与 `web/panes/index.ts` 的授权面也对不上
 * (那里三个 pane 的 capabilities 各不相同)。
 */
const PANE_VIEWS: Readonly<Record<string, () => React.JSX.Element>> = {
  search: () => <SearchApp />,
  materials: () => <MaterialsApp />,
  canvas: () => <CanvasPane />,
};

function PaneView({ paneId }: { readonly paneId: string }): React.JSX.Element {
  const render = PANE_VIEWS[paneId];
  if (render === undefined) {
    return <main className="center muted">未知 pane:{paneId}</main>;
  }
  return render();
}

/**
 * 握手竞态兜底 —— **URL 文档形态专有**,同源 `srcDoc` 形态不会踩到。
 *
 * PanesHost 有两条握手触发路径:收到 guest 的 `pane:ready`,或 iframe 的 `load`。而 module
 * 脚本会**延迟** load 事件直到执行完毕,于是时序成了:
 *   ① module 执行 → `createRoot().render()`(React 只是调度,effect 尚未跑)
 *   ② module 执行完 → iframe `load` → host `connect()` 发出 `pane:connected`
 *   ③ React effect 才跑 → `PaneGuestProvider` 内部 `connectPaneGuest()` 注册监听 —— **晚了一步**
 *   ④ guest 发 `pane:ready`,但 host 见 `connections.current` 已有同 epoch 连接,**直接 return 不重发**
 *   ⑤ guest 15s 后 `Pane host handshake timed out`
 * srcDoc 形态里脚本是同步 inline、执行早于 load,故 ③ 恒早于 ②,从不暴露。
 *
 * 故在 render **之前**先挂一个捕获监听把早到的 `pane:connected` 收下,并**劫持
 * `window.addEventListener`**:Provider 的监听一注册就把缓存的**原始事件对象**直接喂给它。
 *
 * 为何非得直接喂、不能 `dispatchEvent` 重放:guest 按 `event.source === window.parent` 校验来源,
 * 而 `new MessageEvent(..., {source})` 无法伪造一个跨源 WindowProxy —— 重放出来的事件 source 不
 * 成立,必被 guest 丢弃(实测如此)。直接调用监听器则 `source`/`ports` 全是原始值,校验自然通过。
 *
 * 劫持 3s 后自动撤除;期间其它库注册的 message 监听也会收到这几条,它们按 type 判别后自会忽略。
 */
function bridgeEarlyHandshake(): void {
  const early: MessageEvent[] = [];
  const capture = (event: MessageEvent): void => {
    if ((event.data as { type?: string } | undefined)?.type === "pane:connected") early.push(event);
  };
  window.addEventListener("message", capture);

  const originalAdd = window.addEventListener.bind(window) as typeof window.addEventListener;
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    originalAdd(type as never, listener as never, options as never);
    if (type !== "message" || early.length === 0 || typeof listener !== "function") return;
    for (const event of early) queueMicrotask(() => (listener as (e: MessageEvent) => void)(event));
  }) as typeof window.addEventListener;

  setTimeout(() => {
    window.addEventListener = originalAdd;
    window.removeEventListener("message", capture);
  }, 3000);
}

const paneRoot = document.getElementById("pane-root");
if (paneRoot !== null) {
  injectStyles();
  // 缺省 `materials`:pane-loader 恒会带 paneId,此回退只为直开该文件调试时不至于空白。
  const paneId =
    (window as unknown as { __PANE_ID__?: string }).__PANE_ID__ ?? "materials";
  bridgeEarlyHandshake();
  createRoot(paneRoot).render(
    <PaneGuestProvider paneId={paneId} fallback={<main className="center muted">正在连接会话…</main>}>
      <PaneView paneId={paneId} />
    </PaneGuestProvider>,
  );
}

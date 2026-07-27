/**
 * 隔离宿主入口 —— 单 pane 内的 aigc 工作台(搜图 / 素材 / 画布 三域内部切页)。
 *
 * 为何要这一份:pi-clouds cloud 的隔离车道(`pane-loader`)要求 dist entry 是一个
 * **自挂载的 pane guest**(自己 `connectPaneGuest` 握手 + 自 mount);而 webext 入口
 * `.pi/web/web.config.tsx` 导出的是 `defineWebExtension({...})` **描述符对象**,供宿主消费,
 * 既不握手也不 mount —— 直接喂给 pane-loader 只会加载出一个对象、屏幕空白。
 *
 * 本仓形态(pi-web 同源宿主)是右栏 PanesHost 多 tab、三域各占一个 iframe;隔离宿主只给
 * **一个** pane,故此处把三域收进单 pane 的内部切页,复用**同一批** guest 组件(零重写):
 * `SearchApp` / `MaterialsApp` / `CanvasPane`。
 *
 * 三者原文件末尾的自 mount 受 `getElementById("root")` 守卫,而本入口挂在 `#pane-root`
 * (pane-loader 的容器),故 import 它们不会触发重复挂载。
 *
 * ★ 单 `PaneGuestProvider`:整个 pane 只有一条 guest 通道,paneId 由 pane-loader 写进
 * `window.__PANE_ID__`(它从自身 URL query 读,零服务端插值);缺省回退 `aigc-workbench`。
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

type TabId = "search" | "materials" | "canvas";

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: "materials", label: "素材" },
  { id: "search", label: "搜图" },
  { id: "canvas", label: "画布" },
];

function Workbench(): React.JSX.Element {
  const [tab, setTab] = React.useState<TabId>("materials");
  return (
    <div className="pane-layout">
      <div className="toolbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "button button-primary" : "button"}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* 三域皆挂载、非活跃者以 CSS 隐藏 —— 保活其内部状态(选中集/画布/检索结果),
          切页不重建;与本仓 PanesHost 多 tab 的保活语义对齐。 */}
      <div className="split" style={{ flex: 1, minHeight: 0 }}>
        {TABS.map((t) => (
          <div
            key={t.id}
            className="grow"
            style={{ display: tab === t.id ? "flex" : "none", minHeight: 0, flexDirection: "column" }}
          >
            {t.id === "materials" ? <MaterialsApp /> : t.id === "search" ? <SearchApp /> : <CanvasPane />}
          </div>
        ))}
      </div>
    </div>
  );
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
  const paneId =
    (window as unknown as { __PANE_ID__?: string }).__PANE_ID__ ?? "aigc-workbench";
  bridgeEarlyHandshake();
  createRoot(paneRoot).render(
    <PaneGuestProvider paneId={paneId} fallback={<main className="center muted">正在连接会话…</main>}>
      <Workbench />
    </PaneGuestProvider>,
  );
}

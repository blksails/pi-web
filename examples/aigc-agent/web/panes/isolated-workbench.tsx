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

const paneRoot = document.getElementById("pane-root");
if (paneRoot !== null) {
  injectStyles();
  const paneId =
    (window as unknown as { __PANE_ID__?: string }).__PANE_ID__ ?? "aigc-workbench";
  createRoot(paneRoot).render(
    <PaneGuestProvider paneId={paneId} fallback={<main className="center muted">正在连接会话…</main>}>
      <Workbench />
    </PaneGuestProvider>,
  );
}

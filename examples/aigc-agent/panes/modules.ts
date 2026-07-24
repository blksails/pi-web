/**
 * agents/aigc 的 pane 模块清单(Wave 5 · 6.1 搜索域首切片)。
 *
 * 每业务域 pane 一个 `PaneAgentModule`(元信息 + extensions + routes),`composePaneAgentModules`
 * 装配即校验 route 覆盖。web 侧 UI 现阶段仍是右栏工作区模块(components/workspace-modules.tsx
 * 的 `search`);隔离 pane 宿主(pi-web panes-kit ≥0.5)随 vendor 刷新后接管,agent 侧契约不变。
 */
import type { PaneAgentModule } from "@blksails/pi-web-tool-kit/runtime";
import { creativeSearchRoute } from "../routes/creative-search.js";
import { assetsListRoute } from "../routes/assets-list.js";
import { materialsSurfaceExtension } from "./materials-surface.js";

/** 搜索域 pane:检索走自带 creative-search route(HTTP→Agent Route,替代直连 /api/creative-search)。 */
export const searchPaneModule: PaneAgentModule = {
  pane: {
    id: "search",
    capabilities: { routes: [{ name: "creative-search" }] },
  },
  routes: [creativeSearchRoute],
};

/**
 * 素材域 pane:列表读走自带 assets-list route(G2①,写路径守 R-0a 留宿主);
 * 热态(选中/过滤)入 materials surface(G2②,单写者)。
 */
export const materialsPaneModule: PaneAgentModule = {
  pane: {
    id: "materials",
    capabilities: { routes: [{ name: "assets-list" }] },
  },
  extensions: [materialsSurfaceExtension],
  routes: [assetsListRoute],
};

export const paneModules: readonly PaneAgentModule[] = [
  searchPaneModule,
  materialsPaneModule,
];

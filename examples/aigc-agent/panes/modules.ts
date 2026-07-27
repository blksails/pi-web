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
import { materialStatusRoute } from "../routes/material-status.js";
import { sessionGalleryRoute } from "../routes/session-gallery.js";
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
 * 素材域 pane:三条**只读**数据面 route(写路径守 R-0a 留宿主/控制面)——
 *  - assets-list      已落库素材(G2①);
 *  - material-status  分发状态台账(发起/重试等写动作不授权);
 *  - session-gallery  本会话画廊(复刻源项目的双数据源;经 route 读快照,不给素材域授画布 surface)。
 * 热态(选中/过滤/目录)入 materials surface(G2②,单写者)。
 */
export const materialsPaneModule: PaneAgentModule = {
  pane: {
    id: "materials",
    capabilities: {
      routes: [{ name: "assets-list" }, { name: "material-status" }, { name: "session-gallery" }],
    },
  },
  extensions: [materialsSurfaceExtension],
  routes: [assetsListRoute, materialStatusRoute, sessionGalleryRoute],
};

export const paneModules: readonly PaneAgentModule[] = [
  searchPaneModule,
  materialsPaneModule,
];

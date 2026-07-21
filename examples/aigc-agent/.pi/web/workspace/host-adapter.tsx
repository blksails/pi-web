// [迁移生成] pi-web 宿主适配层。由 scripts/sync-from-aigc-agent.mjs 生成,勿手改。
//
// 源壳层在 app 根提供的环境,pi-web 宿主里由本层自包:
//  1. QueryProvider —— MaterialDrawer 等依赖 react-query,宿主无全局 QueryClient;
//  2. .aigc-embed —— 调色板 token 作用域(见 aigc-shell.css 变换 D;display:contents 不破坏布局);
//  3. dialogLayer 组合 —— SkillPanel(技能管理 modal)+ SearchCommandPalette(搜图浮层);
//  4. sidebarLeft —— WorkspaceRailSection(「＋ 添加模块」/ 搜索入口)。
import * as React from "react";
import "../aigc-shell.css";
import { QueryProvider } from "./query-provider.js";
import { WorkspacePanel } from "./workspace-panel.js";
import { SkillPanel } from "../skill-panel.js";
import {
  SearchCommandPalette,
  WorkspaceRailSection,
} from "./workspace-launcher.js";

export function AigcWorkspacePanel(
  props: React.ComponentProps<typeof WorkspacePanel>,
): React.JSX.Element {
  return (
    <div className="aigc-embed" style={{ display: "contents" }}>
      <QueryProvider>
        <WorkspacePanel {...props} />
      </QueryProvider>
    </div>
  );
}

export function AigcDialogLayer(
  props: React.ComponentProps<typeof SkillPanel>,
): React.JSX.Element {
  return (
    <div className="aigc-embed" style={{ display: "contents" }}>
      <SkillPanel {...props} />
      <SearchCommandPalette />
    </div>
  );
}

export function AigcWorkspaceRail(): React.JSX.Element {
  return (
    <div className="aigc-embed aigc-embed-rail">
      <QueryProvider>
        <WorkspaceRailSection />
      </QueryProvider>
    </div>
  );
}

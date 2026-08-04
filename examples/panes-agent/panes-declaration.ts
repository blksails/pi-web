/**
 * pane 声明模块(spec cli-agent-build 任务 5.1)——由 `pi-web build` 的 pane-discovery 经
 * `--panes panes-declaration.ts` 显式求值(server/cli/build/pane-discovery.ts)。
 *
 * 命名刻意避开既有 `panes-modules.ts`:该文件名已被本 source 的 agent 侧
 * `PaneAgentModule[]` 声明占用(pane ↔ 自带 tools/routes 的绑定,见其头注),结构与本文件
 * 完全不同,不可合并、也不可重名互相覆盖。
 *
 * 复用 `pane-meta.ts`(web 侧/agent 侧共享的 pane 元信息单一事实源)补上构建期独占字段
 * `entry`/`canvasStyles`,不重复声明 title/icon/capabilities(Req 3.2:同一份声明同时被
 * 构建期与运行期消费,不产生第二份声明源)。
 */
import {
  artifactPaneMeta,
  canvasPaneMeta,
  diffPaneMeta,
  editorPaneMeta,
  filesPaneMeta,
  type PaneMeta,
} from "./pane-meta.js";

function paneOf(meta: PaneMeta, entryFile: string, canvasStyles?: true) {
  return {
    id: meta.id,
    title: meta.title,
    icon: meta.icon,
    entry: new URL(`./web/panes/${entryFile}.tsx`, import.meta.url),
    ...(canvasStyles === true ? { canvasStyles: true as const } : {}),
    capabilities: meta.capabilities,
  };
}

export default {
  id: "panes-example",
  modules: [
    paneOf(filesPaneMeta, "files"),
    paneOf(editorPaneMeta, "editor"),
    paneOf(diffPaneMeta, "diff"),
    paneOf(canvasPaneMeta, "canvas", true),
    paneOf(artifactPaneMeta, "artifact"),
  ],
  panelConfig: { initialPaneIds: ["editor", "files", "canvas"], maxOpenPanes: 12 },
};

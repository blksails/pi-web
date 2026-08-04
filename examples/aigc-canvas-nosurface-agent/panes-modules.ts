/**
 * pane 声明模块(spec cli-agent-build 任务 5.1)——由 `pi-web build` 的 pane-discovery 经
 * `--panes panes-modules.ts` 显式求值(server/cli/build/pane-discovery.ts)。
 *
 * 与 aigc-canvas-agent 用**同一份 pane 元信息与同一个 guest 入口**,差异只在 agent 侧
 * (见 web/web.config.tsx 头注)。entry 用 URL 形态跨目录指向兄弟 example 的入口文件——
 * pane-discovery 的 entry 归一规则要求非本 source 内的相对写法以显式 `file:` URL 表达
 * (design.md「pane-discovery / entry 归一」)。
 */
import { canvasPaneMeta } from "../aigc-canvas-agent/pane-meta.js";

export default {
  id: "aigc-canvas-nosurface",
  modules: [
    {
      id: canvasPaneMeta.id,
      title: canvasPaneMeta.title,
      icon: canvasPaneMeta.icon,
      entry: new URL("../aigc-canvas-agent/web/panes/main.tsx", import.meta.url),
      canvasStyles: true,
      capabilities: canvasPaneMeta.capabilities,
    },
  ],
  panelConfig: { initialPaneIds: ["canvas"], maxOpenPanes: 4 },
};

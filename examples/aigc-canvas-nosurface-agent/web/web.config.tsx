/**
 * aigc-canvas-nosurface-agent UI 扩展 —— **pane 形态**(spec panes-only-right-panel 任务 4.2)。
 *
 * 与 `aigc-canvas-agent` 用**同一个 guest 入口与同一份 pane 元信息**,差异只在 agent 侧
 * (index.ts 不装 canvas surface 扩展)⇒ 面板挂载后因 `surface.hasCommand("surface:canvas")`
 * 为假而退化为只读图库。这正是本示例要守的降级行为,迁 pane 后一字未变。
 *
 * ★ `launcherRail` 随迁移撤掉:它靠 module 级 store 与面板联动,而 store 不跨 realm ——
 * 留着会变成点了没反应的死按钮。pane 的开合入口由面板宿主的 tab 栏承担。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { panesDefinition } from "./panes/index.js";

export default defineWebExtension({
  manifestId: "aigc-canvas-nosurface",
  capabilities: ["config"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  panes: panesDefinition,
});

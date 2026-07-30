/**
 * canvas-plugin-stickers UI 扩展 —— **pane 形态 + 构建期插件组合**
 * (spec panes-only-right-panel 任务 4.3)。
 *
 * ★ 勘察结论成立:插件**不需要跨 realm 传组件**。pane 文档是构建期打出的自足 bundle,
 * React 与画布组件就跑在里面 ⇒ 插件只是和它们一起打包的普通模块,在 pane 内用既有聚合
 * 逻辑接入。原估的「需新建 guest 侧插件车道、体量近一个独立 spec」不成立 ——
 * 那条「运行时车道无法承载组件」的既有约束针对的是**运行时解析车道**,与构建期打包无关。
 *
 * `launcherRail` 随迁移撤掉:它靠 module 级 store 与面板联动,而 store 不跨 realm,
 * 留着就是死按钮;pane 由 initialPaneIds 开箱即在。
 */
import { defineWebExtension } from "@blksails/pi-web-kit";
import { panesDefinition } from "./panes/index.js";

export default defineWebExtension({
  manifestId: "canvas-plugin-stickers",
  capabilities: ["config"],
  config: { panelRatio: "4:6", logsPanelPosition: "bottom" },
  panes: panesDefinition,
});

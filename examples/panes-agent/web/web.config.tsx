import { defineWebExtension } from "@blksails/pi-web-kit";
import { panesDefinition } from "./panes/index.js";

export const config = {
  panes: {
    // standard:固定 tabs + 基础控件；advanced:可拖拽 tabs、IDE 分栏、菜单和快捷键。
    interactionMode: "advanced" as const,
    allowTabReorder: true,
    showCommandPalette: true,
  },
  web: {
    documentTitle: "Panes 示例 · pi-web",
    panelWidth: 760,
    minPanelWidth: 420,
    maxPanelWidth: 1280,
    logsPanelPosition: "bottom" as const,
    empty: {
      title: "隔离 Pane 范例",
      subtitle: "每个标签页都是独立 iframe；数据经 Agent Routes、Surface 与附件系统收敛。",
      starters: [
        {
          id: "inspect-panes",
          label: "检查当前 Pane 状态",
          value: "请检查当前 panes 的文件、画布和 artifact 状态。",
          mode: "send" as const,
        },
      ],
      mergeCommands: "prepend" as const,
    },
  },
};

export default defineWebExtension({
  manifestId: "panes",
  capabilities: ["config"],
  config: config.web,
  /**
   * 用**可枚举的 pane 声明键**(spec host-builtin-panes 任务 5.1),不再自渲染 panelRight 槽。
   *
   * 迁移前:本示例在 `slots.panelRight` 里自己实例化 `PanesHost`。那样宿主无从枚举这些 pane
   * 定义,也就无法把它们与宿主内置 pane 合并 —— 且按 design D3,声明了旧槽的 agent 会让内置
   * panes 整体让位。
   *
   * 迁移后:宿主负责实例化 `PanesHost`,definition = 宿主内置 ⊕ 本键(内置在前)。本示例因此
   * 成为「合并路径真的通」的活体证据。
   *
   * ⚠ `examples/aigc-canvas-agent` **刻意保留旧槽形态**,作为「既有形态不回退」的回归守卫 ——
   * 两个都迁的话,旧槽路径就再没有活的测试守着了。
   */
  panes: {
    ...panesDefinition,
    // 交互配置随声明键一起交给宿主透传;迁移前它是 PanesHost 的直接 prop,
    // 若不带上会静默丢失 advanced 交互模式、tab 重排与命令面板。
    config: config.panes,
  },
});

import * as React from "react";
import { defineWebExtension, type SlotRenderProps } from "@blksails/pi-web-kit";
import { PanesHost } from "./panes-host.js";

export const config = {
  panes: {
    // standard:固定 tabs + 基础控件；advanced:可拖拽 tabs、IDE 分栏、菜单和快捷键。
    interactionMode: "advanced" as const,
    allowTabReorder: true,
    showCommandPalette: true,
  },
  web: {
    documentTitle: "Panes 示例 · pi-web",
    panelRatio: "4:6" as const,
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

function ConfiguredPanesHost(props: SlotRenderProps): React.JSX.Element {
  return <PanesHost {...props} config={config.panes} />;
}

export default defineWebExtension({
  manifestId: "panes",
  capabilities: ["slots", "config"],
  config: config.web,
  // pi-web 只负责 placement 和能力注入；PanesHost 不依赖 panelRight 的布局实现。
  slots: { panelRight: ConfiguredPanesHost },
});

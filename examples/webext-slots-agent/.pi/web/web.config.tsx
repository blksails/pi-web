/** webext-slots-agent UI 扩展:Tier1 协议保留插槽全集(R6)。每槽一个带 data-testid 的可见 fixture。 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

function Slot({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <div
      data-testid={`slot-${id}`}
      style={{
        padding: "2px 6px",
        fontSize: 12,
        border: "1px dashed hsl(var(--border))",
        borderRadius: 4,
        background: "hsl(var(--muted))",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-slots",
  capabilities: ["slots", "config"],
  // Tier5 声明式空态配置(config.empty):驱动 EmptyState 标题/副标题/建议项,
  // 并以 mergeCommands="prepend" 让配置建议项排在 agent slash 命令之前。
  // 与下面的 Tier1 `empty` 槽(additive 的 "Ext Empty State" fixture)并存、不冲突。
  config: {
    empty: {
      title: "Slots Agent · 自定义空态",
      subtitle: "标题/副标题/下面这两个建议项均来自声明式 config.empty。",
      starters: [
        {
          id: "slots-explain",
          label: "解释这个项目的结构",
          value: "请解释这个项目的结构",
          mode: "fill",
        },
        {
          id: "slots-test",
          label: "生成单元测试",
          value: "为当前模块生成单元测试",
          mode: "send",
        },
      ],
      mergeCommands: "prepend",
    },
  },
  slots: {
    sidebarLeft: <Slot id="sidebar-left" label="Sidebar L" />,
    toolbar: <Slot id="toolbar" label="Toolbar" />,
    accessoryAboveEditor: <Slot id="accessory-above" label="Above Editor" />,
    accessoryBelowEditor: <Slot id="accessory-below" label="Below Editor" />,
    accessoryInlineLeft: <Slot id="accessory-inline-left" label="◀" />,
    accessoryInlineRight: <Slot id="accessory-inline-right" label="▶" />,
    empty: <Slot id="empty" label="Ext Empty State" />,
    notifications: <Slot id="notifications" label="Ext Notification" />,
    statusBar: <Slot id="status-bar" label="Ext Status" />,
    artifactSurface: <Slot id="artifact-surface" label="Artifact Surface" />,
    promptInput: <Slot id="prompt-input" label="Prompt Deco" />,
    dialogLayer: <Slot id="dialog-layer" label="Dialog Layer" />,
  },
});

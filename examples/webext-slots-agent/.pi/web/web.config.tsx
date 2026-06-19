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
  capabilities: ["slots"],
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

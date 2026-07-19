/**
 * webext-slots-runtime-agent UI 扩展:Tier1 协议保留插槽全集(R6),经运行时代码扩展车道加载。
 *
 * 与 `webext-slots-agent` 同构(同一份 18 槽 fixture,复用同一批 data-testid),差异只是
 * manifestId 与 documentTitle(便于 e2e 断言区分两条车道各自命中),以及本文件**不在**
 * `lib/app/webext-registry.ts` 的构建期静态 import 名单里 —— 只能经
 * `/api/webext/resolve` → 动态 `import()` → SlotHost 的运行时车道生效(任务 6.4)。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

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
  manifestId: "webext-slots-runtime",
  capabilities: ["slots", "config"],
  config: {
    documentTitle: "Slots Runtime Agent · pi-web",
    empty: {
      title: "Slots Runtime Agent · 自定义空态",
      subtitle: "本扩展经运行时代码车道加载(/api/webext/resolve → 动态 import)。",
      starters: [
        {
          id: "slots-runtime-explain",
          label: "解释这个项目的结构",
          value: "请解释这个项目的结构",
          mode: "fill",
        },
        {
          id: "slots-runtime-test",
          label: "生成单元测试",
          value: "为当前模块生成单元测试",
          mode: "send",
        },
      ],
      mergeCommands: "prepend",
    },
  },
  // Tier1 协议保留插槽「全集」(18 槽,对齐 protocol SlotKeySchema)。每槽一个带
  // data-testid 的可见 fixture,逐项验收宿主让位点是否全部接通。
  slots: {
    background: <Slot id="background" label="Ext Background" />,
    headerLeft: <Slot id="header-left" label="Header L" />,
    headerCenter: <Slot id="header-center" label="Header C" />,
    headerRight: <Slot id="header-right" label="Header R" />,
    sidebarLeft: <Slot id="sidebar-left" label="Sidebar L" />,
    panelRight: <Slot id="panel-right" label="Panel Right" />,
    toolbar: <Slot id="toolbar" label="Toolbar" />,
    accessoryAboveEditor: <Slot id="accessory-above" label="Above Editor" />,
    accessoryBelowEditor: <Slot id="accessory-below" label="Below Editor" />,
    accessoryInlineLeft: <Slot id="accessory-inline-left" label="◀" />,
    accessoryInlineRight: <Slot id="accessory-inline-right" label="▶" />,
    empty: <Slot id="empty" label="Ext Empty State" />,
    footer: <Slot id="footer" label="Ext Footer" />,
    notifications: <Slot id="notifications" label="Ext Notification" />,
    statusBar: <Slot id="status-bar" label="Ext Status" />,
    artifactSurface: <Slot id="artifact-surface" label="Artifact Surface" />,
    promptInput: <Slot id="prompt-input" label="Prompt Deco" />,
    dialogLayer: <Slot id="dialog-layer" label="Dialog Layer" />,
  },
});

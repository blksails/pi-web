/**
 * web-kit — Tier 1 区域插槽 key 常量(与 @pi-web/protocol 的 SlotKey 对齐)。
 *
 * 作者用这些常量声明 `slots`,获得类型与命名一致性。
 */
import type { SlotKey } from "@pi-web/protocol";

export const SLOTS = {
  background: "background",
  headerLeft: "headerLeft",
  headerCenter: "headerCenter",
  headerRight: "headerRight",
  sidebarLeft: "sidebarLeft",
  panelRight: "panelRight",
  empty: "empty",
  footer: "footer",
  promptInput: "promptInput",
  accessoryAboveEditor: "accessoryAboveEditor",
  accessoryBelowEditor: "accessoryBelowEditor",
  accessoryInlineLeft: "accessoryInlineLeft",
  accessoryInlineRight: "accessoryInlineRight",
  toolbar: "toolbar",
  notifications: "notifications",
  statusBar: "statusBar",
  artifactSurface: "artifactSurface",
  dialogLayer: "dialogLayer",
  logs: "logs",
} as const satisfies Record<string, SlotKey>;

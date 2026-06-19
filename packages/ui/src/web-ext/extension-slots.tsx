/**
 * extension-slots — Tier1 协议保留插槽的统一挂载层(spec: agent-web-extension-visual-acceptance R6)。
 *
 * 设计原则「共存追加」:扩展插槽内容一律追加并赋独立 `[data-pi-ext-<slot>]`,绝不替换内核表面。
 * `ExtSlotRegion` 仅在扩展声明该插槽时渲染容器(否则返回 null,零副作用),由 `pi-chat.tsx` 在
 * 设计定义的位置挂载,使 pi-chat 只做编排、不持插槽细节。
 */
import * as React from "react";
import type { SlotKey } from "@pi-web/protocol";
import type { WebExtension } from "@pi-web/web-kit";
import { SlotHost, resolveSlot } from "./apply-extension.js";

/** 12 个协议保留插槽 → 浏览器可见 data 属性(与 design 插槽表一一对应)。 */
const RESERVED_SLOT_DATA_ATTR: Partial<Record<SlotKey, string>> = {
  sidebarLeft: "data-pi-ext-sidebar-left",
  toolbar: "data-pi-ext-toolbar",
  accessoryAboveEditor: "data-pi-ext-accessory-above",
  accessoryBelowEditor: "data-pi-ext-accessory-below",
  accessoryInlineLeft: "data-pi-ext-accessory-inline-left",
  accessoryInlineRight: "data-pi-ext-accessory-inline-right",
  empty: "data-pi-ext-empty",
  notifications: "data-pi-ext-notifications",
  statusBar: "data-pi-ext-status-bar",
  artifactSurface: "data-pi-ext-artifact-surface",
  promptInput: "data-pi-ext-prompt-input",
  dialogLayer: "data-pi-ext-dialog-layer",
};

export interface ExtSlotRegionProps {
  readonly ext: WebExtension | undefined;
  readonly slot: SlotKey;
  /** 容器标签,默认 div。 */
  readonly as?: keyof React.JSX.IntrinsicElements;
  readonly className?: string;
}

/**
 * 渲染一个协议保留插槽区域:仅当扩展声明该插槽时输出 `<as data-pi-ext-<slot>>` 容器并挂 SlotHost;
 * 未声明则返回 null(追加语义,不占位、不替换内核)。
 */
export function ExtSlotRegion({
  ext,
  slot,
  as = "div",
  className,
}: ExtSlotRegionProps): React.ReactNode {
  if (resolveSlot(ext, slot) === undefined) return null;
  const dataAttr = RESERVED_SLOT_DATA_ATTR[slot] ?? `data-pi-ext-${slot}`;
  const Tag = as as React.ElementType;
  return (
    <Tag {...{ [dataAttr]: "" }} className={className}>
      <SlotHost ext={ext} slot={slot} />
    </Tag>
  );
}

/** 某扩展声明的协议保留插槽集合(用于条件渲染包裹容器)。 */
export function useReservedSlots(
  ext: WebExtension | undefined,
): Partial<Record<SlotKey, boolean>> {
  return React.useMemo(() => {
    const present: Partial<Record<SlotKey, boolean>> = {};
    for (const slot of Object.keys(RESERVED_SLOT_DATA_ATTR) as SlotKey[]) {
      if (resolveSlot(ext, slot) !== undefined) present[slot] = true;
    }
    return present;
  }, [ext]);
}

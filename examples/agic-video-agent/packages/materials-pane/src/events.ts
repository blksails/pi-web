/** 素材 Pane 只发布通用 Canvas 引用；未订阅时 Guest 自动降级到对话。 */
export const CANVAS_OPEN_ATTACHMENTS_EVENT = "pi.canvas.open-attachments";
export const SESSION_LOCATE_EVENT = "pi.session.locate";
/** @deprecated 使用 CANVAS_OPEN_ATTACHMENTS_EVENT。 */
export const MATERIALS_OPEN_EVENT = CANVAS_OPEN_ATTACHMENTS_EVENT;

export interface MaterialsOpenEvent {
  readonly attachmentIds: readonly string[];
}

export function parseMaterialsOpenEvent(value: unknown): MaterialsOpenEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ids = (value as { attachmentIds?: unknown }).attachmentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64) return undefined;
  if (!ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)) return undefined;
  return { attachmentIds: ids };
}

/** 跨 Pane 请求 Canvas 打开并登记附件；发布方无需依赖 Canvas 实现。 */
export const CANVAS_OPEN_ATTACHMENTS_EVENT = "pi.canvas.open-attachments";

export interface CanvasOpenAttachmentsEvent {
  readonly attachmentIds: readonly string[];
}

export function parseCanvasOpenAttachmentsEvent(
  value: unknown,
): CanvasOpenAttachmentsEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ids = (value as { attachmentIds?: unknown }).attachmentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64) return undefined;
  if (!ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)) {
    return undefined;
  }
  return { attachmentIds: ids };
}

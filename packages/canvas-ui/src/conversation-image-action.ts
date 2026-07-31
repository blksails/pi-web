import type { ConversationImageAction } from "@blksails/pi-web-kit";
import { CANVAS_OPEN_ATTACHMENTS_EVENT } from "./pane-contract.js";

/** Canvas Pane 对对话成品图贡献的公共动作；无附件引用时安全隐藏。 */
export const canvasConversationImageAction: ConversationImageAction = {
  id: "canvas:open",
  label: "在画布中打开",
  icon: "palette",
  order: 10,
  when: ({ asset }) => asset.attachmentId !== undefined,
  run: ({ asset, publishPaneEvent }) => {
    if (asset.attachmentId === undefined) return;
    publishPaneEvent(CANVAS_OPEN_ATTACHMENTS_EVENT, {
      attachmentIds: [asset.attachmentId],
    });
  },
};

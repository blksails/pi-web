/**
 * attachment-tool-agent — attachment-tool-bridge 的**端到端示例 agent**(task 4.2)。
 *
 * 装配示例图像工具 `edit_image`(见 ./tools/edit-image-tool.ts)为 customTool,演示完整接入范式:
 *  - 用户上传图 → 主进程注入文本引用 `[attachment id=att_… type=… name=…]`(task 3.4/5.2);
 *  - 模型把 `att_id` 抄进 `edit_image({ attachmentId })`;
 *  - 工具在 runner 子进程内经注入的 AttachmentToolContext `resolve`(本地路径 / 网络 URL / 原始字节
 *    三形态)→ 处理 → `putOutput` 先落库(`tool-output`,同一 id 空间)→ 回引用(回图为已 await
 *    的裸 base64 string);
 *  - `afterToolCall` 闸门把内联 base64 剥成文本引用(task 3.2);前端经 `/raw` 分发 URL 展示。
 *
 * 上下文注入由 runner 装配(task 5.1)完成;本文件仅声明 agent 与 customTools。
 *
 * NOTE: `model` 故意省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel,
 * 开箱即用于任意 pi 登录(与 hello-agent 同姿态)。
 */
import { defineAgent } from "@pi-web/agent-kit";
import { editImageTool } from "./tools/edit-image-tool.js";

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
  systemPrompt: [
    "You are attachment-tool-agent, a pi-web example demonstrating the attachment tool bridge.",
    "When the user references an uploaded image via an [attachment id=att_… …] marker,",
    "copy that public id verbatim into the `edit_image` tool's `attachmentId` parameter to edit it.",
    "The tool resolves the input attachment, transforms it, persists the result, and returns a reference.",
    "Report the produced attachment id back to the user. Keep replies concise.",
  ].join("\n"),
  customTools: [editImageTool],
  // Self-contained: drop built-in tools so only `edit_image` (+ extension tools) are exposed.
  noTools: "builtin",
  // Drop disk-discovered system skills to keep the example hermetic.
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});

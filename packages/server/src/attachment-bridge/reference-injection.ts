/**
 * attachment-tool-bridge · prompt 文本引用注入(task 3.4;Req 8.1, 8.2, 8.3, 8.4, 9.1)。
 *
 * 把用户**附带的已落库附件**以稳定、结构化的**文本标记**注入用户消息文本,使模型据此
 * 知道有哪些附件、并能把对应公开 id 抄进工具参数去调用 tool。**仅注入文本,绝不内联附件
 * 字节**:本注入路径不是 base64 进入 transcript 的额外出口(守「base64 仅具名出口」不变式,9.1)。
 *
 * 设计约束(design.md §reference-injection):
 * - 标记形态:每个附件一行 `[attachment id=att_… type=<mime> name=<name>]`(8.1/8.2),
 *   与 base64-gate 剥离时产出的文本引用同形(`packages/server/src/attachment-bridge/base64-gate.ts`),
 *   保证「上传附件」与「被剥离的 tool result 图像」在 transcript 里的引用标记一致、可被模型据以抄 id。
 * - `buildAttachmentRefs([])` → `""`:无附件不注入(8.3)。
 * - 仅文本:输出不含 `base64` / `data:`,不内联字节(8.4/9.1)。
 *
 * 纯字符串构造:不落库、不查 store。接线(task 5.2)在 `command-routes.ts` 的
 * `makeMessagesHandler` 内、`session.prompt(message, options)` 之前调用 `injectAttachmentRefs`
 * 把标记块拼到用户消息文本(与既有 `images`/vision base64 并存,不替代、不内联字节)。
 */
import type { Attachment } from "@blksails/protocol";

/**
 * 把一组已落库附件构造成稳定的结构化文本标记块:每个附件一行
 * `[attachment id=att_… type=<mime> name=<name>]`,顺序与入参一致(8.1/8.2)。
 *
 * @param attachments 已落库附件描述符(不含字节);只读取 `id`/`mimeType`/`name`。
 * @returns 多行标记字符串(行间以 `\n` 分隔);**空数组 → 空串**(不注入,8.3)。
 *          仅文本,绝不内联 base64/`data:`(8.4/9.1)。
 */
export function buildAttachmentRefs(
  attachments: readonly Attachment[],
): string {
  if (attachments.length === 0) return "";
  return attachments
    .map(
      (a) =>
        `[attachment id=${a.id} type=${a.mimeType} name=${a.name}]`,
    )
    .join("\n");
}

/**
 * 把附件文本引用标记块注入用户消息文本:标记块在前、原文本在后,以空行分隔。
 *
 * - 有附件:返回 `<标记块>\n\n<原文本>`(8.1),仅拼文本,不内联字节(8.4/9.1)。
 * - 无附件:原样返回 `messageText`,不注入任何标记(8.3)。
 *
 * @param messageText 原始用户消息文本。
 * @param attachments 该消息附带的已落库附件;空数组表示无附件。
 * @returns 注入引用标记后的消息文本(无附件时与入参文本相同)。
 */
export function injectAttachmentRefs(
  messageText: string,
  attachments: readonly Attachment[],
): string {
  const refs = buildAttachmentRefs(attachments);
  if (refs === "") return messageText;
  return `${refs}\n\n${messageText}`;
}

/**
 * pi-web 协议层 — 附件(attachment-store)DTO schema。
 *
 *   POST /sessions/:id/attachments   (multipart) → UploadAttachmentResponse
 *   GET  /attachments/:id/raw?exp&sig             → 原始字节(非本协议形状)
 *
 * 定义不含字节、可在系统内到处流通的 `Attachment` 描述符及其上传响应形状。
 * 与既有 `transport/rest-dto.ts` 同风格(zod schema + `z.infer` 类型 + barrel 导出)。
 *
 * `origin` 含 `tool-output` 取值,为下游 `attachment-tool-bridge` 切片预留;
 * 本切片前端上传路径仅产 `"upload"`,store 不对 `origin` 取值设限(由调用方传入)。
 */
import { z } from "zod";

/** 附件来源:`upload`(前端上传)或 `tool-output`(下游 tool 产物,预留)。 */
export const AttachmentOriginSchema = z.enum(["upload", "tool-output"]);
export type AttachmentOrigin = z.infer<typeof AttachmentOriginSchema>;

/**
 * Attachment 描述符(不含字节),仅承载引用所需的元数据:
 * 公开 id(`att_<nanoid>`)、文件名、mimeType、字节大小、来源、所属会话 id、创建时间。
 * `size` 强制为非负整数;`createdAt` 强制为 ISO 8601 字符串。
 */
export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  origin: AttachmentOriginSchema,
  sessionId: z.string(),
  createdAt: z.string().datetime(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * 上传成功响应:落库后的描述符 + 即时签名分发 URL(`/attachments/:id/raw?exp&sig`)。
 */
export const UploadAttachmentResponseSchema = z.object({
  attachment: AttachmentSchema,
  displayUrl: z.string(),
});
export type UploadAttachmentResponse = z.infer<
  typeof UploadAttachmentResponseSchema
>;

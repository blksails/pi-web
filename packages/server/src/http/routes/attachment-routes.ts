/**
 * http-api — 附件上传端点 handler(attachment-store task 3.1;Req 3.1/3.2/3.3/3.4)。
 *
 *   POST /sessions/:id/attachments   (multipart/form-data, 字段 `file`) → UploadAttachmentResponse
 *
 * 经 http-api 注入接缝(`createPiWebHandler({ routes })`)挂载。会话解析与鉴权门控
 * **复用** Router 的 `:id` 既有机制(会话不存在→404、越权→403、未鉴权→401),本 handler
 * 不另造会话解析/鉴权 —— 命中此 handler 时会话已存在且已授权,`ctx.sessionId` 即属主。
 *
 * 设计约束(design.md §attachment-routes 上传;Error Categories):
 * - 取 `formData()` 的 `file` 部分;无有效文件 → 400 `NO_FILE`(不静默落库空对象,Req 3.4)。
 * - `store.put` 记 `origin:"upload"` + `sessionId`(会话属主,Req 3.1);响应 `{ attachment, displayUrl }`
 *   (displayUrl = 即时签名分发 URL,Req 3.2)。
 * - 设上传大小上限并对超限以客户端错误(413)拒绝,不全量入内存:
 *   先按 `Content-Length` 头提前拒绝(不读 body);缺失/不可信时再按解析出的文件大小拒绝(Req 3.x/不全量入内存)。
 *
 * `createAttachmentRoutes` 工厂(上传 + 分发完整导出)留给 task 3.3;本文件聚焦上传 handler。
 */
import type { AttachmentStore } from "../../attachment/index.js";
import { errorResponse, jsonResponse } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";

/** 默认上传大小上限(字节)。可经 handler 选项覆盖。 */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB

/** multipart 文件字段名(与前端 `uploadAttachment` 约定一致)。 */
const FILE_FIELD = "file";

/** 上传 handler 选项(大小上限等)。 */
export interface UploadHandlerOptions {
  /** 上传字节上限;超限以 413 拒绝。默认 {@link DEFAULT_MAX_UPLOAD_BYTES}。 */
  readonly maxBytes?: number;
}

function tooLarge(maxBytes: number): Response {
  return errorResponse(
    413,
    "PAYLOAD_TOO_LARGE",
    `Upload exceeds the maximum allowed size of ${maxBytes} bytes.`,
  );
}

/**
 * 构造上传端点 handler `POST /sessions/:id/attachments`。
 *
 * 复用 Router `:id` 会话解析 + 鉴权门控(命中即已存在且授权)。解析 multipart 取 `file`,
 * 记 `origin:"upload"` + 会话属主落库,响应 `{ attachment, displayUrl }`;无文件→400;超限→413。
 */
export function makeUploadAttachmentHandler(
  store: AttachmentStore,
  options: UploadHandlerOptions = {},
): RouteHandler {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  return async (ctx: RequestContext): Promise<Response> => {
    // 会话属主:命中此 handler 时 Router 已校验会话存在 + 授权,`ctx.sessionId` 必有。
    const sessionId = ctx.sessionId ?? "";

    // 1) 早拒:按 Content-Length 头在读 body 前拒绝超限(避免全量入内存,Req 不全量入内存)。
    const contentLength = ctx.req.headers.get("content-length");
    if (contentLength !== null) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > maxBytes) {
        return tooLarge(maxBytes);
      }
    }

    // 2) 解析 multipart。非 multipart / 解析失败 → 400(无有效文件部分)。
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      return errorResponse(
        400,
        "NO_FILE",
        "Request must be multipart/form-data with a file part.",
      );
    }

    const part = form.get(FILE_FIELD);
    // 仅接受文件部分(Blob/File);文本字段或缺失 → 400,不静默落库空对象(Req 3.4)。
    if (!(part instanceof Blob)) {
      return errorResponse(
        400,
        "NO_FILE",
        `Missing "${FILE_FIELD}" file part in multipart request.`,
      );
    }

    // 3) 文件大小复核(Content-Length 缺失/不可信时的兜底,Req 不全量入内存上限)。
    if (part.size > maxBytes) {
      return tooLarge(maxBytes);
    }
    if (part.size === 0) {
      return errorResponse(400, "NO_FILE", "Uploaded file part is empty.");
    }

    const name =
      part instanceof File && part.name.length > 0 ? part.name : "upload";
    const mimeType =
      part.type.length > 0 ? part.type : "application/octet-stream";

    // 4) 落库:记 origin=upload + 会话属主;put 内铸造公开 id、先落 blob 再写描述符。
    try {
      const bytes = new Uint8Array(await part.arrayBuffer());
      const attachment = await store.put({
        bytes,
        name,
        mimeType,
        size: bytes.byteLength,
        sessionId,
        origin: "upload",
      });
      const displayUrl = await store.presignUrl(attachment.id);
      return jsonResponse(200, { attachment, displayUrl });
    } catch {
      // 落盘/写描述符 IO 失败 → 500(不泄露内部细节)。
      return errorResponse(500, "INTERNAL", "Failed to store attachment.");
    }
  };
}

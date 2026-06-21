/**
 * uploadAttachment(baseUrl, sessionId, file, fetch?) — 向会话上传端点发起 multipart 上传。
 *
 *   POST /sessions/:id/attachments   (multipart/form-data, 字段 `file`)
 *     → 200 { attachment, displayUrl }(经 UploadAttachmentResponseSchema 校验)
 *
 * 与发消息解耦:先把文件落库换回正式描述符(公开 id + 展示 URL),供 hook 摄入(Req 5.1)。
 * 非 2xx 或响应不符 schema → 抛错,供调用方 hook 捕获并置该附件为 error 态(Req 5.5)。
 *
 * 仅依赖标准 Web Fetch(可注入,默认全局 fetch)+ Web `FormData`;不在内存保留字节副本。
 * 不设 content-type 头:交由 fetch 由 FormData 派生 multipart boundary。
 */
import {
  UploadAttachmentResponseSchema,
  type UploadAttachmentResponse,
} from "@pi-web/protocol";
import { joinUrl, type FetchLike } from "../client/request.js";

export type { FetchLike };

/**
 * 上传单个文件到会话上传端点并解析校验响应描述符。
 *
 * @param baseUrl http-api 基址(如 `/api`),与 `createPiClient` 同源拼接。
 * @param sessionId 目标会话 id(写路径门控落在 `:id`)。
 * @param file 待上传文件(`File`/`Blob`,经 multipart `file` 字段发送)。
 * @param fetchImpl 可注入 fetch(默认全局 fetch)。
 * @returns 解析并 zod 校验后的 `{ attachment, displayUrl }`。
 * @throws 非 2xx 响应(网络/鉴权/校验失败)或响应体不符 schema 时抛出。
 */
export async function uploadAttachment(
  baseUrl: string,
  sessionId: string,
  file: File,
  fetchImpl?: FetchLike,
): Promise<UploadAttachmentResponse> {
  const f: FetchLike = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const form = new FormData();
  form.append("file", file);

  const url = joinUrl(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/attachments`,
  );

  // 不显式设 content-type:让 fetch 据 FormData 自动写入含 boundary 的 multipart 头。
  const res = await f(url, {
    method: "POST",
    body: form,
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    throw new Error(
      `uploadAttachment failed: ${res.status}${detail === "" ? "" : ` ${detail}`}`,
    );
  }

  const json: unknown = await res.json();
  return UploadAttachmentResponseSchema.parse(json);
}

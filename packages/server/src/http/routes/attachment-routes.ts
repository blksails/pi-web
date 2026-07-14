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
 * 分发端点 handler(task 3.2;Req 4.1/4.2/4.3/4.4):
 *
 *   GET /attachments/:id/raw?exp&sig   → 字节流(`Content-Type`=附件 mime,`Cache-Control`)
 *
 * 读路径**不**绑会话:靠签名自洽鉴权,故注入路由用**非 `id`** 参数名(`:attachmentId`),
 * 避免 Router 把附件 id 当作 sessionId 触发会话存在性 404 门控;handler 自行从 URL 路径
 * 解析附件 id。防枚举关键:**先校验签名**(无/无效/过期一律 401,不查存在性),仅签名有效
 * 才查描述符,查不到才 404 —— 攻击者无法据响应区分某 id 是否存在(Req 4.4)。
 *
 * `createAttachmentRoutes` 工厂(上传 + 分发完整导出)留给 task 3.3;本文件聚焦两个 handler。
 */
import type { AttachmentStore } from "../../attachment/index.js";
import { BlobNotFoundError } from "../../attachment/index.js";
import { errorResponse, jsonResponse } from "../error-map.js";
import type {
  InjectedRoute,
  RequestContext,
  RouteHandler,
} from "../handler.types.js";
import { Readable } from "node:stream";

/** 默认上传大小上限(字节)。可经 handler 选项覆盖。 */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB

/** multipart 文件字段名(与前端 `uploadAttachment` 约定一致)。 */
const FILE_FIELD = "file";

/** 上传 handler 选项(大小上限等)。 */
export interface UploadHandlerOptions {
  /** 上传字节上限;超限以 413 拒绝。默认 {@link DEFAULT_MAX_UPLOAD_BYTES}。 */
  readonly maxBytes?: number;
  /**
   * 按会话 id 解析写目标后端名(`agent-attachment-profile` spec,Req 3.1)。查无会话/无 profile
   * → 返回 `undefined`(回落宿主默认写路由,不抛)。缺省(未注入)= 现状,恒不解析。
   */
  readonly resolveWriteBackend?: (sessionId: string) => string | undefined;
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
    // writeBackend(agent-attachment-profile spec,Req 3.1):注入的 resolver 按 sessionId 解析
    // 该会话 agent 声明的写目标 profile;未注入/查无 → undefined,回落宿主默认写路由。
    try {
      const bytes = new Uint8Array(await part.arrayBuffer());
      const writeBackend = options.resolveWriteBackend?.(sessionId);
      const attachment = await store.put({
        bytes,
        name,
        mimeType,
        size: bytes.byteLength,
        sessionId,
        origin: "upload",
        writeBackend,
      });
      const displayUrl = await store.presignUrl(attachment.id);
      return jsonResponse(200, { attachment, displayUrl });
    } catch {
      // 落盘/写描述符 IO 失败 → 500(不泄露内部细节)。
      return errorResponse(500, "INTERNAL", "Failed to store attachment.");
    }
  };
}

/**
 * 分发端点路由模板:`/attachments/:attachmentId/raw`。
 *
 * 用**非 `id`** 参数名以**避开** Router 的 `:id` 会话门控(会话存在性 404):读路径不绑会话,
 * 靠签名自洽鉴权。handler 自行从 URL 路径解析附件 id(Router 不传非 `id` 参数)。
 */
export const RAW_ATTACHMENT_ROUTE = "/attachments/:attachmentId/raw";

/** 分发响应缓存头:私有可缓存(签名 URL 含过期窗口,重复展示可客户端缓存,Req 4.2)。 */
const RAW_CACHE_CONTROL = "private, max-age=300";

/**
 * 从 `/attachments/<id>/raw` 形态的 URL 路径中解析附件 id(末段为 `raw`,其前一段为 id)。
 *
 * 不依赖 Router 的 `:id` 注入(那会触发会话门控);对任意 basePath 前缀健壮(只看 `…/<id>/raw` 尾部)。
 * 解析不出返回 `undefined`(handler 据此返回 404,与签名失败语义对齐防枚举)。
 */
function parseAttachmentId(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const rawIdx = segments.lastIndexOf("raw");
  if (rawIdx < 1) return undefined;
  const id = segments[rawIdx - 1];
  if (id === undefined || id.length === 0) return undefined;
  return decodeURIComponent(id);
}

/** Node 可读流 → Web ReadableStream(用于流式 `Response` 体,避免全量入内存)。 */
function toWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(node as Readable) as ReadableStream<Uint8Array>;
}

/**
 * 构造分发端点 handler `GET /attachments/:id/raw?exp&sig`。
 *
 * 流程(防枚举,design.md §System Flows 读路径):
 *  1) 解析路径附件 id 与查询 `exp`/`sig`;缺失/不可解析的签名参数 → 401(与无效签名同语义)。
 *  2) **先校验签名**(`store.verifyUrl`,常量时间 + 过期检查);失败一律 401,**不查存在性**
 *     —— 攻击者无法据响应区分该 id 是否存在(Req 4.3/4.4)。
 *  3) 仅签名有效才取读流;`BlobNotFoundError` → 404(此分支才暴露「不存在」,但需有效签名方可触达)。
 *  4) 成功 → 流式 `Response`,`Content-Type` = 附件 mime,带 `Cache-Control`(Req 4.1/4.2)。
 */
export function makeRawAttachmentHandler(store: AttachmentStore): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    const id = parseAttachmentId(ctx.url);
    const expRaw = ctx.url.searchParams.get("exp");
    const sig = ctx.url.searchParams.get("sig");

    // 1) 签名参数缺失/不可解析 → 401(与无效签名同响应,不泄露 id 解析结果)。
    if (id === undefined || expRaw === null || sig === null) {
      return unauthorized();
    }
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) {
      return unauthorized();
    }

    // 2) 先校验签名(常量时间 + 过期);失败一律 401,不查存在性(防枚举,Req 4.3/4.4)。
    if (!store.verifyUrl(id, exp, sig)) {
      return unauthorized();
    }

    // 3) 签名有效才取字节;不存在 → 404(此分支需有效签名方可触达)。
    let stream: NodeJS.ReadableStream;
    let mimeType: string;
    try {
      const read = await store.getReadStream(id);
      stream = read.stream;
      mimeType = read.meta.mimeType;
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        return errorResponse(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
      }
      // 读流 IO 失败 → 500(不泄露内部细节)。
      return errorResponse(500, "INTERNAL", "Failed to read attachment.");
    }

    // 4) 流式返回字节,正确 mime + 缓存头(Req 4.1/4.2)。
    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    headers.set("Cache-Control", RAW_CACHE_CONTROL);
    return new Response(toWebStream(stream), { status: 200, headers });
  };
}

/** 未授权响应:签名缺失/无效/过期统一为此响应(防枚举,不暴露 id 是否存在)。 */
function unauthorized(): Response {
  return errorResponse(401, "INVALID_SIGNATURE", "Invalid or missing signature.");
}

/**
 * 上传端点路由模板:`/sessions/:id/attachments`。
 *
 * 用 `:id` 参数名以**复用** Router 的会话解析 + 鉴权门控(会话不存在 404、越权 403、
 * 未鉴权 401);命中上传 handler 时 `ctx.sessionId` 即已校验的会话属主(Req 3.3)。
 */
export const UPLOAD_ATTACHMENT_ROUTE = "/sessions/:id/attachments";

/**
 * 构造附件注入路由数组(上传 + 分发),与既有 `createConfigRoutes` 同范式:
 * 返回值可直接传入 `createPiWebHandler({ routes })` 的 `routes?` 注入接缝。
 *
 * - 上传:`POST {@link UPLOAD_ATTACHMENT_ROUTE}`(`:id` → 会话门控,Req 3.1/3.3)。
 * - 分发:`GET {@link RAW_ATTACHMENT_ROUTE}`(`:attachmentId` → **不**绑会话,靠签名自洽鉴权,
 *   Req 4.x;切勿改用 `:id`,否则 Router 会把附件 id 当 sessionId 触发会话存在性 404)。
 */
export function createAttachmentRoutes(
  store: AttachmentStore,
  options: UploadHandlerOptions = {},
): InjectedRoute[] {
  return [
    {
      method: "POST",
      path: UPLOAD_ATTACHMENT_ROUTE,
      handler: makeUploadAttachmentHandler(store, options),
    },
    {
      method: "GET",
      path: RAW_ATTACHMENT_ROUTE,
      handler: makeRawAttachmentHandler(store),
    },
  ];
}

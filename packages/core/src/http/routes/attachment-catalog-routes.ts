/**
 * http-api — 附件目录物化端点(spec agent-attachment-catalog,任务 4.2;Req 3.2, 3.4, 5.4)。
 *
 *   POST /sessions/:id/attachment-catalog/:entryId/materialize
 *     → 200 { attachmentId, attachment, displayUrl }
 *     | 404 SESSION_NOT_FOUND(会话不存在,Router `:id` 既有门控)
 *     | 404 ENTRY_NOT_FOUND(条目不存在)
 *     | 502 CATALOG_ERROR(目录 handler 侧错误)
 *     | 504 CATALOG_TIMEOUT(转发超时)
 *
 * 与 `agent-route-routes.ts` 同范式:用 `:id` 参数名**复用** Router 的会话解析 + 鉴权门控
 * (会话不存在 404、越权 403、未鉴权 401);命中此 handler 时会话已存在且已授权(Req 5.4)。
 * `:entryId` 非 `id` 段,Router 不透出 —— 从 `ctx.url.pathname` 自行解析(与
 * `agent-route-routes.ts` 的 `routeNameFromPath` 同法)。
 *
 * 转发经 `session.requestCatalog({op:"materialize",entryId})`(pi-session task 3.1);
 * 超时毫秒经 `PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS`(缺省 20000,agent-route-routes 同风格)。
 */
import type { Attachment } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { AttachmentCatalogTimeoutError } from "../../session/session.errors.js";
import { errorResponse, jsonResponse } from "../error-map.js";
import { mapEngineError } from "../error-map.js";
import type { InjectedRoute, RequestContext, RouteHandler } from "../handler.types.js";

/**
 * 本端点仅需的 AttachmentStore 最小只读子集(与 `AttachmentLister`(catalog provider)
 * 同窄化原则):`head` 读回落库描述符,`presignUrl` 签发展示 URL。不要求完整
 * `AttachmentStore`(如 `put`/`getReadStream`),便于按 `opts.attachmentStore` 的既有窄契约
 * (`AttachmentMetaSource & Partial<Pick<AttachmentStore,"listBySession"|"presignUrl">>`)注入。
 */
export interface MaterializeAttachmentLister {
  head(id: string): Promise<Attachment | undefined>;
  presignUrl(id: string): Promise<string>;
}

/** 物化转发超时 env(毫秒;未设置/非法走代码内默认 20000)。 */
export const ATTACHMENT_CATALOG_TIMEOUT_ENV = "PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS";
/** 代码内默认超时(agent-route-routes 同风格)。 */
const DEFAULT_TIMEOUT_MS = 20_000;

/** 解析正整数 env;未设置/非法返回 undefined(调用方给默认)。 */
function positiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/**
 * 从 `/sessions/<id>/attachment-catalog/<entryId>/materialize` 路径中解析 `:entryId`
 * (末段恒为 `materialize`,其前一段为 entryId)。解析不出返回 `undefined`。
 */
function entryIdFromPath(ctx: RequestContext): string | undefined {
  const segments = ctx.url.pathname.split("/").filter((s) => s.length > 0);
  const idx = segments.lastIndexOf("materialize");
  if (idx < 1) return undefined;
  const raw = segments[idx - 1];
  if (raw === undefined || raw.length === 0) return undefined;
  return decodeURIComponent(raw);
}

/** 物化端点路由模板:`/sessions/:id/attachment-catalog/:entryId/materialize`。 */
export const MATERIALIZE_CATALOG_ROUTE = "/sessions/:id/attachment-catalog/:entryId/materialize";

/**
 * POST /sessions/:id/attachment-catalog/:entryId/materialize → 转发一次物化调用并同步返回。
 */
export function makeMaterializeCatalogEntryHandler(
  store: SessionStore,
  attachments: MaterializeAttachmentLister,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const entryId = entryIdFromPath(ctx);
      if (entryId === undefined) {
        return errorResponse(404, "ENTRY_NOT_FOUND", "Catalog entry id missing from path.");
      }

      const frame = await session.requestCatalog(
        { op: "materialize", entryId },
        positiveIntEnv(ATTACHMENT_CATALOG_TIMEOUT_ENV) ?? DEFAULT_TIMEOUT_MS,
      );

      if (!frame.ok) {
        const code = frame.error?.code;
        if (code === "ENTRY_NOT_FOUND") {
          return errorResponse(
            404,
            "ENTRY_NOT_FOUND",
            frame.error?.message ?? `Catalog entry "${entryId}" not found.`,
          );
        }
        return errorResponse(
          502,
          "CATALOG_ERROR",
          frame.error?.message ?? `Failed to materialize catalog entry "${entryId}".`,
        );
      }
      if (frame.attachmentId === undefined) {
        return errorResponse(502, "CATALOG_ERROR", "Materialize result missing attachmentId.");
      }

      const attachment = await attachments.head(frame.attachmentId);
      if (attachment === undefined) {
        return errorResponse(502, "CATALOG_ERROR", "Materialized attachment not found.");
      }
      const displayUrl = await attachments.presignUrl(frame.attachmentId);
      return jsonResponse(200, { attachmentId: frame.attachmentId, attachment, displayUrl });
    } catch (err) {
      if (err instanceof AttachmentCatalogTimeoutError) {
        return errorResponse(504, err.code, err.message);
      }
      return mapEngineError(err);
    }
  };
}

/**
 * 构造附件目录注入路由数组,与既有 `createAttachmentRoutes` 同范式:返回值可直接传入
 * `createPiWebHandler({ routes })` 的 `routes?` 注入接缝。
 */
export function createAttachmentCatalogRoutes(
  store: SessionStore,
  attachments: MaterializeAttachmentLister,
): InjectedRoute[] {
  return [
    {
      method: "POST",
      path: MATERIALIZE_CATALOG_ROUTE,
      handler: makeMaterializeCatalogEntryHandler(store, attachments),
    },
  ];
}

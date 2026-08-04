/**
 * http-api — 查询端点(Req 4.x)。
 *
 * `GET /sessions/:id/{state,stats,messages,commands}`:转发 `PiSession` 查询方法,
 * 把成功 `RpcResponse.data` 投影为 `@blksails/pi-web-protocol` 的对应响应 DTO 形状返回。
 * 不重定义响应形状(Req 4.5)。会话不存在→404(router 已校验,此处兜底)。
 */
import type { LogLevel, RpcResponse } from "@blksails/pi-web-protocol";
import { LogLevelSchema } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import {
  parseHiddenProviders,
  excludeProviderModels,
} from "../../config/model-options-filter.js";
import { enrichWebVisibleCommands } from "../../plugin/enrich-web-visible.js";

interface HistoryAttachmentStore {
  readonly head: (id: string) => Promise<{ readonly sessionId: string } | undefined>;
  readonly presignUrl?: (id: string) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attachmentIdOf(value: Record<string, unknown>): string | undefined {
  for (const key of ["attachmentId", "outputAttachmentId", "inputAttachmentId"]) {
    const id = value[key];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

/**
 * 历史消息只保存 attachmentId 时，补一条新的签名 URL。
 * 原 URL 可能已过期；不在当前会话名下的附件不签发，避免跨会话泄露。
 */
async function refreshHistoryAttachmentUrls(
  messages: readonly unknown[],
  sessionId: string,
  attachments: HistoryAttachmentStore,
): Promise<unknown[]> {
  if (attachments.presignUrl === undefined) return [...messages];

  const ids = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (!isRecord(value)) return;
    const id = attachmentIdOf(value);
    if (id !== undefined) ids.add(id);
    for (const child of Object.values(value)) collect(child);
  };
  collect(messages);

  const urls = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const attachment = await attachments.head(id);
        if (attachment?.sessionId === sessionId) {
          urls.set(id, await attachments.presignUrl!(id));
        }
      } catch {
        // 图片只是展示增强；历史消息本身仍照常返回。
      }
    }),
  );

  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isRecord(value)) return value;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewrite(child)]),
    ) as Record<string, unknown>;
    const id = attachmentIdOf(value);
    const url = id === undefined ? undefined : urls.get(id);
    if (url !== undefined) next["displayUrl"] = url;
    return next;
  };
  return messages.map(rewrite);
}

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/** 提取成功响应的 data;失败→统一 502 上游错误。 */
function dataOrError<T>(
  res: RpcResponse,
): { ok: true; data: T } | { ok: false; response: Response } {
  if (res.success && "data" in res) {
    return { ok: true, data: (res as { data: T }).data };
  }
  const message =
    !res.success && "error" in res ? res.error : "Upstream command failed.";
  return {
    ok: false,
    response: errorResponse(502, "UPSTREAM_ERROR", message),
  };
}

/** GET /sessions/:id/state */
export function makeStateHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getState();
      const extracted = dataOrError<unknown>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { state: extracted.data });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/stats */
export function makeStatsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getSessionStats();
      const extracted = dataOrError<unknown>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { stats: extracted.data });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/messages */
export function makeMessagesQueryHandler(
  store: SessionStore,
  attachmentStore?: HistoryAttachmentStore,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      const messages =
        attachmentStore !== undefined
          ? await refreshHistoryAttachmentUrls(
              extracted.data.messages,
              ctx.sessionId ?? "",
              attachmentStore,
            )
          : extracted.data.messages;
      return jsonResponse(200, { messages });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/commands */
export function makeCommandsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getCommands();
      const extracted = dataOrError<{ commands: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      // 据各扩展命令所属插件的 pi-web.json(web.commands)回填 webVisible(plugin-system-unification)。
      const commands = await enrichWebVisibleCommands(extracted.data.commands);
      return jsonResponse(200, { commands });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * GET /sessions/:id/models → get_available_models 的 `{ models }`(Req 4.1)。
 *
 * 与 `/config/models` 同样尊重 `PI_WEB_HIDE_PROVIDERS`(逗号分隔)部署期开关:剔除被隐藏
 * provider 的模型,使聊天区模型选择器与设置页下拉对齐(同一隐藏名单)。env 可注入便于测试。
 */
export function makeModelsHandler(
  store: SessionStore,
  env: NodeJS.ProcessEnv = process.env,
): RouteHandler {
  const hidden = parseHiddenProviders(env["PI_WEB_HIDE_PROVIDERS"]);
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getAvailableModels();
      const extracted = dataOrError<{
        models: ReadonlyArray<{ readonly provider?: unknown }>;
      }>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, {
        models: excludeProviderModels(extracted.data.models, hidden),
      });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** GET /sessions/:id/fork-messages → get_fork_messages 的 `{ messages }`(Req 8.3)。 */
export function makeForkMessagesHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getForkMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { messages: extracted.data.messages });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * GET /sessions/:id/logs?level=&limit=&since=
 * 读取会话 ring buffer，返回 GetLogsResponse `{ entries }`（Req 4.2 / 4.3）。
 * 查询参数全部可选:level(LogLevel)、limit(integer)、since(epoch ms)。
 * 会话不存在 → 404。
 */
export function makeLogsHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const params = ctx.url.searchParams;

      // Parse level.
      let level: LogLevel | undefined;
      const levelRaw = params.get("level");
      if (levelRaw !== null) {
        const parsed = LogLevelSchema.safeParse(levelRaw);
        if (!parsed.success) {
          return errorResponse(400, "INVALID_PARAM", `Invalid level: "${levelRaw}".`);
        }
        level = parsed.data;
      }

      // Parse limit.
      let limit: number | undefined;
      const limitRaw = params.get("limit");
      if (limitRaw !== null) {
        const n = Number(limitRaw);
        if (!Number.isInteger(n) || n < 0) {
          return errorResponse(400, "INVALID_PARAM", `Invalid limit: "${limitRaw}".`);
        }
        limit = n;
      }

      // Parse since.
      let since: number | undefined;
      const sinceRaw = params.get("since");
      if (sinceRaw !== null) {
        const n = Number(sinceRaw);
        if (!Number.isFinite(n)) {
          return errorResponse(400, "INVALID_PARAM", `Invalid since: "${sinceRaw}".`);
        }
        since = n;
      }

      const entries = session.getLogs({ level, limit, since });
      return jsonResponse(200, { entries });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

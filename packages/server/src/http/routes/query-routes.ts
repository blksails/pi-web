/**
 * http-api — 查询端点(Req 4.x)。
 *
 * `GET /sessions/:id/{state,stats,messages,commands}`:转发 `PiSession` 查询方法,
 * 把成功 `RpcResponse.data` 投影为 `@pi-web/protocol` 的对应响应 DTO 形状返回。
 * 不重定义响应形状(Req 4.5)。会话不存在→404(router 已校验,此处兜底)。
 */
import type { RpcResponse } from "@pi-web/protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";

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
export function makeMessagesQueryHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const res = await session.getMessages();
      const extracted = dataOrError<{ messages: unknown[] }>(res);
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { messages: extracted.data.messages });
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
      return jsonResponse(200, { commands: extracted.data.commands });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

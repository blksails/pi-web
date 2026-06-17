/**
 * http-api — DELETE /sessions/:id(Req 2.3)。
 *
 * 触发 `PiSession.stop()`(上游经 `onClosed` 从 store 移除)→ ack。会话不存在→404
 * (router 已校验,此处兜底)。
 */
import { SessionNotFoundError } from "../../session/index.js";
import type { SessionStore } from "../../session/index.js";
import { jsonResponse, mapEngineError } from "../error-map.js";
import type { RouteHandler } from "../handler.types.js";

export function makeDeleteSessionHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const id = ctx.sessionId ?? "";
    const session = store.get(id);
    if (session === undefined) {
      return mapEngineError(new SessionNotFoundError(id));
    }
    try {
      await session.stop("stopped");
      return jsonResponse(200, { ok: true });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

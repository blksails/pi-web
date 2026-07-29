/**
 * http-api — SSE 流端点(Req 5.1/5.7/6.2/6.3)。
 *
 * `GET /sessions/:id/stream`:会话存在且活动→经 sse-response 订阅并返回 text/event-stream
 * 长连接;带 `Last-Event-ID` 续号续流(重新 subscribe,网关不缓存历史帧);会话不存在
 * →404(router 已校验,此处兜底);会话已结束(stopped)→明确结束响应而非空流挂起。
 */
import { SessionNotFoundError } from "../../session/index.js";
import type { SessionStore } from "../../session/index.js";
import { errorResponse } from "../error-map.js";
import type { RouteHandler } from "../handler.types.js";
import { buildSseResponse, parseLastEventId } from "../sse-response.js";

export function makeStreamHandler(
  store: SessionStore,
  heartbeatMs?: number,
): RouteHandler {
  return (ctx): Promise<Response> => {
    const id = ctx.sessionId ?? "";
    const session = store.get(id);
    if (session === undefined) {
      const err = new SessionNotFoundError(id);
      return Promise.resolve(errorResponse(404, err.code, err.message));
    }
    // 会话已结束:返回明确结束响应,不建立空流(Req 6.3)。
    if (session.status !== "active") {
      return Promise.resolve(
        errorResponse(
          409,
          "SESSION_ENDED",
          `Session "${id}" has ended; cannot stream.`,
        ),
      );
    }
    const startSeq = parseLastEventId(ctx.req);
    return Promise.resolve(
      buildSseResponse(
        heartbeatMs !== undefined
          ? { session, startSeq, heartbeatMs }
          : { session, startSeq },
      ),
    );
  };
}

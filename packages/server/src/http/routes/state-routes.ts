/**
 * http-api — 状态注入桥写回端点(state-injection-bridge)。
 *
 * `POST /sessions/:id/state`:校验 `StateSetRequest` → `PiSession.setState`(经 stdin 内部行下发
 * 子进程权威态)→ 200 同步响应体 ack。校验失败→400(不转发);未知会话→404(经 error-map)。
 * UI 收敛靠下行 `control:"state"` 帧(不在此等待)。
 */
import { StateSetRequestSchema } from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import { validateBody } from "../validate.js";

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/** POST /sessions/:id/state → 写回会话共享状态(set/delete)。 */
export function makeStateWriteHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, StateSetRequestSchema);
    if (!parsed.ok) return parsed.response; // 400:负载不合契约,不改权威态(4.3/5.3)
    const { key, value, op } = parsed.value;
    try {
      const session = requireSession(store, ctx);
      session.setState(key, value, op);
      return jsonResponse(200, { ok: true }); // 同步 ack(4.4)
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

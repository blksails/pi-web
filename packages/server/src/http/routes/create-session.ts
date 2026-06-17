/**
 * http-api — POST /sessions(Req 2.1/2.2/2.5)。
 *
 * 校验建会话 DTO → 经注入 resolver 解析 source → 经注入 createChannel 构造通道 →
 * `SessionManager.createSession` → `{ sessionId }`。停机(manager 不再接受新会话)→ 503;
 * 缺 `source`/类型错 → 400(含字段路径)。http-api 不 spawn、不解析、不持有会话状态。
 */
import { CreateSessionRequestSchema } from "@pi-web/protocol";
import type { ResolvedSource } from "../../agent-source/index.js";
import { AgentSourceResolver } from "../../agent-source/index.js";
import type { SessionChannel, SessionManager } from "../../session/index.js";
import { jsonResponse, mapEngineError, errorResponse } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import { validateBody } from "../validate.js";

export interface CreateSessionDeps {
  readonly manager: SessionManager;
  readonly resolver?: {
    resolve: (
      source: string | undefined,
      opts?: { cwd?: string },
    ) => Promise<ResolvedSource>;
  };
  readonly createChannel?: (resolved: ResolvedSource) => SessionChannel;
}

export function makeCreateSessionHandler(deps: CreateSessionDeps): RouteHandler {
  const resolver = deps.resolver ?? AgentSourceResolver;
  return async (ctx: RequestContext): Promise<Response> => {
    if (!deps.manager.isAccepting()) {
      return errorResponse(
        503,
        "SHUTTING_DOWN",
        "Server is shutting down; not accepting new sessions.",
      );
    }

    const parsed = await validateBody(ctx.req, CreateSessionRequestSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;

    if (deps.createChannel === undefined) {
      return errorResponse(
        500,
        "NO_CHANNEL_FACTORY",
        "Server is not configured to create session channels.",
      );
    }

    try {
      const resolved = await resolver.resolve(
        body.source,
        body.cwd !== undefined ? { cwd: body.cwd } : {},
      );
      const channel = deps.createChannel(resolved);
      const { sessionId } = deps.manager.createSession({ resolved, channel });
      return jsonResponse(201, { sessionId });
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

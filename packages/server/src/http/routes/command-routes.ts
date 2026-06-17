/**
 * http-api — 命令转发端点(Req 3.x)。
 *
 * `POST /sessions/:id/{messages,steer,follow_up,abort,model,thinking,ui-response}`:
 * 校验对应 protocol DTO → 转发到 `PiSession` 命令方法 → 返回 ack;仅转发不改写语义。
 * 校验失败→400(不转发);已停止会话→409;未知 ui-response ID→409(经 error-map)。
 */
import {
  PromptRequestSchema,
  SetModelRequestSchema,
  SetThinkingRequestSchema,
  SteerRequestSchema,
  UiResponseRequestSchema,
} from "@pi-web/protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import { jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import { validateBody } from "../validate.js";

function ack(): Response {
  return jsonResponse(200, { ok: true });
}

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/** POST /sessions/:id/messages → PiSession.prompt */
export function makeMessagesHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, PromptRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { message, images, streamingBehavior } = parsed.value;
      const options: {
        images?: typeof images;
        streamingBehavior?: typeof streamingBehavior;
      } = {};
      if (images !== undefined) options.images = images;
      if (streamingBehavior !== undefined)
        options.streamingBehavior = streamingBehavior;
      await session.prompt(message, options);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/steer → PiSession.steer */
export function makeSteerHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SteerRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { message, images } = parsed.value;
      await session.steer(
        message,
        images !== undefined ? { images } : undefined,
      );
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/follow_up → PiSession.followUp */
export function makeFollowUpHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SteerRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { message, images } = parsed.value;
      await session.followUp(
        message,
        images !== undefined ? { images } : undefined,
      );
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/abort → PiSession.abort(空体) */
export function makeAbortHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      await session.abort();
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/model → PiSession.setModel */
export function makeModelHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SetModelRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { provider, modelId } = parsed.value;
      await session.setModel(provider, modelId);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/thinking → PiSession.setThinkingLevel */
export function makeThinkingHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SetThinkingRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      await session.setThinkingLevel(parsed.value.level);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/ui-response → PiSession.respondExtensionUI */
export function makeUiResponseHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, UiResponseRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      session.respondExtensionUI(parsed.value.id, parsed.value);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

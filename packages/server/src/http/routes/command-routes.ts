/**
 * http-api — 命令转发端点(Req 3.x)。
 *
 * `POST /sessions/:id/{messages,steer,follow_up,abort,model,thinking,ui-response}`:
 * 校验对应 protocol DTO → 转发到 `PiSession` 命令方法 → 返回 ack;仅转发不改写语义。
 * 校验失败→400(不转发);已停止会话→409;未知 ui-response ID→409(经 error-map)。
 */
import {
  type Attachment,
  ForkRequestSchema,
  PromptRequestSchema,
  type RpcResponse,
  SetModelRequestSchema,
  SetThinkingRequestSchema,
  SteerRequestSchema,
  UiResponseRequestSchema,
  UiRpcRequestSchema,
} from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import { SessionNotFoundError } from "../../session/index.js";
import {
  resolveCompletions,
  type CompletionRegistry,
} from "../../completion/index.js";
import { injectAttachmentRefs } from "../../attachment-bridge/reference-injection.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import { validateBody } from "../validate.js";

function ack(): Response {
  return jsonResponse(200, { ok: true });
}

/** 提取成功响应的 data;失败→统一 502 上游错误(镜像 query-routes)。 */
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

function requireSession(store: SessionStore, ctx: RequestContext): PiSession {
  const id = ctx.sessionId ?? "";
  const session = store.get(id);
  if (session === undefined) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

/**
 * 主进程附件元数据源(attachment-tool-bridge,Req 8.1)。
 *
 * `makeMessagesHandler` 运行在主进程,据前端提交的 `attachmentIds` 取 `{id,mimeType,name}`
 * 以构造结构化文本引用标记。仅依赖只读 `head(id)` 访问器,与主进程 `AttachmentStore` 门面
 * 同形(`Pick<AttachmentStore, "head">`),由装配层注入既有主进程 store(勿新造下发)。
 */
export interface AttachmentMetaSource {
  /** 按公开 id 取描述符(不含字节);不存在返回 `undefined`。 */
  head(id: string): Promise<Attachment | undefined>;
}

/**
 * 据 `attachmentIds` 经主进程 store 解析出已落库附件描述符,保留提交顺序、跳过未知 id。
 * 仅取元数据(不取字节),供 `injectAttachmentRefs` 构造文本引用(Req 8.1/9.1)。
 */
async function resolveAttachments(
  attachmentIds: readonly string[] | undefined,
  store: AttachmentMetaSource | undefined,
): Promise<Attachment[]> {
  if (
    store === undefined ||
    attachmentIds === undefined ||
    attachmentIds.length === 0
  ) {
    return [];
  }
  const resolved = await Promise.all(
    attachmentIds.map((id) => store.head(id)),
  );
  return resolved.filter((a): a is Attachment => a !== undefined);
}

/** POST /sessions/:id/messages → PiSession.prompt(发送前解析补全 token + 注入附件引用) */
export function makeMessagesHandler(
  store: SessionStore,
  completion?: CompletionRegistry,
  attachmentStore?: AttachmentMetaSource,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, PromptRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { images, streamingBehavior, attachmentIds } = parsed.value;
      let message = parsed.value.message;
      // completion-provider-framework:提交期把 @file:… 等 token 解析为上下文文本。
      if (completion !== undefined) {
        message = await resolveCompletions(
          message,
          {
            sessionId: session.id,
            cwd: session.cwd,
            userId: ctx.auth.userId ?? "",
          },
          completion,
        );
      }
      // attachment-tool-bridge(Req 8.1/9.1):与 resolveCompletions 同一文本组装链路,
      // 在 prompt 之前把已落库附件以结构化文本引用注入用户消息文本(仅文本,不内联字节;
      // 与下方 images/vision base64 并存,不替代)。
      const attachments = await resolveAttachments(attachmentIds, attachmentStore);
      message = injectAttachmentRefs(message, attachments);
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

/** POST /sessions/:id/fork → PiSession.fork(entryId)。返回 fork 协议契约负载(Req 8.2)。 */
export function makeForkHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, ForkRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const res = await session.fork(parsed.value.entryId);
      const extracted = dataOrError<{ text?: string; cancelled?: boolean }>(res);
      if (!extracted.ok) return extracted.response;
      const payload: { text?: string; cancelled?: boolean } = {};
      if (extracted.data.text !== undefined) payload.text = extracted.data.text;
      if (extracted.data.cancelled !== undefined)
        payload.cancelled = extracted.data.cancelled;
      return jsonResponse(200, payload);
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

/** POST /sessions/:id/ui-rpc → PiSession.uiRpc(Tier3,响应经 SSE control 帧回流) */
export function makeUiRpcHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, UiRpcRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      session.uiRpc(parsed.value);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

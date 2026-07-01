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
  CommandExecutePayloadSchema,
} from "@blksails/pi-web-protocol";
import type { PiSession, SessionStore } from "../../session/index.js";
import type { HostCommandRegistry } from "../../commands/host-command-registry.js";
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

/**
 * POST /sessions/:id/clear_queue → PiSession.clearQueue(message-queue-ui「取回」)。
 * 空请求体;同步返回被清空的 steering / follow-up 文本供前端回填编辑器。
 * 桥超时(子进程无回写)经 mapEngineError 归一为错误响应。
 */
export function makeClearQueueHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    try {
      const session = requireSession(store, ctx);
      const cleared = await session.clearQueue();
      return jsonResponse(200, cleared);
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

/**
 * POST /sessions/:id/ui-rpc → Tier3 ui-rpc 上行。
 *
 * unified-command-result-layer(决策 A):当注入了 host 命令注册表,且请求为
 * `point="command"` / `action="execute"` 且命令名已注册时,**服务端执行**该命令并经
 * `PiSession.emitUiRpcResponse` 合成 `control:"ui-rpc"` 结果帧回流(不转 agent)。
 * 其余情况(非 host 命令 / 其它 point)保持既有 `PiSession.uiRpc` 转发(向后兼容)。
 */
export function makeUiRpcHandler(
  store: SessionStore,
  hostCommands?: HostCommandRegistry,
): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, UiRpcRequestSchema);
    if (!parsed.ok) return parsed.response;
    const req = parsed.value;
    try {
      const session = requireSession(store, ctx);

      // host 命令拦截:point=command/execute + 注册表命中 → **服务端同步执行**,结果直接在
      // HTTP 响应体返回(不走 agent、不依赖 SSE 控制流,避免与 prompt 流冲突)。
      if (
        hostCommands !== undefined &&
        req.point === "command" &&
        req.action === "execute"
      ) {
        const payload = CommandExecutePayloadSchema.safeParse(req.payload);
        if (payload.success && hostCommands.has(payload.data.name)) {
          // registry.execute 不抛:成功/可恢复失败均以 CommandResult 表达(失败转 effect:"notify"
          // + message,UI 据此呈现错误反馈,Req 3.3)。响应形如 UiRpcResponse(含 correlationId)。
          const result = await hostCommands.execute(payload.data.name, {
            session,
            argv: payload.data.argv ?? "",
          });
          return jsonResponse(200, {
            correlationId: req.correlationId,
            ok: true,
            result,
            protocolVersion: req.protocolVersion,
          });
        }
      }

      // 既有路径:转发 agent(响应经 SSE control:ui-rpc 异步回流)。
      session.uiRpc(req);
      return ack();
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

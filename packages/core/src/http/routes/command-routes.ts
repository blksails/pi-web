/**
 * http-api — 命令转发端点(Req 3.x)。
 *
 * `POST /sessions/:id/{messages,steer,follow_up,abort,models,thinking,ui-response}`:
 * 校验对应 protocol DTO → 转发到 `PiSession` 命令方法 → 返回 ack;仅转发不改写语义。
 * 校验失败→400(不转发);已停止会话→409;未知 ui-response ID→409(经 error-map)。
 */
import {
  type Attachment,
  CompactRequestSchema,
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
import type { BlobMeta } from "../../attachment/index.js";
import type { PiSession, SessionStore } from "../../session/index.js";
import type { HostCommandRegistry } from "../../commands/host-command-registry.js";
import { SessionNotFoundError } from "../../session/index.js";
import {
  resolveCompletions,
  type CompletionRegistry,
} from "../../completion/index.js";
import { injectAttachmentRefs } from "../../attachment-bridge/reference-injection.js";
import { materializePromptImages } from "../../attachment-bridge/materialize-prompt-images.js";
import { errorResponse, jsonResponse, mapEngineError } from "../error-map.js";
import type { RequestContext, RouteHandler } from "../handler.types.js";
import { validateBody } from "../validate.js";

function ack(): Response {
  return jsonResponse(200, { ok: true });
}

/**
 * 命令转发的 ack:**按 `RpcResponse.success` 分流**,失败→502(镜像 `dataOrError`)。
 *
 * ★为什么不能无条件 ack(pi-clouds #23 事故的遮蔽层):pi 的 `prompt` 是 preflight 语义——
 * 模型不可用(如 models.json 校验失败导致自定义模型全丢 → "No API key found for the selected
 * model")时回 `success:false` 且**不产生任何 turn/事件**。此处若照回 200,前端与运维侧看到的
 * 是"命令已接受但沙箱毫无反应"的黑洞,真错误信息被吞在 RPC 层永不现形。
 */
function ackOrError(res: RpcResponse): Response {
  if (res.success) return ack();
  const message = "error" in res ? res.error : "Upstream command failed.";
  return errorResponse(502, "UPSTREAM_ERROR", message);
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

const PREEMPTIVE_COMPACTION_PERCENT = 35;
const PREEMPTIVE_COMPACTION_INSTRUCTIONS =
  "Keep exact attachment ids, output ids, file paths, tool choices, failure classifications, and pending verification state; summarize completed work compactly.";
const preflightCompactions = new WeakMap<PiSession, Promise<void>>();

function contextUsagePercent(stats: unknown): number | undefined {
  if (typeof stats !== "object" || stats === null) return undefined;
  const usage = (stats as { contextUsage?: unknown }).contextUsage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const rawPercent = record.percent;
  if (typeof rawPercent === "number" && Number.isFinite(rawPercent)) {
    return rawPercent <= 1 ? rawPercent * 100 : rawPercent;
  }
  const tokens = record.tokens;
  const contextWindow = record.contextWindow;
  if (
    typeof tokens === "number" &&
    Number.isFinite(tokens) &&
    typeof contextWindow === "number" &&
    Number.isFinite(contextWindow) &&
    contextWindow > 0
  ) {
    return (tokens / contextWindow) * 100;
  }
  return undefined;
}

/** 大工作流提交前的服务端兜底压缩;压缩异常不阻断原 prompt。 */
function compactIfContextIsLarge(session: PiSession): Promise<void> {
  const active = preflightCompactions.get(session);
  if (active !== undefined) return active;
  const task = (async () => {
    try {
      const response = await session.getSessionStats();
      if (!response.success || !("data" in response)) return;
      const percent = contextUsagePercent(response.data);
      if (percent === undefined || percent < PREEMPTIVE_COMPACTION_PERCENT) return;
      await session.compact(PREEMPTIVE_COMPACTION_INSTRUCTIONS);
    } catch {
      // best effort:底层 auto-compaction 或 prompt 仍可继续完成。
    }
  })();
  preflightCompactions.set(session, task);
  return task.finally(() => {
    if (preflightCompactions.get(session) === task) preflightCompactions.delete(session);
  });
}

/**
 * 主进程附件元数据/字节源(attachment-tool-bridge + attachment-mention-vision)。
 *
 * `makeMessagesHandler` 运行在主进程:
 * - `head(id)`:构造结构化文本引用标记(Req 8.1);
 * - 可选 `getReadStream(id)`:把图像附件物化为 prompt 原生多模态 `images`
 *   (attachment-mention-vision,native LLM 识图;无此能力则仅文本引用)。
 * 与主进程 `AttachmentStore` 门面同形子集,由装配层注入既有主进程 store。
 */
export interface AttachmentMetaSource {
  /** 按公开 id 取描述符(不含字节);不存在返回 `undefined`。 */
  head(id: string): Promise<Attachment | undefined>;
  /**
   * 可选:读附件字节流,供图像附件物化为 prompt `images`。
   * 未提供时 `@` / attachmentIds 路径仅注入文本引用(与历史行为一致)。
   */
  getReadStream?(
    id: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }>;
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
      // attachment-mention-vision:把 @attachment / attachmentIds 中的图像物化为原生
      // 多模态 images 喂主模型(native LLM);不经 image_vision 工具。无 getReadStream
      // 时 fail-soft 为仅文本引用。与客户端 images 按 data 去重。
      let mergedImages = images;
      if (attachmentStore !== undefined) {
        mergedImages = await materializePromptImages({
          messageText: message,
          attachmentIds,
          existingImages: images,
          sessionId: session.id,
          store: attachmentStore,
          });
      }
      await compactIfContextIsLarge(session);
      const options: {
        images?: typeof images;
        streamingBehavior?: typeof streamingBehavior;
      } = {};
      if (mergedImages !== undefined) options.images = mergedImages;
      if (streamingBehavior !== undefined)
        options.streamingBehavior = streamingBehavior;
      return ackOrError(await session.prompt(message, options));
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/** POST /sessions/:id/compact → PiSession.compact */
export function makeCompactHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, CompactRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const extracted = dataOrError<unknown>(
        await session.compact(parsed.value.customInstructions),
      );
      if (!extracted.ok) return extracted.response;
      return jsonResponse(200, { result: extracted.data });
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
      return ackOrError(
        await session.steer(
          message,
          images !== undefined ? { images } : undefined,
        ),
      );
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
      return ackOrError(
        await session.followUp(
          message,
          images !== undefined ? { images } : undefined,
        ),
      );
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
      return ackOrError(await session.abort());
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

/** POST /sessions/:id/models → PiSession.setModel(与会话模型查询共用同一路径,仅方法区分,Req 3.7) */
export function makeModelHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SetModelRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      const { provider, modelId } = parsed.value;
      return ackOrError(await session.setModel(provider, modelId));
    } catch (err) {
      return mapEngineError(err);
    }
  };
}

/**
 * POST /sessions/:id/model(旧路径,已废弃,Req 3.8)——模型切换改挂到
 * `POST /sessions/:id/models`(与查询同路径,仅方法区分,与 `/model` 仅差单复数的旧路径不再使用)。
 * 既有集成方调用此旧路径时不静默 404:显式返回 410 + 指向新路径的文案,使调用方可辨识变更。
 */
export function makeModelPathMovedHandler(): RouteHandler {
  return async (): Promise<Response> =>
    errorResponse(
      410,
      "ENDPOINT_MOVED",
      "POST /sessions/:id/model has moved to POST /sessions/:id/models. Update your integration to call the new path.",
    );
}

/** POST /sessions/:id/thinking → PiSession.setThinkingLevel */
export function makeThinkingHandler(store: SessionStore): RouteHandler {
  return async (ctx): Promise<Response> => {
    const parsed = await validateBody(ctx.req, SetThinkingRequestSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const session = requireSession(store, ctx);
      return ackOrError(await session.setThinkingLevel(parsed.value.level));
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

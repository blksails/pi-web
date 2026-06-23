/**
 * http-api — createPiWebHandler 工厂(Req 1.1/1.3/1.6/1.7/9.3/9.4)。
 *
 * 组装 `Router` + 注入 `opts`(manager/store/resolver/createChannel/auth 接缝/外部 routes/
 * sse 调参),返回标准 Web Fetch `(req: Request) => Promise<Response>`。把 `opts.routes`
 * 传给 `Router` 合并(内置优先,外部不可遮蔽);外层 try/catch 兜底→500(不泄敏感)。
 * 透传上游 `shutdown()` 供宿主 SIGTERM 调用;不 spawn(默认通道工厂经注入提供)、不解析、
 * 不持有会话状态。
 */
import type { ResolvedSource } from "../agent-source/index.js";
import { PiRpcProcess } from "../rpc-channel/index.js";
import type { SessionChannel } from "../session/index.js";
import { errorResponse } from "./error-map.js";
import type {
  CreateChannelOpts,
  PiWebHandler,
  PiWebHandlerOptions,
} from "./handler.types.js";
import { makeCreateSessionHandler } from "./routes/create-session.js";
import {
  makeAbortHandler,
  makeFollowUpHandler,
  makeForkHandler,
  makeMessagesHandler,
  makeModelHandler,
  makeSteerHandler,
  makeThinkingHandler,
  makeUiResponseHandler,
  makeUiRpcHandler,
} from "./routes/command-routes.js";
import { makeDeleteSessionHandler } from "./routes/delete-session.js";
import {
  makeCommandsHandler,
  makeForkMessagesHandler,
  makeMessagesQueryHandler,
  makeModelsHandler,
  makeStateHandler,
  makeStatsHandler,
} from "./routes/query-routes.js";
import { makeStreamHandler } from "./routes/stream-route.js";
import {
  makeCompletionHandler,
  makeCompletionTriggersHandler,
} from "./routes/completion-routes.js";
import {
  createCompletionRegistry,
  createFileProvider,
  createAttachmentProvider,
  type AttachmentLister,
} from "../completion/index.js";
import { Router, type RouteSpec } from "./router.js";

/**
 * 默认通道工厂:经 rpc-channel 本地通道按 spawnSpec 起子进程。
 * 默认实现不消费 `opts`(会话标识对齐 / 元数据由装配层注入的 createChannel 处理)。
 */
function defaultCreateChannel(
  resolved: ResolvedSource,
  _opts?: CreateChannelOpts,
): SessionChannel {
  return new PiRpcProcess(resolved.spawnSpec) satisfies SessionChannel;
}

/** 返回上游 `SessionManager.shutdown` 供宿主在 SIGTERM 调用的便捷句柄。 */
export interface PiWebHandlerBundle {
  readonly handler: PiWebHandler;
  /** 透传上游优雅停机(注册点归宿主)。 */
  readonly shutdown: () => Promise<void>;
}

export function createPiWebHandler(opts: PiWebHandlerOptions): PiWebHandler {
  const { manager, store } = opts;
  const heartbeatMs = opts.sse?.heartbeatMs;
  const createChannel = opts.createChannel ?? defaultCreateChannel;

  // completion-provider-framework:注册表 + 内置 file provider + 追加 providers。
  const completion = createCompletionRegistry();
  completion.register(createFileProvider());
  // attachment-mention-completion:仅当注入的附件门面具备 listBySession 能力(能力探测)
  // 时,无 `as` 断言地重建 AttachmentLister 并注册附件补全 provider。head-only 门面
  // (仅供 messages handler)不在此注册。
  const attachmentStore = opts.attachmentStore;
  if (attachmentStore?.listBySession) {
    const lister: AttachmentLister = {
      head: (id) => attachmentStore.head(id),
      listBySession: (sessionId) => attachmentStore.listBySession!(sessionId),
    };
    completion.register(createAttachmentProvider(lister));
  }
  for (const p of opts.completionProviders ?? []) completion.register(p);

  const builtins: RouteSpec[] = [
    {
      method: "POST",
      path: "/sessions",
      handler: makeCreateSessionHandler({
        manager,
        ...(opts.resolver !== undefined ? { resolver: opts.resolver } : {}),
        createChannel,
        ...(opts.loadResumeMeta !== undefined
          ? { loadResumeMeta: opts.loadResumeMeta }
          : {}),
      }),
    },
    {
      method: "POST",
      path: "/sessions/:id/messages",
      handler: makeMessagesHandler(store, completion, opts.attachmentStore),
    },
    {
      method: "POST",
      path: "/sessions/:id/steer",
      handler: makeSteerHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/follow_up",
      handler: makeFollowUpHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/abort",
      handler: makeAbortHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/model",
      handler: makeModelHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/thinking",
      handler: makeThinkingHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/ui-response",
      handler: makeUiResponseHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/ui-rpc",
      handler: makeUiRpcHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/fork",
      handler: makeForkHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/state",
      handler: makeStateHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/stats",
      handler: makeStatsHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/messages",
      handler: makeMessagesQueryHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/commands",
      handler: makeCommandsHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/completion/triggers",
      handler: makeCompletionTriggersHandler(store, completion),
    },
    {
      method: "GET",
      path: "/sessions/:id/completion",
      handler: makeCompletionHandler(store, completion),
    },
    {
      method: "GET",
      path: "/sessions/:id/models",
      handler: makeModelsHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/fork-messages",
      handler: makeForkMessagesHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/stream",
      handler: makeStreamHandler(
        store,
        heartbeatMs,
      ),
    },
    {
      method: "DELETE",
      path: "/sessions/:id",
      handler: makeDeleteSessionHandler(store),
    },
  ];

  const router = new Router({
    store,
    builtins,
    ...(opts.routes !== undefined ? { injected: opts.routes } : {}),
    ...(opts.authResolver !== undefined
      ? { authResolver: opts.authResolver }
      : {}),
    ...(opts.authorizeSession !== undefined
      ? { authorizeSession: opts.authorizeSession }
      : {}),
    ...(opts.sse?.basePath !== undefined ? { basePath: opts.sse.basePath } : {}),
  });

  return async (req: Request): Promise<Response> => {
    try {
      return await router.route(req);
    } catch {
      // 未预期异常兜底:500,不泄露 env/凭据/堆栈(Req 9.3)。
      return errorResponse(500, "INTERNAL", "Internal server error.");
    }
  };
}

/** 同上,并附带透传的 `shutdown()`(供宿主 SIGTERM 注册)。 */
export function createPiWebHandlerBundle(
  opts: PiWebHandlerOptions,
): PiWebHandlerBundle {
  return {
    handler: createPiWebHandler(opts),
    shutdown: () => opts.manager.shutdown(),
  };
}

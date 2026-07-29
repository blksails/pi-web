/**
 * http-api — createPiWebHandler 工厂(Req 1.1/1.3/1.6/1.7/9.3/9.4)。
 *
 * 组装 `Router` + 注入 `opts`(manager/store/resolver/createChannel/auth 接缝/外部 routes/
 * sse 调参),返回标准 Web Fetch `(req: Request) => Promise<Response>`。把 `opts.routes`
 * 传给 `Router` 合并(内置优先,外部不可遮蔽);外层 try/catch 兜底→500(不泄敏感)。
 * 透传上游 `shutdown()` 供宿主 SIGTERM 调用;不 spawn(默认通道工厂经注入提供)、不解析、
 * 不持有会话状态。
 */
import { createLogger } from "@blksails/pi-web-logger";
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
  makeClearQueueHandler,
  makeFollowUpHandler,
  makeForkHandler,
  makeMessagesHandler,
  makeModelHandler,
  makeSteerHandler,
  makeThinkingHandler,
  makeUiResponseHandler,
  makeUiRpcHandler,
} from "./routes/command-routes.js";
import {
  makeAgentRouteInvokeHandler,
  makeAgentRoutesListHandler,
} from "./routes/agent-route-routes.js";
import { makeDeleteSessionHandler } from "./routes/delete-session.js";
import { makeStateWriteHandler } from "./routes/state-routes.js";
import {
  makeCommandsHandler,
  makeForkMessagesHandler,
  makeLogsHandler,
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
  createAgentSlashProvider,
  createCatalogProvider,
  type AttachmentLister,
} from "../completion/index.js";
import { createAttachmentCatalogRoutes } from "./routes/attachment-catalog-routes.js";
import { Router, type RouteSpec } from "./router.js";

// 命名空间 session:create —— 会话/通道创建与删除生命周期里程碑(server stderr,受主进程门控)。
const createLog = createLogger({ namespace: "session:create" });

/**
 * 默认通道工厂:经 rpc-channel 本地通道按 spawnSpec 起子进程。
 * 默认实现不消费 `opts`(会话标识对齐 / 元数据由装配层注入的 createChannel 处理)。
 */
function defaultCreateChannel(
  resolved: ResolvedSource,
  _opts?: CreateChannelOpts,
): SessionChannel {
  createLog.debug("channel created", { cmd: resolved.spawnSpec.cmd });
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
      // presignUrl 在场时透传,使图片附件候选带缩略图预览 URL(attachment-mention-preview)。
      ...(attachmentStore.presignUrl !== undefined
        ? { presignUrl: (id: string) => attachmentStore.presignUrl!(id) }
        : {}),
    };
    completion.register(createAttachmentProvider(lister));
  }
  // agent-slash-completion:通用命令补全 provider(trigger "/"),按会话读取 agent
  // 装配期声明的静态 slash 候选(per-agent gating)。
  completion.register(createAgentSlashProvider((id) => store.get(id)));
  // agent-attachment-catalog:仅当注入的附件门面具备 presignUrl 能力(能力探测,resolve
  // 兜底构造引用标记需要 head + presignUrl 都在场)时注册,与附件补全 provider 同门控风格。
  // 会话访问器直接复用 `store.get`(PiSession 实现 CatalogSource 结构契约:
  // attachmentCatalogAvailable/requestCatalog)。
  if (attachmentStore?.presignUrl !== undefined) {
    completion.register(
      createCatalogProvider((id) => store.get(id), {
        head: (id) => attachmentStore.head(id),
      }),
    );
  }
  for (const p of opts.completionProviders ?? []) completion.register(p);

  // agent-attachment-catalog:物化端点仅当附件门面具备 head+presignUrl 能力时挂载
  // (同上方 provider 注册门控;未注入附件门面的部署形态不挂此端点,访问路径 404)。
  const catalogRoutes: RouteSpec[] =
    attachmentStore?.presignUrl !== undefined
      ? createAttachmentCatalogRoutes(store, {
          head: (id) => attachmentStore.head(id),
          presignUrl: (id) => attachmentStore.presignUrl!(id),
        })
      : [];

  const builtins: RouteSpec[] = [
    ...catalogRoutes,
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
      path: "/sessions/:id/clear_queue",
      handler: makeClearQueueHandler(store),
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
      handler: makeUiRpcHandler(store, opts.hostCommands),
    },
    {
      method: "POST",
      path: "/sessions/:id/state",
      handler: makeStateWriteHandler(store),
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
      path: "/sessions/:id/logs",
      handler: makeLogsHandler(store),
    },
    // agent-declared-routes:builtin 注册即复用 Router `:id` 段既有会话 404/401/403
    // 鉴权门(Req 4.1,不自建鉴权)。调用端点对 GET/POST 挂同一 handler:route 级
    // 方法白名单在 handler 内检查(Router 对未注册方法只能给整路径 405,无法按
    // route 声明区分,Req 2.3);env 门控/超时/体上限均在 handler 内按请求读取。
    {
      method: "GET",
      path: "/sessions/:id/agent-routes",
      handler: makeAgentRoutesListHandler(store),
    },
    {
      method: "GET",
      path: "/sessions/:id/agent-routes/:name",
      handler: makeAgentRouteInvokeHandler(store),
    },
    {
      method: "POST",
      path: "/sessions/:id/agent-routes/:name",
      handler: makeAgentRouteInvokeHandler(store),
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
    } catch (err) {
      // 未预期异常兜底:500,响应不泄露 env/凭据/堆栈(Req 9.3)。
      // 但把根因打到**服务端 stderr**(不进响应),否则线上/CI 排障无从下手。
      console.error("[pi-web] 未处理的请求异常:", err);
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

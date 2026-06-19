/**
 * http-api — 处理器类型与注入面(不重定义上游契约)。
 *
 * 会话依赖类型(`SessionManager`/`SessionStore`)取自 `../session/`;鉴权接缝取自
 * `./auth.js`。本 spec 仅依赖 Web Fetch 标准 `Request`/`Response`(Req 1.6)。
 */
import type {
  SessionChannel,
  SessionManager,
  SessionStore,
} from "../session/index.js";
import type { ResolvedSource } from "../agent-source/index.js";
import type { AuthContext, AuthResolver, AuthorizeSession } from "./auth.js";
import type { AgentSourceResolverType } from "../agent-source/index.js";

/** 路由匹配后传给端点处理器的上下文。 */
export interface RequestContext {
  readonly req: Request;
  /** 由 `:id` 路径段提取(`:id` 端点存在)。 */
  readonly sessionId?: string;
  /** authResolver 结果(默认放行时为匿名上下文)。 */
  readonly auth: AuthContext;
  /** 已从路径解析的可用 URL(供查询参数等)。 */
  readonly url: URL;
}

/** 单端点处理器:接收 `RequestContext`,返回标准 Web `Response`。 */
export type RouteHandler = (ctx: RequestContext) => Promise<Response>;

/** 外部路由注入项(Req 1.7)。复用 `RouteHandler`/`RequestContext` 契约。 */
export interface InjectedRoute {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandler;
}

/**
 * createChannel 注入参数:会话标识 + 创建/恢复元数据。两模式均下传 `sessionId`
 * (--session-id),agent 端据其 open-or-create(对齐 pi CLI 语义)。
 */
export interface CreateChannelOpts {
  /** 主进程会话标识;agent 端 open(已存在)或以该 id create(不存在)。 */
  readonly sessionId: string;
  /** agent 源;custom 模式写入 piweb.session 元数据,cli 模式由 header.cwd 重建。 */
  readonly source: string | undefined;
  /** 可选模型 id。 */
  readonly model?: string;
}

/** 冷恢复元数据:由主进程从持久化存储按会话标识读出(权威 cwd 取自 header)。 */
export interface ResumeMeta {
  readonly source: string | undefined;
  readonly cwd: string;
  readonly model?: string;
}

/** SSE 调参(可选)。 */
export interface SseOptions {
  /** 心跳注释帧间隔(毫秒);默认值由实现给定。 */
  readonly heartbeatMs?: number;
  /** 可选路由前缀(如 `/api`)。 */
  readonly basePath?: string;
}

/** `createPiWebHandler(opts)` 的注入面(Req 1.3)。 */
export interface PiWebHandlerOptions {
  /** 来自 session-engine(已装配)。 */
  readonly manager: SessionManager;
  /** 会话检索(`:id` 端点用)。 */
  readonly store: SessionStore;
  /** agent 源解析器(`POST /sessions` 用);未提供时使用公共默认实现。 */
  readonly resolver?: AgentSourceResolverType;
  /**
   * 由已解析的源构造会话通道(`POST /sessions` 用)。http-api 本身不 spawn 子进程
   * (Req 1.3);通道工厂由宿主/装配层注入(默认实现经 rpc-channel 的本地通道按
   * `resolved.spawnSpec` 起子进程)。`opts` 携带会话标识与创建/恢复元数据,装配层
   * 据 `resolved.mode` 拼接下传参数(custom/cli)。
   */
  readonly createChannel?: (
    resolved: ResolvedSource,
    opts: CreateChannelOpts,
  ) => SessionChannel;
  /**
   * 冷会话恢复读取器(`POST /sessions { resumeId }` 用):按会话标识从持久化存储读取
   * 恢复元数据;未找到返回 undefined。未注入时恢复请求一律视为"会话不存在"。
   */
  readonly loadResumeMeta?: (id: string) => Promise<ResumeMeta | undefined>;
  /** 可选;未提供→默认放行(Req 8.3)。 */
  readonly authResolver?: AuthResolver;
  /** 可选;未提供→默认放行。 */
  readonly authorizeSession?: AuthorizeSession;
  /** 可选外部路由注入接缝(Req 1.7);内置路由对冲突优先。 */
  readonly routes?: ReadonlyArray<InjectedRoute>;
  /** 可选 SSE 调参与路由前缀。 */
  readonly sse?: SseOptions;
}

/** 框架无关的标准 Web Fetch 处理器签名(Req 1.1)。 */
export type PiWebHandler = (req: Request) => Promise<Response>;

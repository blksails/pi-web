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
import type { CompletionProvider } from "../completion/index.js";
import type { AttachmentMetaSource } from "./routes/command-routes.js";
import type { AttachmentStore } from "../attachment/index.js";
import type { HostCommandRegistry } from "../commands/host-command-registry.js";

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
  /**
   * 可选:纯扩展命令历史标记读取器(spec plugin-system-unification R13)。按会话标识返回该会话
   * 持久化的 `piweb.command` 标记(`{ text, ts }`,ts 为 epoch ms)。注入后 `GET /messages` 会把
   * 这些标记按时间序合并进消息序列,呈现为携带原始命令文本的用户气泡(使纯命令冷恢复仍可见)。
   * 未注入则历史行为不变(不合并)。仅影响 web 历史响应,不改写 agent message log。
   */
  readonly loadCommandMarkers?: (
    id: string,
  ) => Promise<ReadonlyArray<{ readonly text: string; readonly ts: number }>>;
  /** 可选;未提供→默认放行(Req 8.3)。 */
  readonly authResolver?: AuthResolver;
  /** 可选;未提供→默认放行。 */
  readonly authorizeSession?: AuthorizeSession;
  /** 可选外部路由注入接缝(Req 1.7);内置路由对冲突优先。 */
  readonly routes?: ReadonlyArray<InjectedRoute>;
  /** 可选 SSE 调参与路由前缀。 */
  readonly sse?: SseOptions;
  /**
   * 可选:除内置 file provider 外追加的补全 provider(completion-provider-framework)。
   * 仅经注册即在通用补全端点与前端浮层生效(零端点/协议改动)。
   */
  readonly completionProviders?: readonly CompletionProvider[];
  /**
   * 可选:主进程附件存储门面(注入既有 `AttachmentStore`)。现由两个消费者共用,
   * 各自只依赖自身所需的最小能力:
   * - messages handler(attachment-tool-bridge):仅用只读 `head(id)`,使
   *   `POST /sessions/:id/messages` 据前端提交的 `attachmentIds` 把已落库附件以结构化
   *   文本引用注入用户消息文本(Req 8.1/9.1)。head-only 门面即可满足该消费者。
   * - attachment completion provider(attachment-mention-completion):需 `listBySession`
   *   按会话列出附件供 `@` 引用补全(Req 2.x)。
   * 故契约在 `AttachmentMetaSource`(head,messages handler 窄契约不变)之上,以
   * `Partial<Pick<AttachmentStore, "listBySession">>` 追加「可选第二能力」:listBySession
   * 在场(能力探测命中)时 create-handler 才重建 `AttachmentLister` 并注册附件补全 provider;
   * head-only 注入(仅满足 messages handler)仍合法,不注册补全。
   * 未注入时不做引用注入,也不注册附件补全 provider(与 `images`/vision 现状无关,互不影响)。
   */
  readonly attachmentStore?: AttachmentMetaSource &
    Partial<Pick<AttachmentStore, "listBySession">>;
  /**
   * 可选:host 命令注册表(unified-command-result-layer,决策 A)。注入后,ui-rpc
   * `point="command"` 且命令名已注册的请求在**服务端**执行(不转 agent),结果经
   * `control:"ui-rpc"` 回流;未注册命令/其它 point 仍转发 agent(向后兼容)。
   */
  readonly hostCommands?: HostCommandRegistry;
}

/** 框架无关的标准 Web Fetch 处理器签名(Req 1.1)。 */
export type PiWebHandler = (req: Request) => Promise<Response>;

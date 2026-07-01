/**
 * createPiClient(baseUrl, fetch?) — 封装 http-api 全部 REST 调用。
 *
 * 端点路径与 DTO 形状取自 @blksails/pi-web-protocol(rest-dto)与 http-api 约定,不重定义。
 * 非 2xx → PiHttpError;protocolVersion 不兼容 → PiProtocolVersionError(均经 request 层归一)。
 *
 * 仅依赖标准 Web Fetch;fetch 可注入(默认全局 fetch)。
 */
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  PromptRequest,
  SteerRequest,
  SetModelRequest,
  SetThinkingRequest,
  UiResponseRequest,
  GetStateResponse,
  GetStatsResponse,
  GetMessagesResponse,
  GetCommandsResponse,
  CommandAck,
  ClearQueueResponse,
  GetAvailableModelsResponse,
  ForkRequest,
  ForkResponse,
  GetForkMessagesResponse,
  UiRpcRequest,
  UiRpcResponse,
  CompletionResponse,
  CompletionTriggersResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ListAgentSourcesRequest,
  ListAgentSourcesResponse,
  ListFavoritesResponse,
  SetFavoritesRequest,
  ListSessionFavoritesResponse,
  SetSessionFavoritesRequest,
  RenameSessionResponse,
  GetLogsResponse,
  LogLevel,
  StateSetRequest,
  StateSetResponse,
  BashResult,
} from "@blksails/pi-web-protocol";
import {
  GetAvailableModelsResponseSchema,
  ForkResponseSchema,
  GetForkMessagesResponseSchema,
  ListSessionsResponseSchema,
  ListAgentSourcesResponseSchema,
  ListFavoritesResponseSchema,
  ListSessionFavoritesResponseSchema,
  RenameSessionResponseSchema,
  GetLogsResponseSchema,
} from "@blksails/pi-web-protocol";
import type { LogEntry } from "@blksails/pi-web-logger";
import { sendRequest, type FetchLike } from "./request.js";

export type { FetchLike };

/** http-api REST 客户端面。形状与端点均取自 @blksails/pi-web-protocol + http-api 约定。 */
/** 已安装扩展/plugin 信息(builtin-plugin-command;形状对齐服务端 InstalledExtension)。 */
export interface InstalledExtensionInfo {
  readonly id: string;
  readonly kind: string;
  readonly scope: string;
  readonly version?: string;
}
export interface ListExtensionsResponse {
  readonly extensions: readonly InstalledExtensionInfo[];
}
export interface InstallExtensionResult {
  readonly ok: true;
  readonly source: string;
}

export interface PiClient {
  readonly baseUrl: string;

  createSession(req: CreateSessionRequest): Promise<CreateSessionResponse>;
  /**
   * GET /sessions —— 列出会话(sessions-list)。`scope=cwd`(默认,当前目录)| `all`
   * (系统/全机器,受部署门控)。响应经 ListSessionsResponseSchema 解析;空结果返回空数组。
   */
  listSessions(req: ListSessionsRequest): Promise<ListSessionsResponse>;
  /**
   * GET /agent-sources —— 只读枚举可用的 agent source(agent-sources-list),来源为
   * 「目录扫描 ∪ 注册表文件」两路合并去重。响应经 ListAgentSourcesResponseSchema 解析;
   * 无来源返回空数组。选中项的 `source` 可直接交给会话创建链路(等价手输)。
   */
  listAgentSources(
    req: ListAgentSourcesRequest,
  ): Promise<ListAgentSourcesResponse>;
  /**
   * GET /agent-sources/favorites —— 列出收藏的 agent source(sidebar-launcher-rail)。
   * 收藏是用户偏好,独立于只读源枚举。
   */
  listFavorites(): Promise<ListFavoritesResponse>;
  /**
   * PUT /agent-sources/favorites —— 全量替换收藏集合,返回落盘后的最新集合。
   */
  setFavorites(req: SetFavoritesRequest): Promise<ListFavoritesResponse>;

  /**
   * POST /sessions/delete —— 物理删除历史会话(session-list-item-actions)。
   * 与 `deleteSession`(DELETE /sessions/:id,仅停内存会话)语义不同:本方法删除持久化
   * 存储中的整会话且幂等(目标不存在亦成功)。
   */
  deleteSessionHistory(sessionId: string): Promise<CommandAck>;
  /**
   * POST /sessions/rename —— 重命名历史会话,返回落库后的最新显示名(已 trim)。
   */
  renameSession(sessionId: string, name: string): Promise<RenameSessionResponse>;
  /**
   * GET /sessions/favorites —— 列出收藏的会话标识集合(按 sessionId,独立于 agent 源收藏)。
   */
  listSessionFavorites(): Promise<ListSessionFavoritesResponse>;
  /**
   * POST /sessions/favorites —— 全量替换会话收藏集合,返回落盘后的最新集合。
   */
  setSessionFavorites(
    req: SetSessionFavoritesRequest,
  ): Promise<ListSessionFavoritesResponse>;
  prompt(id: string, req: PromptRequest): Promise<CommandAck>;
  steer(id: string, req: SteerRequest): Promise<CommandAck>;
  /** follow_up 端点;请求体形状同 SteerRequest(见 protocol rest-dto)。 */
  followUp(id: string, req: SteerRequest): Promise<CommandAck>;
  abort(id: string): Promise<CommandAck>;
  /** POST /sessions/:id/clear_queue —— 清空排队消息,返回被清 steering/followUp 文本(取回)。 */
  clearQueue(id: string): Promise<ClearQueueResponse>;
  setModel(id: string, req: SetModelRequest): Promise<CommandAck>;
  setThinking(id: string, req: SetThinkingRequest): Promise<CommandAck>;
  uiResponse(id: string, req: UiResponseRequest): Promise<CommandAck>;
  /** POST /sessions/:id/ui-rpc —— Tier3 贡献点上行(仅 ack;响应经 SSE control:ui-rpc 回流)。 */
  uiRpc(id: string, req: UiRpcRequest): Promise<CommandAck>;
  /**
   * POST /sessions/:id/ui-rpc(host 命令)—— 统一命令层:host 命令服务端**同步**执行,
   * 结果直接在响应体返回(UiRpcResponse 形状),不依赖 SSE 控制流。
   */
  uiRpcCommand(id: string, req: UiRpcRequest): Promise<UiRpcResponse>;

  /** POST /sessions/:id/state —— 状态注入桥写回(set/delete);同步 ack。 */
  setState(id: string, req: StateSetRequest): Promise<StateSetResponse>;

  /**
   * POST /sessions/:id/bash —— bang shell 命令(spec bang-shell-command)。
   * 同步返回结构化 `BashResult`;端点禁用(404)或失败(非 2xx)→ 抛错(供上层给可见反馈)。
   * 不经 useChat,不进 LLM 消息流;`excludeFromContext` 对应 `!!`(输出不进上下文)。
   */
  bash(
    id: string,
    req: { command: string; excludeFromContext?: boolean },
  ): Promise<BashResult>;

  getState(id: string): Promise<GetStateResponse>;
  getStats(id: string): Promise<GetStatsResponse>;
  getMessages(id: string): Promise<GetMessagesResponse>;
  getCommands(id: string): Promise<GetCommandsResponse>;

  /** GET /extensions —— 已安装扩展/plugin 列表(builtin-plugin-command)。 */
  listExtensions(): Promise<ListExtensionsResponse>;
  /** POST /extensions —— 以来源安装 plugin。 */
  installExtension(source: string): Promise<InstallExtensionResult>;
  /** DELETE /extensions/:extId —— 卸载 plugin。 */
  removeExtension(extId: string): Promise<unknown>;
  /** POST /sessions/:id/reload —— 装/卸后重载会话 runner 使其生效。 */
  reloadSession(id: string): Promise<unknown>;

  /** GET /sessions/:id/completion/triggers —— 活跃触发符并集(completion-provider-framework)。 */
  getCompletionTriggers(id: string): Promise<CompletionTriggersResponse>;
  /** GET /sessions/:id/completion?trigger=&q= —— 触发符补全候选。 */
  getCompletion(
    id: string,
    trigger: string,
    query: string,
  ): Promise<CompletionResponse>;

  /**
   * GET /sessions/:id/models —— 拉取可用模型列表(对齐 RpcCommand get_available_models)。
   * 响应经 GetAvailableModelsResponseSchema 解析;端点缺失(404)→ PiHttpError(status===404),
   * 供上层(useModels)识别并降级隐藏模型选择器(Req 4.4)。
   */
  getAvailableModels(id: string): Promise<GetAvailableModelsResponse>;
  /**
   * POST /sessions/:id/fork —— 创建同级版本(对齐 RpcCommand fork)。
   * 响应经 ForkResponseSchema 解析;端点缺失(404)→ PiHttpError(status===404),供上层降级(Req 8.4)。
   */
  fork(id: string, req: ForkRequest): Promise<ForkResponse>;
  /**
   * GET /sessions/:id/fork-messages —— 加载分支消息序列(对齐 RpcCommand get_fork_messages)。
   * 响应经 GetForkMessagesResponseSchema 解析;端点缺失(404)→ PiHttpError(status===404),供上层降级(Req 8.4)。
   */
  getForkMessages(id: string): Promise<GetForkMessagesResponse>;

  deleteSession(id: string): Promise<CommandAck>;

  /**
   * GET /sessions/:id/logs?level=&limit=&since= —— 拉取历史日志条目(Req 4.2)。
   * 响应经 GetLogsResponseSchema 解析;返回 entries 数组。
   * 查询参数均可选:level 最低级别、limit 最大条数、since 起始 epoch ms。
   */
  getLogs(
    sessionId: string,
    query?: { level?: LogLevel; limit?: number; since?: number },
  ): Promise<LogEntry[]>;
}

const enc = encodeURIComponent;

/**
 * 创建一个绑定到 baseUrl 的 PiClient。
 * Where 提供 fetchImpl,则用之而非全局 fetch。
 */
export function createPiClient(
  baseUrl: string,
  fetchImpl?: FetchLike,
): PiClient {
  const f: FetchLike = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const post = <T>(path: string, body?: unknown): Promise<T> =>
    sendRequest<T>(baseUrl, f, { method: "POST", path, body });
  const get = <T>(path: string): Promise<T> =>
    sendRequest<T>(baseUrl, f, { method: "GET", path });
  const del = <T>(path: string): Promise<T> =>
    sendRequest<T>(baseUrl, f, { method: "DELETE", path });
  const put = <T>(path: string, body?: unknown): Promise<T> =>
    sendRequest<T>(baseUrl, f, { method: "PUT", path, body });

  return {
    baseUrl,

    createSession: (req) =>
      post<CreateSessionResponse>("/sessions", req),
    listSessions: async (req) => {
      const p = new URLSearchParams();
      if (req.scope !== undefined) p.set("scope", req.scope);
      if (req.cwd !== undefined) p.set("cwd", req.cwd);
      if (req.sessionId !== undefined) p.set("sessionId", req.sessionId);
      if (req.limit !== undefined) p.set("limit", String(req.limit));
      if (req.cursor !== undefined) p.set("cursor", req.cursor);
      if (req.q !== undefined) p.set("q", req.q);
      const qs = p.toString();
      return ListSessionsResponseSchema.parse(
        await get<unknown>(`/sessions${qs.length > 0 ? `?${qs}` : ""}`),
      );
    },
    listAgentSources: async (req) => {
      const p = new URLSearchParams();
      if (req.limit !== undefined) p.set("limit", String(req.limit));
      if (req.cursor !== undefined) p.set("cursor", req.cursor);
      const qs = p.toString();
      return ListAgentSourcesResponseSchema.parse(
        await get<unknown>(`/agent-sources${qs.length > 0 ? `?${qs}` : ""}`),
      );
    },
    listFavorites: async () =>
      ListFavoritesResponseSchema.parse(
        await get<unknown>("/agent-sources/favorites"),
      ),
    setFavorites: async (req) =>
      ListFavoritesResponseSchema.parse(
        await put<unknown>("/agent-sources/favorites", req),
      ),
    deleteSessionHistory: (sessionId) =>
      post<CommandAck>("/sessions/delete", { sessionId }),
    renameSession: async (sessionId, name) =>
      RenameSessionResponseSchema.parse(
        await post<unknown>("/sessions/rename", { sessionId, name }),
      ),
    listSessionFavorites: async () =>
      ListSessionFavoritesResponseSchema.parse(
        await get<unknown>("/sessions/favorites"),
      ),
    setSessionFavorites: async (req) =>
      ListSessionFavoritesResponseSchema.parse(
        await post<unknown>("/sessions/favorites", req),
      ),
    prompt: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/messages`, req),
    steer: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/steer`, req),
    followUp: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/follow_up`, req),
    abort: (id) =>
      post<CommandAck>(`/sessions/${enc(id)}/abort`),
    clearQueue: (id) =>
      post<ClearQueueResponse>(`/sessions/${enc(id)}/clear_queue`),
    setModel: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/model`, req),
    setThinking: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/thinking`, req),
    uiResponse: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/ui-response`, req),
    uiRpc: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/ui-rpc`, req),
    uiRpcCommand: (id, req) =>
      post<UiRpcResponse>(`/sessions/${enc(id)}/ui-rpc`, req),
    bash: (id, req) =>
      post<{ result: BashResult }>(`/sessions/${enc(id)}/bash`, req).then(
        (r) => r.result,
      ),

    setState: (id, req) =>
      post<StateSetResponse>(`/sessions/${enc(id)}/state`, req),

    getState: (id) => get<GetStateResponse>(`/sessions/${enc(id)}/state`),
    getStats: (id) => get<GetStatsResponse>(`/sessions/${enc(id)}/stats`),
    getMessages: (id) =>
      get<GetMessagesResponse>(`/sessions/${enc(id)}/messages`),
    getCommands: (id) =>
      get<GetCommandsResponse>(`/sessions/${enc(id)}/commands`),

    // 扩展安装管理(builtin-plugin-command):打既有 /extensions 与 /sessions/:id/reload。
    listExtensions: () => get<ListExtensionsResponse>(`/extensions`),
    installExtension: (source) =>
      post<InstallExtensionResult>(`/extensions`, { source }),
    removeExtension: (extId) => del<unknown>(`/extensions/${enc(extId)}`),
    reloadSession: (id) => post<unknown>(`/sessions/${enc(id)}/reload`, {}),
    getCompletionTriggers: (id) =>
      get<CompletionTriggersResponse>(
        `/sessions/${enc(id)}/completion/triggers`,
      ),
    getCompletion: (id, trigger, query) =>
      get<CompletionResponse>(
        `/sessions/${enc(id)}/completion?trigger=${encodeURIComponent(trigger)}&q=${encodeURIComponent(query)}`,
      ),

    getAvailableModels: async (id) =>
      GetAvailableModelsResponseSchema.parse(
        await get<unknown>(`/sessions/${enc(id)}/models`),
      ),
    fork: async (id, req) =>
      ForkResponseSchema.parse(
        await post<unknown>(`/sessions/${enc(id)}/fork`, req),
      ),
    getForkMessages: async (id) =>
      GetForkMessagesResponseSchema.parse(
        await get<unknown>(`/sessions/${enc(id)}/fork-messages`),
      ),

    deleteSession: (id) =>
      sendRequest<CommandAck>(baseUrl, f, {
        method: "DELETE",
        path: `/sessions/${enc(id)}`,
      }),

    getLogs: async (sessionId, query?) => {
      const params = new URLSearchParams();
      if (query?.level !== undefined) params.set("level", query.level);
      if (query?.limit !== undefined) params.set("limit", String(query.limit));
      if (query?.since !== undefined) params.set("since", String(query.since));
      const qs = params.toString();
      const path = `/sessions/${enc(sessionId)}/logs${qs !== "" ? `?${qs}` : ""}`;
      const raw = await get<GetLogsResponse>(path);
      const parsed = GetLogsResponseSchema.parse(raw);
      return parsed.entries as LogEntry[];
    },
  };
}

/**
 * createPiClient(baseUrl, fetch?) — 封装 http-api 全部 REST 调用。
 *
 * 端点路径与 DTO 形状取自 @pi-web/protocol(rest-dto)与 http-api 约定,不重定义。
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
  GetAvailableModelsResponse,
  ForkRequest,
  ForkResponse,
  GetForkMessagesResponse,
  UiRpcRequest,
  CompletionResponse,
  CompletionTriggersResponse,
} from "@pi-web/protocol";
import {
  GetAvailableModelsResponseSchema,
  ForkResponseSchema,
  GetForkMessagesResponseSchema,
} from "@pi-web/protocol";
import { sendRequest, type FetchLike } from "./request.js";

export type { FetchLike };

/** http-api REST 客户端面。形状与端点均取自 @pi-web/protocol + http-api 约定。 */
export interface PiClient {
  readonly baseUrl: string;

  createSession(req: CreateSessionRequest): Promise<CreateSessionResponse>;
  prompt(id: string, req: PromptRequest): Promise<CommandAck>;
  steer(id: string, req: SteerRequest): Promise<CommandAck>;
  /** follow_up 端点;请求体形状同 SteerRequest(见 protocol rest-dto)。 */
  followUp(id: string, req: SteerRequest): Promise<CommandAck>;
  abort(id: string): Promise<CommandAck>;
  setModel(id: string, req: SetModelRequest): Promise<CommandAck>;
  setThinking(id: string, req: SetThinkingRequest): Promise<CommandAck>;
  uiResponse(id: string, req: UiResponseRequest): Promise<CommandAck>;
  /** POST /sessions/:id/ui-rpc —— Tier3 贡献点上行(仅 ack;响应经 SSE control:ui-rpc 回流)。 */
  uiRpc(id: string, req: UiRpcRequest): Promise<CommandAck>;

  getState(id: string): Promise<GetStateResponse>;
  getStats(id: string): Promise<GetStatsResponse>;
  getMessages(id: string): Promise<GetMessagesResponse>;
  getCommands(id: string): Promise<GetCommandsResponse>;

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

  return {
    baseUrl,

    createSession: (req) =>
      post<CreateSessionResponse>("/sessions", req),
    prompt: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/messages`, req),
    steer: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/steer`, req),
    followUp: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/follow_up`, req),
    abort: (id) =>
      post<CommandAck>(`/sessions/${enc(id)}/abort`),
    setModel: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/model`, req),
    setThinking: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/thinking`, req),
    uiResponse: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/ui-response`, req),
    uiRpc: (id, req) =>
      post<CommandAck>(`/sessions/${enc(id)}/ui-rpc`, req),

    getState: (id) => get<GetStateResponse>(`/sessions/${enc(id)}/state`),
    getStats: (id) => get<GetStatsResponse>(`/sessions/${enc(id)}/stats`),
    getMessages: (id) =>
      get<GetMessagesResponse>(`/sessions/${enc(id)}/messages`),
    getCommands: (id) =>
      get<GetCommandsResponse>(`/sessions/${enc(id)}/commands`),
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
  };
}

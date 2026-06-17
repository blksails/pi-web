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

  getState(id: string): Promise<GetStateResponse>;
  getStats(id: string): Promise<GetStatsResponse>;
  getMessages(id: string): Promise<GetMessagesResponse>;
  getCommands(id: string): Promise<GetCommandsResponse>;

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

    getState: (id) => get<GetStateResponse>(`/sessions/${enc(id)}/state`),
    getStats: (id) => get<GetStatsResponse>(`/sessions/${enc(id)}/stats`),
    getMessages: (id) =>
      get<GetMessagesResponse>(`/sessions/${enc(id)}/messages`),
    getCommands: (id) =>
      get<GetCommandsResponse>(`/sessions/${enc(id)}/commands`),

    deleteSession: (id) =>
      sendRequest<CommandAck>(baseUrl, f, {
        method: "DELETE",
        path: `/sessions/${enc(id)}`,
      }),
  };
}

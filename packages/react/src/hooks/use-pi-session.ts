/**
 * usePiSession — 会话生命周期与连接状态。
 *
 * 经 client.createSession 建会话(暴露 sessionId);装配 PiSessionConnection + PiTransport
 * 并暴露 transport(传给 useChat);暴露连接态 status;卸载/显式 close 释放订阅;
 * 失败暴露 error(不抛未捕获)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { CreateSessionRequest } from "@blksails/pi-web-protocol";
import {
  createPiClient,
  type PiClient,
  type FetchLike,
} from "../client/pi-client.js";
import { PiSessionConnection } from "../sse/connection.js";
import { PiTransport } from "../transport/pi-transport.js";
import { agentMessagesToUiMessages } from "../transport/agent-message-to-ui.js";
import { PiHttpError, PiProtocolVersionError } from "../client/errors.js";
import { usePiContext } from "../provider/pi-provider.js";

export type PiSessionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "ended";

export interface UsePiSessionOptions {
  /** 建会话参数(source 必填)。 */
  readonly create: CreateSessionRequest;
  /** http-api 根地址;Provider 注入时可省。 */
  readonly baseUrl?: string;
  /** 注入 fetch。 */
  readonly fetch?: FetchLike;
  /** 显式注入 client(覆盖 baseUrl/fetch)。 */
  readonly client?: PiClient;
  /** SSE 订阅附加 headers(如 Authorization)。 */
  readonly headers?: Record<string, string> | Headers;
  /** 是否在挂载时自动建会话(默认 true)。 */
  readonly autoStart?: boolean;
  /**
   * 恢复模式:提供已有会话标识则恢复该会话(冷恢复并续聊)而非新建;同时拉取历史消息
   * 经 transport 装配前暴露为 {@link UsePiSessionResult.initialMessages}。
   */
  readonly resumeId?: string;
  /** 会话标识就绪回调(用于将浏览器地址同步为 /session/:id)。 */
  readonly onSessionId?: (id: string) => void;
}

export interface UsePiSessionResult {
  readonly sessionId: string | undefined;
  readonly status: PiSessionStatus;
  readonly transport: PiTransport | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client: PiClient | undefined;
  readonly error: PiHttpError | PiProtocolVersionError | Error | undefined;
  /** 恢复模式下的历史初始消息(供 useChat 初始化渲染);新建会话时为 undefined。 */
  readonly initialMessages?: UIMessage[];
  readonly start: () => void;
  readonly close: () => void;
}

export function usePiSession(opts: UsePiSessionOptions): UsePiSessionResult {
  const ctx = usePiContext();
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<PiSessionStatus>("idle");
  const [error, setError] = useState<
    PiHttpError | PiProtocolVersionError | Error | undefined
  >(undefined);
  const [transport, setTransport] = useState<PiTransport | undefined>(
    undefined,
  );
  const [initialMessages, setInitialMessages] = useState<
    UIMessage[] | undefined
  >(undefined);

  const connectionRef = useRef<PiSessionConnection | undefined>(undefined);
  const clientRef = useRef<PiClient | undefined>(undefined);
  const startedRef = useRef(false);

  // 解析 client(显式 > context > 由 baseUrl 构造)。
  const resolveClient = useCallback((): PiClient => {
    if (opts.client !== undefined) return opts.client;
    if (ctx !== null && opts.baseUrl === undefined) return ctx.client;
    const baseUrl = opts.baseUrl ?? ctx?.baseUrl;
    if (baseUrl === undefined) {
      throw new Error(
        "usePiSession: baseUrl is required (provide opts.baseUrl, opts.client, or PiProvider)",
      );
    }
    return createPiClient(baseUrl, opts.fetch ?? ctx?.fetchImpl);
  }, [opts.client, opts.baseUrl, opts.fetch, ctx]);

  const close = useCallback(() => {
    connectionRef.current?.close();
    setStatus((s) => (s === "ended" ? "ended" : "closed"));
  }, []);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus("connecting");
    setError(undefined);

    let cancelled = false;
    void (async () => {
      try {
        const client = resolveClient();
        clientRef.current = client;
        const createReq =
          opts.resumeId !== undefined
            ? { ...opts.create, resumeId: opts.resumeId }
            : opts.create;
        const res = await client.createSession(createReq);
        if (cancelled) return;
        const id = res.sessionId;
        setSessionId(id);
        opts.onSessionId?.(id);

        // 恢复模式:在装配 transport 之前拉取历史并转换为初始消息,确保 PiChat 首次
        // 挂载(transport 就绪)时即带历史;失败不阻断续聊连接。
        if (opts.resumeId !== undefined) {
          try {
            const history = await client.getMessages(id);
            if (cancelled) return;
            // 历史项的根相对分发 URL(/attachments/:id/raw)需经 client.baseUrl(如 /api)
            // 前缀为可达 URL,否则 Next 根相对会 404(与 useAttachments.resolveDisplayUrl 同策略)。
            setInitialMessages(
              agentMessagesToUiMessages(history.messages, {
                baseUrl: client.baseUrl,
              }),
            );
          } catch {
            // 历史拉取失败:仍以空历史继续连接。
          }
        }

        const baseUrl = client.baseUrl;
        const connection = new PiSessionConnection({
          baseUrl,
          sessionId: id,
          fetchImpl: opts.fetch ?? ctx?.fetchImpl,
          ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
        });
        connectionRef.current = connection;

        const t = new PiTransport({ sessionId: id, client, connection });
        setTransport(t);
        setStatus("open");
      } catch (err) {
        if (cancelled) return;
        startedRef.current = false;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("closed");
      }
    })();

    // 注:start 的取消由组件卸载 effect 统一处理。
    void cancelled;
  }, [
    resolveClient,
    opts.create,
    opts.fetch,
    opts.headers,
    opts.resumeId,
    opts.onSessionId,
    ctx,
  ]);

  useEffect(() => {
    if (opts.autoStart !== false) start();
    return () => {
      connectionRef.current?.close();
    };
    // 仅挂载时启动一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessionId,
    status,
    transport,
    connection: connectionRef.current,
    client: clientRef.current,
    error,
    initialMessages,
    start,
    close,
  };
}

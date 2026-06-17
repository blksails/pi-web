/**
 * usePiSession — 会话生命周期与连接状态。
 *
 * 经 client.createSession 建会话(暴露 sessionId);装配 PiSessionConnection + PiTransport
 * 并暴露 transport(传给 useChat);暴露连接态 status;卸载/显式 close 释放订阅;
 * 失败暴露 error(不抛未捕获)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateSessionRequest } from "@pi-web/protocol";
import {
  createPiClient,
  type PiClient,
  type FetchLike,
} from "../client/pi-client.js";
import { PiSessionConnection } from "../sse/connection.js";
import { PiTransport } from "../transport/pi-transport.js";
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
}

export interface UsePiSessionResult {
  readonly sessionId: string | undefined;
  readonly status: PiSessionStatus;
  readonly transport: PiTransport | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client: PiClient | undefined;
  readonly error: PiHttpError | PiProtocolVersionError | Error | undefined;
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
        const res = await client.createSession(opts.create);
        if (cancelled) return;
        const id = res.sessionId;
        setSessionId(id);

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
  }, [resolveClient, opts.create, opts.fetch, opts.headers, ctx]);

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
    start,
    close,
  };
}

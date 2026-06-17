/**
 * useExtensionUI — 扩展 UI 请求队列与回传。
 *
 * 订阅 ControlStore.extensionUiQueue 暴露待处理项(FIFO);respond 经 client.uiResponse 回传,
 * 成功后出队;失败保留该项并暴露 error 允许重试。扩展 UI 不入 useChat 消息流(旁路队列)。
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type {
  RpcExtensionUIRequest,
  UiResponseRequest,
} from "@pi-web/protocol";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";

export interface UseExtensionUIOptions {
  readonly sessionId: string | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client?: PiClient;
  readonly baseUrl?: string;
}

export interface UseExtensionUIResult {
  readonly queue: readonly RpcExtensionUIRequest[];
  readonly current: RpcExtensionUIRequest | undefined;
  respond(requestId: string, response: UiResponseRequest): Promise<void>;
  readonly error: unknown;
  readonly pending: boolean;
}

const EMPTY: readonly RpcExtensionUIRequest[] = [];
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

export function useExtensionUI(
  opts: UseExtensionUIOptions,
): UseExtensionUIResult {
  const ctx = usePiContext();
  const client = useMemo<PiClient | undefined>(() => {
    if (opts.client !== undefined) return opts.client;
    if (ctx !== null && opts.baseUrl === undefined) return ctx.client;
    const baseUrl = opts.baseUrl ?? ctx?.baseUrl;
    if (baseUrl === undefined) return undefined;
    return createPiClient(baseUrl, ctx?.fetchImpl);
  }, [opts.client, opts.baseUrl, ctx]);

  const connection = opts.connection;
  const snapshot = useSyncExternalStore(
    connection?.controlStore.subscribe ?? NO_SUBSCRIBE,
    connection?.controlStore.getSnapshot ??
      ((): undefined => undefined),
    connection?.controlStore.getSnapshot ??
      ((): undefined => undefined),
  );
  const queue = snapshot?.extensionUiQueue ?? EMPTY;

  const [error, setError] = useState<unknown>(undefined);
  const [pending, setPending] = useState(false);

  const respond = useCallback(
    async (requestId: string, response: UiResponseRequest): Promise<void> => {
      if (client === undefined)
        throw new Error("useExtensionUI: client unavailable");
      if (opts.sessionId === undefined)
        throw new Error("useExtensionUI: sessionId unavailable");
      setPending(true);
      setError(undefined);
      try {
        await client.uiResponse(opts.sessionId, response);
        // 成功才出队(失败保留项允许重试)。
        connection?.controlStore.dequeueExtensionUi(requestId);
        setPending(false);
      } catch (err) {
        setError(err);
        setPending(false);
        throw err;
      }
    },
    [client, opts.sessionId, connection],
  );

  return {
    queue,
    current: queue[0],
    respond,
    error,
    pending,
  };
}

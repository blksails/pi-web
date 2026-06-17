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
import type {
  EditorTextSignal,
  ExtensionNotification,
  ExtensionWidget,
} from "../sse/control-store.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";

export interface UseExtensionUIOptions {
  readonly sessionId: string | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client?: PiClient;
  readonly baseUrl?: string;
}

export interface UseExtensionUIResult {
  // 既有(交互类,不变):
  readonly queue: readonly RpcExtensionUIRequest[];
  readonly current: RpcExtensionUIRequest | undefined;
  respond(requestId: string, response: UiResponseRequest): Promise<void>;
  readonly error: unknown;
  readonly pending: boolean;
  // 新增(推送类 ambient,只读 + 一个本地操作):
  readonly notifications: readonly ExtensionNotification[];
  readonly statuses: Readonly<Record<string, string>>;
  readonly widgets: Readonly<Record<string, ExtensionWidget>>;
  readonly title: string | undefined;
  readonly editorText: EditorTextSignal | undefined;
  dismissNotification(id: string): void;
}

const EMPTY: readonly RpcExtensionUIRequest[] = [];
// 无连接 / 无快照时的稳定回落引用(每渲染不换引用,避免下游误判变更)。
const EMPTY_NOTIFICATIONS: readonly ExtensionNotification[] = [];
const EMPTY_STATUSES: Readonly<Record<string, string>> = {};
const EMPTY_WIDGETS: Readonly<Record<string, ExtensionWidget>> = {};
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
  // 从快照读出 ambient 切片(纯增字段,向后兼容);快照缺失时安全回落为稳定空常量 / undefined。
  const ambient = snapshot?.ambient;
  const notifications = ambient?.notifications ?? EMPTY_NOTIFICATIONS;
  const statuses = ambient?.statuses ?? EMPTY_STATUSES;
  const widgets = ambient?.widgets ?? EMPTY_WIDGETS;
  const title = ambient?.title;
  const editorText = ambient?.editorText;

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

  // 委托 store 移除通知;无连接时 no-op。
  const dismissNotification = useCallback(
    (id: string): void => {
      connection?.controlStore.dismissNotification(id);
    },
    [connection],
  );

  return {
    queue,
    current: queue[0],
    respond,
    error,
    pending,
    notifications,
    statuses,
    widgets,
    title,
    editorText,
    dismissNotification,
  };
}

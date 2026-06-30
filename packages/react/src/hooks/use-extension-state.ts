/**
 * useExtensionState — 状态注入桥(state-injection-bridge)前端订阅/写回 hook。
 *
 * 订阅 ControlStore.states 切片的某个 key,返回 `[value, setValue]`:
 *  - 读:`useSyncExternalStore` 订阅,下行 `control:"state"` 帧到达即一致重渲染。
 *  - 写:`setValue` 经 `client.setState` → `POST /sessions/:id/state` 写回(同步 ack),
 *    权威态在子进程更新后经下行帧收敛(本地不乐观写,避免与权威 rev 冲突)。
 *
 * 风格对齐 useExtensionUI:经 usePiContext 取 client/baseUrl,经 connection.controlStore 订阅。
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { PiClient } from "../client/pi-client.js";
import type { PiSessionConnection } from "../sse/connection.js";
import { usePiContext } from "../provider/pi-provider.js";
import { createPiClient } from "../client/pi-client.js";

export interface UseExtensionStateOptions {
  readonly sessionId: string | undefined;
  readonly connection: PiSessionConnection | undefined;
  readonly client?: PiClient;
  readonly baseUrl?: string;
}

export interface UseExtensionStateResult<T> {
  /** 当前值(未初始化为 undefined)。 */
  readonly value: T | undefined;
  /** 写入新值(经写回端点;不可用时抛)。 */
  setValue(value: T): Promise<void>;
  /** 删除该 key。 */
  remove(): Promise<void>;
  readonly error: unknown;
  readonly pending: boolean;
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * 订阅并写回单个共享状态 key。
 *
 * @returns `[value, setValue]` 二元组(并在第三位附带 `result` 细节,见重载)。
 */
export function useExtensionState<T = unknown>(
  key: string,
  opts: UseExtensionStateOptions,
): readonly [T | undefined, (value: T) => Promise<void>, UseExtensionStateResult<T>] {
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
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
  );
  const value = snapshot?.states[key]?.value as T | undefined;

  const [error, setError] = useState<unknown>(undefined);
  const [pending, setPending] = useState(false);

  const write = useCallback(
    async (op: "set" | "delete", v?: T): Promise<void> => {
      if (client === undefined)
        throw new Error("useExtensionState: client unavailable");
      if (opts.sessionId === undefined)
        throw new Error("useExtensionState: sessionId unavailable");
      setPending(true);
      setError(undefined);
      try {
        await client.setState(opts.sessionId, { key, value: v, op });
        setPending(false);
      } catch (err) {
        setError(err);
        setPending(false);
        throw err;
      }
    },
    [client, opts.sessionId, key],
  );

  const setValue = useCallback((v: T): Promise<void> => write("set", v), [write]);
  const remove = useCallback((): Promise<void> => write("delete"), [write]);

  const result: UseExtensionStateResult<T> = {
    value,
    setValue,
    remove,
    error,
    pending,
  };
  return [value, setValue, result];
}

/**
 * 可选 PiProvider + usePiContext。
 *
 * 注入共享 baseUrl / fetch / client;hooks 未显式传 client 时回退到 context。非强制——
 * hooks 也接受显式注入。
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { createPiClient, type PiClient, type FetchLike } from "../client/pi-client.js";

export interface PiContextValue {
  readonly baseUrl: string;
  readonly client: PiClient;
  readonly fetchImpl: FetchLike | undefined;
}

const PiContext = createContext<PiContextValue | null>(null);

export interface PiProviderProps {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  /** 显式注入 client(覆盖 baseUrl/fetch 构造)。 */
  readonly client?: PiClient;
  readonly children: ReactNode;
}

export function PiProvider(props: PiProviderProps): ReactNode {
  const value = useMemo<PiContextValue>(() => {
    const client = props.client ?? createPiClient(props.baseUrl, props.fetch);
    return { baseUrl: props.baseUrl, client, fetchImpl: props.fetch };
  }, [props.baseUrl, props.fetch, props.client]);

  return createElement(PiContext.Provider, { value }, props.children);
}

/** 读取 PiProvider 注入的 context;在 Provider 外返回 null。 */
export function usePiContext(): PiContextValue | null {
  return useContext(PiContext);
}

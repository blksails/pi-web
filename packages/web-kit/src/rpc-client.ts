/**
 * web-kit — UI↔agent RPC client(扩展内回 agent 取数据/执行的入口)。
 *
 * 扩展**不直接**持有 fetch/transport;宿主在加载时注入一个 `UiRpcClient` 实现到
 * host-context。扩展只面向此窄接口编程,对应 protocol 的 UiRpcRequest/Response。
 */
import type { UiRpcPoint, UiRpcAction, UiRpcResponse } from "@blksails/protocol";

export interface UiRpcCall {
  readonly point: UiRpcPoint;
  readonly action: UiRpcAction;
  readonly payload?: unknown;
  /** 可选取消信号(InlineComplete 等高频场景)。 */
  readonly signal?: AbortSignal;
}

export interface UiRpcClient {
  /** 发起一次 ui-rpc;宿主负责生成 correlationId、配对下行响应、超时。 */
  request(call: UiRpcCall): Promise<UiRpcResponse>;
}

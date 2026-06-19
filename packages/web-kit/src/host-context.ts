/**
 * web-kit — host-context:扩展运行时从宿主取得的受控上下文。
 *
 * 宿主在加载扩展时提供该上下文(经 React context 注入)。扩展不直接接触宿主内部
 * 状态/transport,只用此窄面:回 agent 的 RPC client、当前主题 token、扩展自身 id。
 */
import type { UiRpcClient } from "./rpc-client.js";

export interface WebExtHostContext {
  /** 当前扩展 id(CSS/registry 命名空间根)。 */
  readonly extId: string;
  /** 回 agent 的 RPC client(Tier 3 / artifact 中转)。 */
  readonly rpc: UiRpcClient;
  /** 只读的宿主主题 token 快照(扩展只读,不可覆写)。 */
  readonly theme: Readonly<Record<string, string>>;
}

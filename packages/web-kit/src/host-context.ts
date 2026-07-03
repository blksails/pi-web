/**
 * web-kit — host-context:扩展运行时从宿主取得的受控上下文。
 *
 * 宿主在加载扩展时提供该上下文(经 React context 注入)。扩展不直接接触宿主内部
 * 状态/transport,只用此窄面:回 agent 的 RPC client、当前主题 token、扩展自身 id。
 */
import type { UiRpcClient } from "./rpc-client.js";
import type { Logger } from "@blksails/pi-web-logger";
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";

/**
 * webext 侧共享状态接入(state-injection-bridge, Req 7)。宿主把它接到与前端 hook 同一条
 * 下行/写回通道(ControlStore.states + client.setState),webext 经此读写「人机共驾」状态。
 * 写回沿用既有 webext 信任门控边界(由宿主在装配时决定是否提供)。
 */
export interface WebExtStateAccess {
  /** 读 key 当前值(未初始化为 undefined)。 */
  get<T = unknown>(key: string): T | undefined;
  /** 订阅 key 变更,返回取消订阅函数。 */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  /** 写回 key(经写回端点)。 */
  set(key: string, value: unknown): Promise<void>;
  /** 删除 key(经写回端点)。 */
  delete(key: string): Promise<void>;
}

/**
 * webext 侧 agent 权威 surface 接入(agent-authoritative-surface)。宿主把它接到与前端 hook 同一条
 * 命令上行(ui-rpc agent 转发)+ 状态下行(ControlStore.states)+ 能力探针(getCommands)通道。
 * `domain` 对宿主不透明(领域无关搬运);slot 组件是独立 bundle,故经 prop 注入(非 React context /
 * 非 useSurface hook,因 web-kit 不依赖 react)—— 这是 useSurface 在 slot 侧的等价接入。
 */
export interface WebExtSurfaceAccess {
  /** 发起 surface 命令(经 ui-rpc agent 转发路径),resolve 为 SurfaceCommandResult。 */
  run(domain: string, action: string, args?: unknown): Promise<SurfaceCommandResult>;
  /** 读某 state key 当前值(通常 `surface:<domain>` 的镜像快照)。 */
  getState<T = unknown>(key: string): T | undefined;
  /** 订阅某 state key 变更,返回取消订阅函数。 */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  /** 探针:某命令名(如 `surface:<domain>`)是否存在,供 available 退化。 */
  hasCommand(name: string): boolean;
}

export interface WebExtHostContext {
  /** 当前扩展 id(CSS/registry 命名空间根)。 */
  readonly extId: string;
  /** 回 agent 的 RPC client(Tier 3 / artifact 中转)。 */
  readonly rpc: UiRpcClient;
  /** 只读的宿主主题 token 快照(扩展只读,不可覆写)。 */
  readonly theme: Readonly<Record<string, string>>;
  /**
   * Structured logger for the webext (browser sink → browser log bus).
   * Namespace is prefixed with the extension id by convention.
   * Provided by the host; webext components read it via WebExtHostContext.
   */
  readonly logger: Logger;
  /**
   * 共享状态接入(state-injection-bridge)。可选:宿主在启用状态桥且 webext 信任门控允许时提供;
   * 未提供表示该 webext 无状态读写能力(降级,不报错)。
   */
  readonly state?: WebExtStateAccess;
}

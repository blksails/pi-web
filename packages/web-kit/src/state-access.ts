/**
 * web-kit — createWebExtStateAccess:把宿主的「状态读 + 变更订阅 + 写回」三个原语组装成
 * webext 侧的 `WebExtStateAccess`(state-injection-bridge, Req 7)。
 *
 * 纯适配器,无 React / transport 直接依赖:宿主在装配 WebExtHostContext 时,用前端 ControlStore
 * 的 `read`/`subscribe` 与 `client.setState` 包出的 `write` 注入。写回沿用宿主既有信任门控
 * (宿主决定是否提供本接入,Req 7.3)。
 */
import type { WebExtStateAccess } from "./host-context.js";

export interface WebExtStateAccessDeps {
  /** 读某 key 当前值(通常来自 ControlStore.states[key].value)。 */
  read(key: string): unknown;
  /** 订阅底层 store 变更(任意 key 变更都回调);返回取消订阅。 */
  subscribe(listener: () => void): () => void;
  /** 写回(set/delete);通常包 client.setState。 */
  write(key: string, value: unknown, op: "set" | "delete"): Promise<void>;
}

/** 组装 webext 共享状态接入。 */
export function createWebExtStateAccess(
  deps: WebExtStateAccessDeps,
): WebExtStateAccess {
  return {
    get: <T,>(key: string) => deps.read(key) as T | undefined,
    subscribe: (key, listener) => {
      let last = deps.read(key);
      // 底层 store 任意变更时,仅当该 key 的值变化才回调(避免无关 key 抖动)。
      return deps.subscribe(() => {
        const next = deps.read(key);
        if (next !== last) {
          last = next;
          listener(next);
        }
      });
    },
    set: (key, value) => deps.write(key, value, "set"),
    delete: (key) => deps.write(key, undefined, "delete"),
  };
}

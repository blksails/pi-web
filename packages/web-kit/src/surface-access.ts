/**
 * web-kit — createWebExtSurfaceAccess:把宿主的「命令上行 + 状态读 + 变更订阅 + 能力探针」四个
 * 原语组装成 webext 侧的 `WebExtSurfaceAccess`(agent-authoritative-surface)。
 *
 * 纯适配器,无 React / transport 直接依赖:宿主在装配时用 ui-rpc bus 的 `run`、前端 ControlStore 的
 * `read`/`subscribe` 与命令表的 `hasCommand` 注入。`domain` 对宿主不透明(领域无关搬运)。
 */
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";
import type { WebExtSurfaceAccess } from "./host-context.js";

export interface WebExtSurfaceAccessDeps {
  /** 发起 surface 命令(通常包 ui-rpc bus.request + SurfaceCommandResult 解析)。 */
  run(domain: string, action: string, args?: unknown): Promise<SurfaceCommandResult>;
  /** 读某 key 当前值(通常来自 ControlStore.states[key].value)。 */
  read(key: string): unknown;
  /** 订阅底层 store 变更(任意 key 变更都回调);返回取消订阅。 */
  subscribe(listener: () => void): () => void;
  /** 探针:某命令名是否存在(通常来自 getCommands 结果)。 */
  hasCommand(name: string): boolean;
}

/** 组装 webext 权威 surface 接入。 */
export function createWebExtSurfaceAccess(
  deps: WebExtSurfaceAccessDeps,
): WebExtSurfaceAccess {
  return {
    run: deps.run,
    getState: <T,>(key: string) => deps.read(key) as T | undefined,
    subscribe: (key, listener) => {
      let last = deps.read(key);
      return deps.subscribe(() => {
        const next = deps.read(key);
        if (next !== last) {
          last = next;
          listener(next);
        }
      });
    },
    hasCommand: deps.hasCommand,
  };
}

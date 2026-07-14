/**
 * agent-authoritative-surface · 纯 surface 命令派发器 `createSurfaceDispatcher`。
 *
 * SRP/DIP 收口(与 `route-dispatcher` 对称):把「按 domain 查进程内 surface 注册表 → dispatch →
 * 结果归一化」的纯逻辑从 runner 接线(`wireSurfaceBridge`)里剥离。本模块**不依赖** FrameChannel /
 * stdio,只依赖注入的 `globalScope`(seam 宿主)与领域类型,可脱离通道独立单测。
 *
 * 归一化契约(与既有线协议逐字一致):
 *  - domain 未在 seam 注册 → `ok:false, code:"surface_not_registered"`;
 *  - 注册表 `dispatch` 抛错 → `ok:false, code:"dispatch_failed"`(最终防线;dispatch 内部本已归一化不抛);
 *  - 正常 → 透传 `dispatch` 的 `SurfaceCommandResult`。
 *
 * `dispatch` **永不 reject**。
 */
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";

/** 进程内注册表条目(与 tool-kit `SurfaceDispatch` 结构一致,duck-typed 读取)。 */
interface SurfaceDispatchLike {
  dispatch(action: string, args: unknown): Promise<SurfaceCommandResult>;
}

export interface SurfaceDispatcher {
  /** 按 domain 派发一条 surface 命令 → 归一化结果。永不 reject。 */
  dispatch(
    domain: string,
    action: string,
    args: unknown,
  ): Promise<SurfaceCommandResult>;
}

/** 从 seam 查目标 surface 的 dispatch(duck-type:兼容 tool-kit SeamRegistry 的 `entries` Map)。 */
function lookupSurface(
  globalScope: Record<string, unknown>,
  seamKey: string,
  domain: string,
): SurfaceDispatchLike | undefined {
  const seam = globalScope[seamKey];
  if (typeof seam !== "object" || seam === null) return undefined;
  const entries = (seam as { entries?: unknown }).entries;
  if (!(entries instanceof Map)) return undefined;
  const entry = entries.get(domain) as unknown;
  if (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { dispatch?: unknown }).dispatch === "function"
  ) {
    return entry as SurfaceDispatchLike;
  }
  return undefined;
}

/**
 * 构造 surface 命令派发器。
 *
 * @param globalScope seam 宿主(读 surface 注册表)。
 * @param seamKey     surface 注册表 seam key。
 */
export function createSurfaceDispatcher(
  globalScope: Record<string, unknown>,
  seamKey: string,
): SurfaceDispatcher {
  return {
    async dispatch(domain, action, args) {
      const entry = lookupSurface(globalScope, seamKey, domain);
      if (entry === undefined) {
        return {
          domain,
          action,
          ok: false,
          error: {
            code: "surface_not_registered",
            message: `surface 未注册:${domain}`,
          },
        };
      }
      try {
        return await entry.dispatch(action, args);
      } catch (err) {
        // dispatch 内部已归一化不抛;此处为最终防线(不崩会话)。
        return {
          domain,
          action,
          ok: false,
          error: { code: "dispatch_failed", message: String(err) },
        };
      }
    },
  };
}

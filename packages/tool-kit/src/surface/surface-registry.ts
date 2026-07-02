/**
 * agent 权威 surface(agent-authoritative-surface)· 进程内 surface 注册表 seam。
 *
 * 一份 `domain → SurfaceDispatch` 的进程内注册表,挂在 globalThis seam `__piWebSurfaces__`。
 * `createSurface` 在子进程内 `register(domain, entry)`;server 层的 `wireSurfaceBridge`(第二个
 * stdin 读取器)在派发命令时**懒读**同一 seam 并 `get(domain).dispatch(...)`。装配顺序无关
 * (对齐 state seam):谁先跑都能收敛到同一注册表对象。
 *
 * 纯进程内、同步、零落盘、无 pi SDK / Node 依赖(可单测、前端安全)。seam key 常量与 server 端
 * `wireSurfaceBridge` **必须一致**(见 `packages/server/src/runner/surface-wiring.ts`,duplicate +
 * consistency 注释,对齐 `SESSION_STATE_SEAM_KEY` 的既有先例)。
 */
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";

/** 约定 globalThis seam key(必须与 server `wireSurfaceBridge` 读取端一致)。 */
export const SURFACE_REGISTRY_SEAM_KEY = "__piWebSurfaces__";

/** 注册表条目:按 action 派发,归一化为 `SurfaceCommandResult`。 */
export interface SurfaceDispatch {
  dispatch(action: string, args: unknown): Promise<SurfaceCommandResult>;
}

/** 进程内 domain→dispatch 注册表。 */
export interface SurfaceRegistry {
  register(domain: string, entry: SurfaceDispatch): void;
  get(domain: string): SurfaceDispatch | undefined;
}

/** seam 上挂载的内部形状(Map 载体)。 */
interface SeamRegistry {
  readonly __piWebSurfaceRegistry: true;
  readonly entries: Map<string, SurfaceDispatch>;
}

function isSeamRegistry(value: unknown): value is SeamRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __piWebSurfaceRegistry?: unknown }).__piWebSurfaceRegistry === true &&
    (value as { entries?: unknown }).entries instanceof Map
  );
}

/**
 * 读/建 globalThis 上的 surface 注册表。首次调用时惰性建 seam;后续复用同一对象。
 *
 * @param scope 可选 globalThis 宿主(默认 `globalThis`),便于测试隔离。
 */
export function getSurfaceRegistry(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): SurfaceRegistry {
  const existing = scope[SURFACE_REGISTRY_SEAM_KEY];
  let seam: SeamRegistry;
  if (isSeamRegistry(existing)) {
    seam = existing;
  } else {
    seam = { __piWebSurfaceRegistry: true, entries: new Map() };
    scope[SURFACE_REGISTRY_SEAM_KEY] = seam;
  }
  return {
    register(domain, entry) {
      seam.entries.set(domain, entry);
    },
    get(domain) {
      return seam.entries.get(domain);
    },
  };
}

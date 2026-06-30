/**
 * 状态注入桥 · 作者工具侧接入点 `getSessionState()`(state-injection-bridge)。
 *
 * agent 作者在工具 `execute` 内调用 `getSessionState()` 同步读写**会话级共享状态**(权威 KV 在
 * 子进程,由 pi-web 的 `wireStateBridge` 自建并挂到 globalThis seam)。读写零跨进程、立即生效;
 * 写入会经下行帧实时镜像到 UI(context 外,不进 LLM 历史)。
 *
 * seam 不可用时(非子进程 / 桥未装配 / 前端)返回 `available:false` 的降级视图,读返回 undefined、
 * 写为 no-op,绝不抛 —— 与 attachment 接入点同款 fail-safe。
 *
 * 纯 globalThis 读取,无 pi SDK / Node 依赖,前端安全(浏览器侧恒降级)。
 */

/** 约定 globalThis seam key(必须与 server `wireStateBridge` 写入端一致)。 */
export const SESSION_STATE_SEAM_KEY = "__piWebSessionState__";

/** 工具侧的最小共享状态视图。 */
export interface SessionStateAccess {
  /** 能力是否可用(seam 已装配)。 */
  readonly available: boolean;
  /** 读 key 当前值;未初始化或不可用返回 undefined。 */
  get<T = unknown>(key: string): T | undefined;
  /** 写入 key(不可用时 no-op)。 */
  set(key: string, value: unknown): void;
  /** 删除 key(不可用时 no-op)。 */
  delete(key: string): void;
  /** 全量快照(key→value);不可用返回空对象。 */
  snapshot(): Readonly<Record<string, unknown>>;
}

/** seam 上挂载的内部 provider 形状(由 wireStateBridge 写入)。 */
interface SeamProvider {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

const UNAVAILABLE: SessionStateAccess = {
  available: false,
  get: () => undefined,
  set: () => {},
  delete: () => {},
  snapshot: () => ({}),
};

function isSeamProvider(value: unknown): value is SeamProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { set?: unknown }).set === "function"
  );
}

/**
 * 取当前会话的共享状态接入点。在 agent 工具 `execute` 内调用。
 *
 * @param scope 可选 globalThis 宿主(默认 `globalThis`),便于测试隔离。
 */
export function getSessionState(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): SessionStateAccess {
  const provider = scope[SESSION_STATE_SEAM_KEY];
  if (!isSeamProvider(provider)) return UNAVAILABLE;
  return {
    available: true,
    get: <T,>(key: string) => provider.get(key) as T | undefined,
    set: (key, value) => provider.set(key, value),
    delete: (key) => provider.delete(key),
    snapshot: () => provider.snapshot(),
  };
}

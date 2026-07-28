/**
 * agent 权威 surface(agent-authoritative-surface)· agent 侧门面 `createSurface`。
 *
 * 把「富交互 UI = agent 进程里某 `domain` 的瘦投影 + 命令发起端」这一 CQRS 范式落成一个 config:
 *  - **权威快照**在子进程,经 `getSessionState().set("surface:<domain>", snapshot)` 写入(rev + fd1
 *    下行帧由 `wireStateBridge` 承担,本门面**不自造 control 帧**);
 *  - **命令**由 server 的 `wireSurfaceBridge` 按 domain 派发到 `commands[action]`,结果**归一化**为
 *    `SurfaceCommandResult`;
 *  - **探针**经 `pi.registerCommand("surface:<domain>")` 注册,使 `getCommands` 可见 → 前端 `available`;
 *  - **Bulk**:命令处理器经 `ctx.attachments`(既有 `AttachmentToolContext`)resolve `att_` / 落库产物,
 *    二进制永不进快照/命令。
 *
 * 属 **runtime 层**:含 pi SDK 值导入(`ExtensionAPI` 仅类型),仅经 `@blksails/pi-web-tool-kit/runtime`
 * 子入口加载,不进前端 bundle。以 `ExtensionFactory` 形态装载(`extensions: [(pi) => createSurface(pi, …)]`,
 * 对齐 `aigcExtension`)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import {
  surfaceStateKey,
  type SurfaceCommandResult,
} from "@blksails/pi-web-protocol";
import {
  getSessionState as defaultGetSessionState,
  type SessionStateAccess,
} from "../session-state.js";
import { getAttachmentToolContext as defaultGetAttachmentToolContext } from "../attachment/seam.js";
import {
  getSurfaceRegistry as defaultGetSurfaceRegistry,
  type SurfaceRegistry,
} from "./surface-registry.js";

/** 命令处理器可见的 surface 上下文(`ctx` 由 SDK 内部构建,不作为命令入参)。 */
export interface SurfaceCtx<S> {
  /** 读当前权威快照。 */
  get(): S;
  /** 改快照并经 state-injection-bridge 写入原语推 `control:"state"` 下行帧(内部走 `getSessionState().set`)。 */
  setState(reducer: (prev: S) => S): void;
  /** 复用既有 attachment 工具上下文(Bulk:resolve `att_` / putOutput)。 */
  readonly attachments: AttachmentToolContext;
}

/**
 * 命令处理器返回判别联合:
 *  - 成功值(→ dispatch 包成 `{ok:true,data}`);或
 *  - **非抛错**显式失败 `{ok:false, error:{code,message}}`(→ dispatch 透传,保留稳定领域 code)。
 */
export type SurfaceCommandHandlerResult =
  | { ok: false; error: { code: string; message: string } }
  | unknown;

export type SurfaceCommandHandler<S> = (
  args: unknown,
  ctx: SurfaceCtx<S>,
) => Promise<SurfaceCommandHandlerResult> | SurfaceCommandHandlerResult;

/** 命令处理器可抛出的携码错误;其 `.code` 由 dispatch 传播进 `SurfaceCommandResult.error.code`。 */
export class SurfaceCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SurfaceCommandError";
  }
}

export interface SurfaceConfig<S> {
  domain: string;
  /** 初值(**由调用方在此处构造**,避免跨 surface 共享同一引用)。 */
  initialState: S;
  commands: Record<string, SurfaceCommandHandler<S>>;
  /** 子进程(重)启动时从领域数据源重建初始快照(SDK 只定义钩子形态,重建实现归领域)。 */
  hydrate?(): Promise<S>;
}

export interface SurfaceHandle<S> {
  readonly domain: string;
  /** ① 触发源:确定性代码直接改快照(推下行帧)。 */
  update(reducer: (prev: S) => S): void;
  /** ② 触发源:由 `wireSurfaceBridge` 命中 `commands[action]`;结果归一化为 `SurfaceCommandResult`。 */
  dispatch(action: string, args: unknown): Promise<SurfaceCommandResult>;
  /** 回放最新快照(粘性 / 重连收敛):经 `set` 重推当前快照。 */
  replay(): void;
}

/** 可注入依赖(默认取真实 seam;测试注入 fake)。 */
export interface CreateSurfaceDeps {
  scope?: Record<string, unknown>;
  getSessionState?: (scope?: Record<string, unknown>) => SessionStateAccess;
  getSurfaceRegistry?: (scope?: Record<string, unknown>) => SurfaceRegistry;
  getAttachmentToolContext?: (scope?: Record<string, unknown>) => AttachmentToolContext;
  /** 装配期延后推快照的调度器(默认 `setTimeout(fn, 0)`);测试可注入同步实现。 */
  schedule?: (fn: () => void) => void;
}

/** 类型守卫:handler 的**非抛错**显式失败返回 `{ok:false, error:{code,message}}`。 */
function isExplicitFailure(
  value: unknown,
): value is { ok: false; error: { code: string; message: string } } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { ok?: unknown; error?: unknown };
  if (v.ok !== false) return false;
  const err = v.error as { code?: unknown; message?: unknown } | undefined;
  return (
    typeof err === "object" &&
    err !== null &&
    typeof err.code === "string" &&
    typeof err.message === "string"
  );
}

/** 从抛出的 error 取稳定 code:优先 `.code`(如 `SurfaceCommandError`),否则兜底 `dispatch_failed`。 */
function errorToResultError(err: unknown): { code: string; message: string } {
  const code =
    typeof (err as { code?: unknown } | undefined)?.code === "string"
      ? (err as { code: string }).code
      : "dispatch_failed";
  const message = err instanceof Error ? err.message : String(err);
  return { code, message };
}

/**
 * 创建一个按 `domain` 命名的权威 surface。以 `ExtensionFactory` 形态在子进程内装载。
 *
 * @param pi     pi ExtensionAPI(用于注册探针命令)。
 * @param config surface 配置(domain / initialState / commands / hydrate?)。
 * @param deps   可注入依赖(测试用;默认取真实 seam)。
 */
export function createSurface<S>(
  pi: ExtensionAPI,
  config: SurfaceConfig<S>,
  deps: CreateSurfaceDeps = {},
): SurfaceHandle<S> {
  const scope = deps.scope;
  const getSessionState = deps.getSessionState ?? defaultGetSessionState;
  const getSurfaceRegistry = deps.getSurfaceRegistry ?? defaultGetSurfaceRegistry;
  const getAttachmentToolContext =
    deps.getAttachmentToolContext ?? defaultGetAttachmentToolContext;
  const schedule =
    deps.schedule ??
    ((fn: () => void): void => {
      setTimeout(fn, 0);
    });

  const { domain } = config;
  const key = surfaceStateKey(domain);
  let current: S = config.initialState;

  const pushSnapshot = (): SessionStateAccess => {
    const state = getSessionState(scope);
    state.set(key, current);
    return state;
  };

  const applyReducer = (reducer: (prev: S) => S): void => {
    current = reducer(current);
    pushSnapshot();
  };

  const buildCtx = (): SurfaceCtx<S> => ({
    get: () => current,
    setState: applyReducer,
    attachments: getAttachmentToolContext(scope),
  });

  const dispatch = async (
    action: string,
    args: unknown,
  ): Promise<SurfaceCommandResult> => {
    const handler = config.commands[action];
    if (handler === undefined) {
      return {
        domain,
        action,
        ok: false,
        error: { code: "unknown_action", message: `未知 surface 命令:${action}` },
      };
    }
    try {
      const raw = await handler(args, buildCtx());
      if (isExplicitFailure(raw)) {
        // 非抛错显式失败:原样透传,保留稳定领域 code。
        return { domain, action, ok: false, error: raw.error };
      }
      return { domain, action, ok: true, data: raw };
    } catch (err) {
      return { domain, action, ok: false, error: errorToResultError(err) };
    }
  };

  // 注册进程内注册表(server `wireSurfaceBridge` 懒读同一 seam 派发)。
  getSurfaceRegistry(scope).register(domain, { dispatch });

  // 能力探针:注册只读命令 `surface:<domain>`,使 `getCommands` 可见 → 前端 `available`。
  // handler no-op:探针仅用于能力协商,不承载领域执行(命令走 ui-rpc 转发 + wireSurfaceBridge)。
  try {
    pi.registerCommand(key, {
      description: `agent-authoritative-surface probe: ${domain}`,
      handler: async () => {
        /* probe: no-op */
      },
    });
  } catch {
    // 探针注册失败 → available=false → 前端退化(仍可用)。best-effort,不抛。
  }

  // 装配期初始/hydrate 快照推送。createSurface 在 `createAgentSessionRuntime` 期运行,可能**早于**
  // runner 的 `wireStateBridge` 装 seam;此时立即 push 为 no-op(seam 未就绪)。故 seam 未就绪时
  // 延后到宏任务重推(wireStateBridge 届时已装),使初始/hydrate 快照对 UI 可见(Req 1.6)。
  const assemble = async (): Promise<void> => {
    if (config.hydrate !== undefined) {
      try {
        current = await config.hydrate();
      } catch {
        // 重建失败 → 保留 initialState。best-effort,不抛。
      }
    }
    const state = pushSnapshot();
    if (!state.available) schedule(() => pushSnapshot());
  };
  void assemble();

  return {
    domain,
    update: applyReducer,
    dispatch,
    replay: () => {
      pushSnapshot();
    },
  };
}

/**
 * agent 权威 surface(agent-authoritative-surface)· runner 子进程 ui-rpc 命令接收/派发接线
 * `wireSurfaceBridge`。
 *
 * `PiSession.uiRpc` 把 surface 命令作为 `{"type":"ui_rpc","request":{...}}` 行写入子进程 stdin。
 * 本桥向父子 IPC 帧通道注册 `ui_rpc` 帧:
 *
 *  1. **匹配 + 派发**:仅当 `point==="command"` && `action==="execute"` &&
 *     `SurfaceCommandPayloadSchema` 通过时消费;按 `payload.domain` 在进程内 surface 注册表 seam
 *     (`__piWebSurfaces__`,由 tool-kit `createSurface` 写入)查 dispatch。未注册 → `ok:false`
 *     `surface_not_registered`。**非 surface 命令**(host 命令有 name / 非 command point / 畸形 payload)
 *     直接返回不回包(=放行,交 pi / webext)。
 *  2. **回流**:经帧通道 `ctx.send` 写 `ui_rpc_response` 行(fd1)。server 的 `handleRawLine` 识别 →
 *     合成 `control:"ui-rpc"` 帧(按 correlationId 客户端配对)。
 *
 * 上行 fd1 直写、单一 stdin 读取器、优雅降级由帧通道统一承担。无 surface 注册时惰性 no-op(Req 3.6)。
 */
import {
  SurfaceCommandPayloadSchema,
  UiRpcRequestSchema,
  type SurfaceCommandResult,
  type UiRpcRequest,
} from "@blksails/pi-web-protocol";
import type {
  FrameChannel,
  HandlerCtx,
  SafeParser,
  WritableLike,
} from "./frame-channel/index.js";
import { SURFACE_REGISTRY_SEAM_KEY } from "./frame-channel/index.js";

/** 约定 globalThis seam key(自 `frame-channel/seam-keys` 单一来源再导出,兼容既有引用)。 */
export { SURFACE_REGISTRY_SEAM_KEY };

/** 进程内注册表条目(与 tool-kit `SurfaceDispatch` 结构一致,duck-typed 读取)。 */
interface SurfaceDispatchLike {
  dispatch(action: string, args: unknown): Promise<SurfaceCommandResult>;
}

export interface WireSurfaceBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** globalThis 宿主(默认 globalThis,读 `__piWebSurfaces__`)。 */
  readonly globalScope?: Record<string, unknown>;
  /** 诊断输出(默认 process.stderr;帧通道亦兜底捕获 handler 抛错)。 */
  readonly stderr?: WritableLike;
}

export interface SurfaceBridgeWiring {
  /** 是否已接入帧通道。 */
  readonly installed: boolean;
  /** 解绑注册(幂等)。 */
  cleanup(): void;
}

/** 已确认 `ui_rpc` 行的最小形状(帧通道 schema 校验产物)。 */
interface UiRpcLine {
  readonly type: "ui_rpc";
  readonly request: UiRpcRequest;
}

/** 从 seam 查目标 surface 的 dispatch(duck-type:兼容 tool-kit SeamRegistry 的 `entries` Map)。 */
function lookupSurface(
  globalScope: Record<string, unknown>,
  domain: string,
): SurfaceDispatchLike | undefined {
  const seam = globalScope[SURFACE_REGISTRY_SEAM_KEY];
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
 * `ui_rpc` 行结构校验器(复用 `UiRpcRequestSchema`,不引 zod 依赖):type 为 `ui_rpc` 且
 * `request` 通过 `UiRpcRequestSchema`。畸形(非 ui_rpc / request 校验失败)→ 由帧通道丢弃/放行。
 */
const uiRpcLineParser: SafeParser<UiRpcLine> = {
  safeParse(v) {
    if (typeof v !== "object" || v === null) return { success: false };
    const o = v as { type?: unknown; request?: unknown };
    if (o.type !== "ui_rpc") return { success: false };
    const r = UiRpcRequestSchema.safeParse(o.request);
    if (!r.success) return { success: false };
    return { success: true, data: { type: "ui_rpc", request: r.data } };
  },
};

/**
 * 装配 surface 桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**、
 * `wireStateBridge(...)` **之后**调用。
 */
export function wireSurfaceBridge(
  channel: FrameChannel,
  input: WireSurfaceBridgeInput,
): SurfaceBridgeWiring {
  const globalScope =
    input.globalScope ?? (globalThis as unknown as Record<string, unknown>);

  // 处理一条已确认为 surface 命令的请求:按 domain 派发 → 回流 ui_rpc_response。
  const handleSurfaceCommand = async (
    request: UiRpcRequest,
    domain: string,
    action: string,
    args: unknown,
    ctx: HandlerCtx,
  ): Promise<void> => {
    let result: SurfaceCommandResult;
    const entry = lookupSurface(globalScope, domain);
    if (entry === undefined) {
      result = {
        domain,
        action,
        ok: false,
        error: {
          code: "surface_not_registered",
          message: `surface 未注册:${domain}`,
        },
      };
    } else {
      try {
        result = await entry.dispatch(action, args);
      } catch (err) {
        // dispatch 内部已归一化不抛;此处为最终防线(不崩会话,Req 3.5)。
        result = {
          domain,
          action,
          ok: false,
          error: { code: "dispatch_failed", message: String(err) },
        };
      }
    }
    ctx.send({
      type: "ui_rpc_response",
      response: { correlationId: request.correlationId, ok: result.ok, result },
    });
  };

  const unregister = channel.register(
    "ui_rpc",
    uiRpcLineParser,
    async (line: UiRpcLine, ctx) => {
      const req = line.request;
      // 仅消费 surface 命令(point=command / action=execute / SurfaceCommandPayload)。
      if (req.point !== "command" || req.action !== "execute") return; // 放行
      const payload = SurfaceCommandPayloadSchema.safeParse(req.payload);
      if (!payload.success) return; // 非 surface 命令(如 host 命令有 name)— 放行
      await handleSurfaceCommand(
        req,
        payload.data.domain,
        payload.data.action,
        payload.data.args,
        ctx,
      );
    },
  );

  let cleanedUp = false;
  return {
    installed: channel.installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unregister();
    },
  };
}

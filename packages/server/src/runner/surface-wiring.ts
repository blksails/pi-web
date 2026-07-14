/**
 * agent 权威 surface(agent-authoritative-surface)· runner 子进程 ui-rpc 命令接收/派发接线
 * `wireSurfaceBridge`。
 *
 * `PiSession.uiRpc` 把 surface 命令作为 `{"type":"ui_rpc","request":{...}}` 行写入子进程 stdin。
 * 本接线向父子 IPC 帧通道注册 `ui_rpc` 帧,只负责**路由门控与回包封装**:
 *
 *  1. **门控**:仅当 `point==="command"` && `action==="execute"` &&
 *     `SurfaceCommandPayloadSchema` 通过时消费;否则直接返回不回包(=放行,交 pi / webext)。
 *  2. **派发**:命中后委托纯 `SurfaceDispatcher`(按 domain 查 seam 注册表 → dispatch → 归一化)。
 *  3. **回流**:把结果封装为 `ui_rpc_response` 经 `ctx.send` 写回(fd1);server 的 `handleRawLine`
 *     识别 → 合成 `control:"ui-rpc"` 帧(按 correlationId 客户端配对)。
 *
 * 派发/查表/错误归一化的纯逻辑在 `surface-command-dispatcher`;上行 fd1、单一 stdin 读取器、
 * 优雅降级由帧通道统一承担。无 surface 注册时惰性 no-op(Req 3.6)。
 */
import {
  SurfaceCommandPayloadSchema,
  UiRpcRequestSchema,
  type UiRpcRequest,
} from "@blksails/pi-web-protocol";
import type { FrameChannel, SafeParser, WritableLike } from "./frame-channel/index.js";
import { SURFACE_REGISTRY_SEAM_KEY } from "./frame-channel/index.js";
import { createSurfaceDispatcher } from "./surface-command-dispatcher.js";

/** 约定 globalThis seam key(自 `frame-channel/seam-keys` 单一来源再导出,兼容既有引用)。 */
export { SURFACE_REGISTRY_SEAM_KEY };

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
  const dispatcher = createSurfaceDispatcher(globalScope, SURFACE_REGISTRY_SEAM_KEY);

  const unregister = channel.register(
    "ui_rpc",
    uiRpcLineParser,
    async (line: UiRpcLine, ctx) => {
      const req = line.request;
      // 门控:仅消费 surface 命令(point=command / action=execute / SurfaceCommandPayload)。
      if (req.point !== "command" || req.action !== "execute") return; // 放行
      const payload = SurfaceCommandPayloadSchema.safeParse(req.payload);
      if (!payload.success) return; // 非 surface 命令(如 host 命令有 name)— 放行
      const result = await dispatcher.dispatch(
        payload.data.domain,
        payload.data.action,
        payload.data.args,
      );
      ctx.send({
        type: "ui_rpc_response",
        response: { correlationId: req.correlationId, ok: result.ok, result },
      });
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

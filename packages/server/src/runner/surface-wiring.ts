/**
 * agent 权威 surface(agent-authoritative-surface)· runner 子进程 ui-rpc 命令接收/派发接线
 * `wireSurfaceBridge`。
 *
 * 这是 `state-injection-bridge` 显式留下的缺口:`PiSession.uiRpc` 把 surface 命令作为
 * `{"type":"ui_rpc","request":{...}}` 行写入子进程 stdin,但除 stub 外**没有真实接收方**
 * (pi 的 `runRpcMode` 只处理 pi 封闭的 `RpcCommand`,视 ui_rpc 为 Unknown-command)。本桥与
 * `wireStateBridge` 同构补齐:
 *
 *  1. **接收**:在 `runRpcMode` **之前**给 `process.stdin` 挂**第二个** JSONL 读取器,截获
 *     `{"type":"ui_rpc","request":UiRpcRequest}` 行。
 *  2. **匹配 + 派发**:仅当 `point==="command"` && `action==="execute"` &&
 *     `SurfaceCommandPayloadSchema.safeParse(payload)` 成功时消费;按 `payload.domain` 在进程内
 *     surface 注册表 seam(`__piWebSurfaces__`,由 tool-kit `createSurface` 写入)查 dispatch。
 *     未注册 → `ok:false` `surface_not_registered`。**非 surface 行放行**(不写回,交 pi / webext)。
 *  3. **回流**:经 `fs.writeSync(1, line+"\n")` **直写 fd1**(单次原子)。⚠ 不能用
 *     `process.stdout.write`:pi 的 `runRpcMode` `takeOverStdout()` 会把它重定向到 stderr;RPC 帧
 *     经 pi 内部原始 fd1 写出,server 的 `PiRpcProcess` 读的是子进程 fd1,故本桥也必须直写 fd1。
 *     server 的 `handleRawLine` 识别 `ui_rpc_response` 行 → 合成 `control:"ui-rpc"` 帧(按
 *     correlationId 客户端配对)。
 *
 * 优雅降级(对齐 `wireStateBridge`):挂载失败 → 记诊断、能力降级、**不抛**。无 surface 注册时
 * 非 surface 行照常放行(惰性 no-op,不影响未使用 AAS 的会话,Req 3.6)。
 */
import { writeSync } from "node:fs";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import {
  SurfaceCommandPayloadSchema,
  UiRpcRequestSchema,
  type SurfaceCommandResult,
  type UiRpcRequest,
  type UiRpcResponse,
} from "@blksails/pi-web-protocol";
import { JsonlLineReader } from "../rpc-channel/jsonl-reader.js";

/**
 * 约定 globalThis seam key(**必须与 tool-kit `SURFACE_REGISTRY_SEAM_KEY` 一致**,见
 * `packages/tool-kit/src/surface/surface-registry.ts`)。为免 server → tool-kit 反向依赖,
 * 此处按既有 `SESSION_STATE_SEAM_KEY` 先例 duplicate + consistency 注释。
 */
export const SURFACE_REGISTRY_SEAM_KEY = "__piWebSurfaces__";

/** data 监听器签名。 */
type DataListener = (chunk: string | Buffer) => void;
type ListenerOp = (event: "data", listener: DataListener) => unknown;

/** 可读流的最小视图(便于测试注入)。 */
interface ReadableLike {
  on(event: "data", listener: DataListener): unknown;
  off?: ListenerOp;
  removeListener?: ListenerOp;
  setEncoding?(encoding: string): unknown;
}

/** 可写流的最小视图。 */
interface WritableLike {
  write(s: string): unknown;
}

/** 进程内注册表条目(与 tool-kit `SurfaceDispatch` 结构一致,duck-typed 读取)。 */
interface SurfaceDispatchLike {
  dispatch(action: string, args: unknown): Promise<SurfaceCommandResult>;
}

export interface WireSurfaceBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 命令行入口(默认 process.stdin)。 */
  readonly stdin?: ReadableLike;
  /** 回流行出口(默认真实 fd1)。 */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
  /** globalThis 宿主(默认 globalThis,读 `__piWebSurfaces__`)。 */
  readonly globalScope?: Record<string, unknown>;
}

export interface SurfaceBridgeWiring {
  /** stdin 命令读取器是否挂上。 */
  readonly installed: boolean;
  /** 卸载 stdin 读取器(幂等)。 */
  cleanup(): void;
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
 * 装配 surface 桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**、
 * `wireStateBridge(...)` **之后**调用。
 */
export function wireSurfaceBridge(
  _runtime: AgentSessionRuntime,
  input: WireSurfaceBridgeInput,
): SurfaceBridgeWiring {
  const stderr = input.stderr ?? process.stderr;
  const globalScope =
    input.globalScope ?? (globalThis as unknown as Record<string, unknown>);

  // 回流行写出:默认直写 fd1(绕 takeOverStdout);测试可经 input.stdout 注入捕获。单次原子写。
  const writeLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          writeSync(1, s);
        };

  const emitResponse = (response: UiRpcResponse): void => {
    try {
      writeLine(JSON.stringify({ type: "ui_rpc_response", response }) + "\n");
    } catch (err) {
      stderr.write(`runner: surface-bridge response-line error: ${String(err)}\n`);
    }
  };

  // 处理一条已确认为 surface 命令的请求:按 domain 派发 → 回流 ui_rpc_response。
  const handleSurfaceCommand = async (
    request: UiRpcRequest,
    domain: string,
    action: string,
    args: unknown,
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
    emitResponse({ correlationId: request.correlationId, ok: result.ok, result });
  };

  const stdin = input.stdin ?? process.stdin;
  let installed = false;
  let onData: ((chunk: string | Buffer) => void) | undefined;
  try {
    stdin.setEncoding?.("utf8");
    const reader = new JsonlLineReader();
    onData = (chunk: string | Buffer): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of reader.push(text)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // 非 JSON(或 pi 命令的部分)— 与本桥无关,忽略
        }
        // 仅关注 ui_rpc 命令行;其余行放行(不干预)。
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          (parsed as { type?: unknown }).type !== "ui_rpc"
        ) {
          continue;
        }
        const req = UiRpcRequestSchema.safeParse((parsed as { request?: unknown }).request);
        if (!req.success) continue; // 畸形 ui_rpc 行 — 放行
        // 仅消费 surface 命令(point=command / action=execute / SurfaceCommandPayload)。
        if (req.data.point !== "command" || req.data.action !== "execute") continue;
        const payload = SurfaceCommandPayloadSchema.safeParse(req.data.payload);
        if (!payload.success) continue; // 非 surface 命令(如 host 命令有 name)— 放行
        void handleSurfaceCommand(
          req.data,
          payload.data.domain,
          payload.data.action,
          payload.data.args,
        ).catch((err) => {
          stderr.write(`runner: surface-bridge dispatch error: ${String(err)}\n`);
        });
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(`runner: surface-bridge stdin reader install error: ${String(err)}\n`);
  }

  let cleanedUp = false;
  return {
    installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined)
          stdin.removeListener("data", onData);
      }
    },
  };
}

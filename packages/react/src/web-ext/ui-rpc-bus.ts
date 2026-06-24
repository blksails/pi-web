/**
 * ui-rpc-bus — 宿主侧 UI↔agent RPC 客户端总线(任务 4.2 / Req 4.2-4.5)。
 *
 * 实现 web-kit 的 `UiRpcClient`:`request(call)` 生成 correlationId、经 `send` 上行
 * (POST /sessions/:id/ui-rpc,仅 ack),并订阅下行 `control: ui-rpc` 响应按 id 配对。
 * 含超时与 AbortSignal 取消;失败/超时以 `ok:false` 响应回填,不抛、不阻塞输入。
 *
 * 纯逻辑 + 依赖注入(send / subscribeResponse / 计时器 / id 生成),便于单测。
 */
import type {
  UiRpcRequest,
  UiRpcResponse,
} from "@blksails/protocol";
import { protocolVersion } from "@blksails/protocol";
import type { UiRpcClient, UiRpcCall } from "@blksails/web-kit";

export interface UiRpcBusOptions {
  /** 上行发送(POST ui-rpc,返回 ack)。 */
  send(req: UiRpcRequest): Promise<void>;
  /** 订阅下行响应(通常 = ControlStore.onUiRpcResponse)。返回取消订阅。 */
  subscribeResponse(cb: (r: UiRpcResponse) => void): () => void;
  /** 超时毫秒(默认 15000)。 */
  timeoutMs?: number;
  /** correlationId 生成器(测试可注入确定性实现)。 */
  genId?: () => string;
}

interface Pending {
  resolve(r: UiRpcResponse): void;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
}

export interface UiRpcBus extends UiRpcClient {
  /** 释放订阅并以错误结算所有挂起请求。 */
  dispose(): void;
}

let counter = 0;
function defaultGenId(): string {
  counter += 1;
  return `uirpc-${counter}-${String(performance.now()).replace(".", "")}`;
}

export function createUiRpcBus(opts: UiRpcBusOptions): UiRpcBus {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const genId = opts.genId ?? defaultGenId;
  const pending = new Map<string, Pending>();

  const unsubscribe = opts.subscribeResponse((r: UiRpcResponse) => {
    const p = pending.get(r.correlationId);
    if (p === undefined) return; // 未知/已超时,丢弃
    settle(r.correlationId, r);
  });

  function settle(id: string, r: UiRpcResponse): void {
    const p = pending.get(id);
    if (p === undefined) return;
    clearTimeout(p.timer);
    if (p.signal !== undefined && p.onAbort !== undefined) {
      p.signal.removeEventListener("abort", p.onAbort);
    }
    pending.delete(id);
    p.resolve(r);
  }

  function request(call: UiRpcCall): Promise<UiRpcResponse> {
    const correlationId = genId();
    const req: UiRpcRequest = {
      correlationId,
      point: call.point,
      action: call.action,
      payload: call.payload,
      protocolVersion,
    };

    return new Promise<UiRpcResponse>((resolve) => {
      const timer = setTimeout(() => {
        settle(correlationId, {
          correlationId,
          ok: false,
          error: { code: "TIMEOUT", message: `ui-rpc 超时(${timeoutMs}ms)` },
        });
      }, timeoutMs);

      const entry: Pending = { resolve, timer };
      if (call.signal !== undefined) {
        const onAbort = (): void =>
          settle(correlationId, {
            correlationId,
            ok: false,
            error: { code: "ABORTED", message: "ui-rpc 已取消" },
          });
        if (call.signal.aborted) {
          // 已取消:立即结算
          entry.signal = call.signal;
          entry.onAbort = onAbort;
          pending.set(correlationId, entry);
          onAbort();
          return;
        }
        call.signal.addEventListener("abort", onAbort);
        entry.signal = call.signal;
        entry.onAbort = onAbort;
      }
      pending.set(correlationId, entry);

      // 上行;发送失败 → 以错误结算(不阻塞)。
      opts.send(req).catch((err: unknown) => {
        settle(correlationId, {
          correlationId,
          ok: false,
          error: {
            code: "SEND_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      });
    });
  }

  function dispose(): void {
    unsubscribe();
    for (const [id] of pending) {
      settle(id, {
        correlationId: id,
        ok: false,
        error: { code: "DISPOSED", message: "ui-rpc 总线已释放" },
      });
    }
  }

  return { request, dispose };
}

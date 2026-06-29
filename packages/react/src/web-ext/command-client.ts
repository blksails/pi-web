/**
 * command-client — 统一命令层(unified-command-result-layer)前端薄封装(任务 4.1)。
 *
 * 复用 Tier3 ui-rpc 总线:`executeHostCommand` 经 `point="command"` / `action="execute"`
 * 发命令,Promise 由 correlationId 配对(pending/success/error 天然可观测),解析回流的
 * CommandResult。不新增传输,UI 只需调用 + 据结果渲染(事件驱动,Req 1.1/3.x)。
 */
import {
  CommandResultSchema,
  protocolVersion,
  type CommandExecutePayload,
  type CommandResult,
  type UiRpcRequest,
  type UiRpcResponse,
} from "@blksails/pi-web-protocol";

export interface CommandOutcome {
  readonly ok: boolean;
  readonly result?: CommandResult;
  readonly error?: { code: string; message: string };
}

/** host 命令上行发送器:POST /ui-rpc 并返回**同步**响应体(= client.uiRpcCommand 绑定)。 */
export type CommandSender = (req: UiRpcRequest) => Promise<UiRpcResponse>;

let cmdCounter = 0;

/**
 * 执行一个 host 命令(point=command/execute)。host 命令服务端同步执行,结果直接在 HTTP
 * 响应体返回(不依赖 SSE 控制流,避免与 prompt 流冲突)。返回结构化结果(ok + CommandResult | error)。
 * 发送失败以 ok:false 回填(不抛)。
 */
export async function executeHostCommand(
  send: CommandSender,
  name: string,
  argv: string,
): Promise<CommandOutcome> {
  const payload: CommandExecutePayload = {
    name,
    ...(argv.length > 0 ? { argv } : {}),
  };
  cmdCounter += 1;
  const req: UiRpcRequest = {
    correlationId: `cmd-${name}-${String(cmdCounter)}`,
    point: "command",
    action: "execute",
    payload,
    protocolVersion,
  };
  let res: UiRpcResponse;
  try {
    res = await send(req);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "SEND_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  if (!res.ok) {
    return { ok: false, ...(res.error !== undefined ? { error: res.error } : {}) };
  }
  const parsed = CommandResultSchema.safeParse(res.result);
  return parsed.success ? { ok: true, result: parsed.data } : { ok: true };
}

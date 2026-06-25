/**
 * command-client — 统一命令层(unified-command-result-layer)前端薄封装(任务 4.1)。
 *
 * 复用 Tier3 ui-rpc 总线:`executeHostCommand` 经 `point="command"` / `action="execute"`
 * 发命令,Promise 由 correlationId 配对(pending/success/error 天然可观测),解析回流的
 * CommandResult。不新增传输,UI 只需调用 + 据结果渲染(事件驱动,Req 1.1/3.x)。
 *
 * `parseCustomUi` 把 point=custom 的 payload 解析为声明式渲染描述(注册名 + props)。
 */
import {
  CommandResultSchema,
  CustomUiPayloadSchema,
  type CommandExecutePayload,
  type CommandResult,
  type CustomUiPayload,
} from "@blksails/pi-web-protocol";
import type { UiRpcClient } from "@blksails/pi-web-kit";

export interface CommandOutcome {
  readonly ok: boolean;
  readonly result?: CommandResult;
  readonly error?: { code: string; message: string };
}

/**
 * 经 ui-rpc 总线执行一个 host 命令。返回结构化结果(ok + CommandResult | error)。
 * 失败/超时由总线以 ok:false 回填(不抛)。
 */
export async function executeHostCommand(
  bus: UiRpcClient,
  name: string,
  argv: string,
  signal?: AbortSignal,
): Promise<CommandOutcome> {
  const payload: CommandExecutePayload = { name, ...(argv.length > 0 ? { argv } : {}) };
  const res = await bus.request({
    point: "command",
    action: "execute",
    payload,
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    return {
      ok: false,
      ...(res.error !== undefined ? { error: res.error } : {}),
    };
  }
  const parsed = CommandResultSchema.safeParse(res.result);
  return parsed.success
    ? { ok: true, result: parsed.data }
    : { ok: true };
}

/** 解析 point=custom 的渲染描述;非法返回 undefined。 */
export function parseCustomUi(payload: unknown): CustomUiPayload | undefined {
  const r = CustomUiPayloadSchema.safeParse(payload);
  return r.success ? r.data : undefined;
}

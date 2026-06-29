import { describe, expect, it } from "vitest";
import {
  executeHostCommand,
  type CommandSender,
} from "../../src/web-ext/command-client.js";
import type { UiRpcRequest, UiRpcResponse } from "@blksails/pi-web-protocol";

function busReturning(res: Omit<UiRpcResponse, "correlationId">): CommandSender & {
  calls: UiRpcRequest[];
} {
  const calls: UiRpcRequest[] = [];
  const send = async (req: UiRpcRequest): Promise<UiRpcResponse> => {
    calls.push(req);
    return { correlationId: req.correlationId, ...res };
  };
  return Object.assign(send, { calls });
}

describe("executeHostCommand", () => {
  it("经 point=command/execute 发命令并解析 CommandResult", async () => {
    const bus = busReturning({ ok: true, result: { command: "plugin", effect: "panel-refresh" } });
    const out = await executeHostCommand(bus, "plugin", "install local:/x");
    expect(bus.calls[0]).toMatchObject({
      point: "command",
      action: "execute",
      payload: { name: "plugin", argv: "install local:/x" },
    });
    expect(out.ok).toBe(true);
    expect(out.result?.effect).toBe("panel-refresh");
  });

  it("空 argv 不带 argv 字段", async () => {
    const bus = busReturning({ ok: true, result: { command: "plugin" } });
    await executeHostCommand(bus, "plugin", "");
    expect(bus.calls[0]?.payload).toEqual({ name: "plugin" });
  });

  it("ok:false 透传 error", async () => {
    const bus = busReturning({ ok: false, error: { code: "TIMEOUT", message: "超时" } });
    const out = await executeHostCommand(bus, "plugin", "list");
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("TIMEOUT");
  });

  it("result 非 CommandResult 形状 → ok:true 但无 result", async () => {
    const bus = busReturning({ ok: true, result: { garbage: 1 } });
    const out = await executeHostCommand(bus, "plugin", "");
    expect(out.ok).toBe(true);
    expect(out.result).toBeUndefined();
  });
});

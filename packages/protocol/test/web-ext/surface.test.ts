import { describe, expect, it } from "vitest";
import {
  SurfaceCommandPayloadSchema,
  SurfaceCommandResultSchema,
  surfaceStateKey,
  type SurfaceCommandPayload,
  type SurfaceCommandResult,
} from "../../src/web-ext/surface.js";
import { CommandExecutePayloadSchema } from "../../src/web-ext/command.js";
import {
  UiRpcRequestSchema,
  UiRpcResponseSchema,
  UiRpcControlPayloadSchema,
} from "../../src/web-ext/ui-rpc.js";

describe("web-ext/surface schema", () => {
  it("SurfaceCommandPayload:合法(无 name)、domain/action 非空", () => {
    expect(
      SurfaceCommandPayloadSchema.safeParse({ domain: "demo", action: "increment" }).success,
    ).toBe(true);
    expect(
      SurfaceCommandPayloadSchema.safeParse({
        domain: "demo",
        action: "echo",
        args: { text: "hi" },
      }).success,
    ).toBe(true);
    // 缺 domain / action 拒绝
    expect(SurfaceCommandPayloadSchema.safeParse({ action: "x" }).success).toBe(false);
    expect(SurfaceCommandPayloadSchema.safeParse({ domain: "x" }).success).toBe(false);
    // 空串拒绝
    expect(SurfaceCommandPayloadSchema.safeParse({ domain: "", action: "x" }).success).toBe(
      false,
    );
    expect(SurfaceCommandPayloadSchema.safeParse({ domain: "x", action: "" }).success).toBe(
      false,
    );
  });

  it("SurfaceCommandPayload 无顶层 name:逃逸 host 命令拦截(CommandExecutePayload 失败)", () => {
    const payload = { domain: "demo", action: "increment" };
    // surface payload 通过 surface schema
    expect(SurfaceCommandPayloadSchema.safeParse(payload).success).toBe(true);
    // 但因无 name 而不满足 host 命令 schema → 不被 host 拦截 → 落 agent 转发
    expect(CommandExecutePayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("SurfaceCommandResult:round-trip(ok + data / ok:false + error)", () => {
    const ok: SurfaceCommandResult = {
      domain: "demo",
      action: "increment",
      ok: true,
      data: { count: 1 },
    };
    const parsedOk = SurfaceCommandResultSchema.safeParse(ok);
    expect(parsedOk.success).toBe(true);
    if (parsedOk.success) expect(parsedOk.data).toEqual(ok);

    const fail: SurfaceCommandResult = {
      domain: "demo",
      action: "nope",
      ok: false,
      error: { code: "unknown_action", message: "no such action" },
    };
    const parsedFail = SurfaceCommandResultSchema.safeParse(fail);
    expect(parsedFail.success).toBe(true);
    if (parsedFail.success) expect(parsedFail.data.error?.code).toBe("unknown_action");

    // error.code 必填
    expect(
      SurfaceCommandResultSchema.safeParse({
        domain: "d",
        action: "a",
        ok: false,
        error: { message: "x" },
      }).success,
    ).toBe(false);
  });

  it("surfaceStateKey 由 domain 构造 key", () => {
    const key = surfaceStateKey("demo");
    expect(key).toBe("surface:demo");
  });

  it("向后兼容:UiRpc* 结构未变(payload/result 仍为 unknown)", () => {
    // UiRpcRequest 的 payload 保持 unknown:任意值均可通过(surface schema 在消费侧细化)。
    const req: unknown = {
      correlationId: "c1",
      point: "command",
      action: "execute",
      payload: { domain: "demo", action: "increment" } satisfies SurfaceCommandPayload,
      protocolVersion: "0.0.0",
    };
    expect(UiRpcRequestSchema.safeParse(req).success).toBe(true);
    // 任意 payload 仍合法(结构未收窄)。
    expect(
      UiRpcRequestSchema.safeParse({
        correlationId: "c2",
        point: "command",
        action: "execute",
        payload: { anything: true },
        protocolVersion: "0.0.0",
      }).success,
    ).toBe(true);

    // UiRpcResponse.result 保持 unknown:可承载 SurfaceCommandResult。
    const res: unknown = {
      correlationId: "c1",
      ok: true,
      result: { domain: "demo", action: "increment", ok: true, data: { count: 1 } },
    };
    expect(UiRpcResponseSchema.safeParse(res).success).toBe(true);
    expect(
      UiRpcControlPayloadSchema.safeParse({
        control: "ui-rpc",
        response: res,
      }).success,
    ).toBe(true);
  });
});

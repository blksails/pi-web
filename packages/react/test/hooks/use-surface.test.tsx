/**
 * 单元:useSurface(agent-authoritative-surface, Task 5.1)。
 *  - state 镜像 control:state 帧(key=surface:<domain>)+ rev 单调收敛/丢弃乱序
 *  - run 经 ui-rpc bus 发对形 payload(无 name)+ correlationId 配对 → resolve SurfaceCommandResult
 *  - available 由 getCommands 探针(注入 commandNames 或 fetch 拉取)
 *  - 未就绪 state=null / rev=-1
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { UiRpcRequest } from "@blksails/pi-web-protocol";
import { useSurface } from "../../src/hooks/use-surface.js";
import { createUiRpcBus } from "../../src/web-ext/ui-rpc-bus.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

function setup(commandsBody?: unknown) {
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/commands")) {
      return makeJsonResponse(commandsBody ?? { commands: [] });
    }
    return makeJsonResponse({ ok: true });
  }) as unknown as typeof fetch;
  const client = createPiClient("http://api.test", f);
  const connection = new PiSessionConnection({
    baseUrl: "http://api.test",
    sessionId: "s1",
    fetchImpl: f,
  });
  return { client, connection };
}

describe("useSurface", () => {
  it("未就绪:state=null / rev=-1", () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useSurface<{ count: number }>("demo", {
        sessionId: "s1",
        connection,
        client,
        commandNames: [],
      }),
    );
    expect(result.current.state).toBeNull();
    expect(result.current.rev).toBe(-1);
  });

  it("state 镜像 control:state 帧(key=surface:demo)+ rev", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useSurface<{ count: number }>("demo", {
        sessionId: "s1",
        connection,
        client,
        commandNames: [],
      }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "state",
        key: "surface:demo",
        value: { count: 3 },
        rev: 0,
      });
    });
    await waitFor(() => expect(result.current.state).toEqual({ count: 3 }));
    expect(result.current.rev).toBe(0);
  });

  it("rev 单调收敛,丢弃乱序/过期帧", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useSurface<{ count: number }>("demo", {
        sessionId: "s1",
        connection,
        client,
        commandNames: [],
      }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "state",
        key: "surface:demo",
        value: { count: 5 },
        rev: 2,
      });
    });
    await waitFor(() => expect(result.current.rev).toBe(2));
    // 乱序旧帧(rev=1)被丢弃
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "state",
        key: "surface:demo",
        value: { count: 1 },
        rev: 1,
      });
    });
    expect(result.current.state).toEqual({ count: 5 });
    expect(result.current.rev).toBe(2);
  });

  it("run 经 bus 发对形 payload(无 name)+ correlationId 配对 → resolve SurfaceCommandResult", async () => {
    const { client, connection } = setup();
    const sent: UiRpcRequest[] = [];
    const responders = new Set<(r: import("@blksails/pi-web-protocol").UiRpcResponse) => void>();
    const bus = createUiRpcBus({
      send: async (req) => {
        sent.push(req);
      },
      subscribeResponse: (cb) => {
        responders.add(cb);
        return () => responders.delete(cb);
      },
      genId: () => "fixed-1",
    });
    const { result } = renderHook(() =>
      useSurface<{ count: number }>("demo", {
        sessionId: "s1",
        connection,
        client,
        bus,
        commandNames: [],
      }),
    );

    let resolved: unknown;
    await act(async () => {
      const p = result.current.run("increment", { by: 1 });
      // 回流响应(按 correlationId 配对)
      responders.forEach((cb) =>
        cb({
          correlationId: "fixed-1",
          ok: true,
          result: { domain: "demo", action: "increment", ok: true, data: { count: 1 } },
        }),
      );
      resolved = await p;
    });

    // 上行 payload:无顶层 name;domain/action/args 齐备
    expect(sent).toHaveLength(1);
    expect(sent[0]!.point).toBe("command");
    expect(sent[0]!.action).toBe("execute");
    expect(sent[0]!.correlationId).toBe("fixed-1");
    expect(sent[0]!.payload).toEqual({ domain: "demo", action: "increment", args: { by: 1 } });
    expect((sent[0]!.payload as Record<string, unknown>).name).toBeUndefined();
    // resolve 为 SurfaceCommandResult
    expect(resolved).toEqual({ domain: "demo", action: "increment", ok: true, data: { count: 1 } });
  });

  it("run 超时/发送失败 → 归一化为 ok:false(不抛)", async () => {
    const { client, connection } = setup();
    const bus = createUiRpcBus({
      send: async () => {
        throw new Error("network down");
      },
      subscribeResponse: () => () => undefined,
    });
    const { result } = renderHook(() =>
      useSurface<unknown>("demo", { sessionId: "s1", connection, client, bus, commandNames: [] }),
    );
    let res: import("@blksails/pi-web-protocol").SurfaceCommandResult | undefined;
    await act(async () => {
      res = await result.current.run("x");
    });
    expect(res!.ok).toBe(false);
    expect(res!.error?.code).toBe("SEND_FAILED");
  });

  it("available:注入 commandNames 含 surface:demo → true;否则 false", () => {
    const { client, connection } = setup();
    const yes = renderHook(() =>
      useSurface("demo", {
        sessionId: "s1",
        connection,
        client,
        commandNames: ["help", "surface:demo"],
      }),
    );
    expect(yes.result.current.available).toBe(true);

    const no = renderHook(() =>
      useSurface("demo", { sessionId: "s1", connection, client, commandNames: ["help"] }),
    );
    expect(no.result.current.available).toBe(false);
  });

  it("available:经 getCommands 拉取探针(未注入 commandNames)", async () => {
    const { client, connection } = setup({
      commands: [{ name: "surface:demo", source: "extension" }],
    });
    const { result } = renderHook(() =>
      useSurface("demo", { sessionId: "s1", connection, client }),
    );
    await waitFor(() => expect(result.current.available).toBe(true));
  });
});

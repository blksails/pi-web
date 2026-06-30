/**
 * 单元:useExtensionState(state-injection-bridge, Task 3.4)。
 *  - 下行 control:state 帧到达 → hook 返回新值并重渲
 *  - setValue → POST /sessions/:id/state(setState)
 *  - 多组件订阅同一 key 读到一致值
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useExtensionState } from "../../src/hooks/use-extension-state.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

function setup() {
  const calls: { url: string; body: unknown }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return makeJsonResponse({ ok: true });
  }) as unknown as typeof fetch;
  const client = createPiClient("http://api.test", f);
  const connection = new PiSessionConnection({
    baseUrl: "http://api.test",
    sessionId: "s1",
    fetchImpl: f,
  });
  return { client, connection, calls };
}

describe("useExtensionState", () => {
  it("下行 control:state 帧到达后返回新值(3.2)", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useExtensionState<number>("count", { sessionId: "s1", connection, client }),
    );
    expect(result.current[0]).toBeUndefined();
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "state",
        key: "count",
        value: 7,
        rev: 0,
      });
    });
    await waitFor(() => expect(result.current[0]).toBe(7));
  });

  it("setValue 经 POST /sessions/:id/state 写回(6.3)", async () => {
    const { client, connection, calls } = setup();
    const { result } = renderHook(() =>
      useExtensionState<number>("count", { sessionId: "s1", connection, client }),
    );
    await act(async () => {
      await result.current[1](42);
    });
    const stateCall = calls.find((c) => c.url.endsWith("/sessions/s1/state"));
    expect(stateCall).toBeDefined();
    expect(stateCall!.body).toEqual({ key: "count", value: 42, op: "set" });
  });

  it("remove 经写回端点发 delete", async () => {
    const { client, connection, calls } = setup();
    const { result } = renderHook(() =>
      useExtensionState<number>("k", { sessionId: "s1", connection, client }),
    );
    await act(async () => {
      await result.current[2].remove();
    });
    const stateCall = calls.find((c) => c.url.endsWith("/sessions/s1/state"));
    expect(stateCall!.body).toMatchObject({ key: "k", op: "delete" });
  });

  it("多组件订阅同一 key 读到一致值(6.4)", async () => {
    const { client, connection } = setup();
    const a = renderHook(() =>
      useExtensionState<string>("mode", { sessionId: "s1", connection, client }),
    );
    const b = renderHook(() =>
      useExtensionState<string>("mode", { sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "state",
        key: "mode",
        value: "edit",
        rev: 0,
      });
    });
    await waitFor(() => expect(a.result.current[0]).toBe("edit"));
    expect(b.result.current[0]).toBe("edit");
  });
});

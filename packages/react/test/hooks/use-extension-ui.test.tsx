import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useExtensionUI } from "../../src/hooks/use-extension-ui.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";
import type { RpcExtensionUIRequest } from "@pi-web/protocol";

function extReq(id: string): RpcExtensionUIRequest {
  return {
    type: "extension_ui_request",
    id,
    method: "confirm",
    title: "t",
    message: "m",
  };
}

function setup(respondOk = true) {
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/ui-response"))
      return respondOk
        ? makeJsonResponse({ ok: true })
        : makeJsonResponse({ message: "fail" }, 500);
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

describe("useExtensionUI", () => {
  it("surfaces enqueued extension UI requests in arrival order (FIFO)", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: extReq("a"),
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: extReq("b"),
      });
    });
    await waitFor(() => expect(result.current.queue).toHaveLength(2));
    expect(result.current.queue.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.current?.id).toBe("a");
  });

  it("respond posts to /ui-response and dequeues on success", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: extReq("a"),
      });
    });
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    await act(async () => {
      await result.current.respond("a", {
        type: "extension_ui_response",
        id: "a",
        confirmed: true,
      });
    });
    await waitFor(() => expect(result.current.queue).toHaveLength(0));
    expect(result.current.error).toBeUndefined();
  });

  it("retains the item and exposes error when respond fails (retryable)", async () => {
    const { client, connection } = setup(false);
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: extReq("a"),
      });
    });
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    await act(async () => {
      await expect(
        result.current.respond("a", {
          type: "extension_ui_response",
          id: "a",
          confirmed: true,
        }),
      ).rejects.toBeTruthy();
    });
    expect(result.current.queue).toHaveLength(1); // 保留
    expect(result.current.error).toBeDefined();
  });
});

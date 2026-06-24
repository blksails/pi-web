import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useExtensionUI } from "../../src/hooks/use-extension-ui.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";
import type { RpcExtensionUIRequest } from "@blksails/pi-web-protocol";

function extReq(id: string): RpcExtensionUIRequest {
  return {
    type: "extension_ui_request",
    id,
    method: "confirm",
    title: "t",
    message: "m",
  };
}

function notifyReq(
  id: string,
  message: string,
  notifyType?: "info" | "warning" | "error",
): RpcExtensionUIRequest {
  return {
    type: "extension_ui_request",
    id,
    method: "notify",
    message,
    notifyType,
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

  it("exposes ambient state from the snapshot (notifications/statuses/widgets/title/editorText)", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: notifyReq("n1", "hello", "warning"),
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: {
          type: "extension_ui_request",
          id: "x1",
          method: "setStatus",
          statusKey: "branch",
          statusText: "main",
        },
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: {
          type: "extension_ui_request",
          id: "x2",
          method: "setWidget",
          widgetKey: "w",
          widgetLines: ["l1", "l2"],
          widgetPlacement: "belowEditor",
        },
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: {
          type: "extension_ui_request",
          id: "x3",
          method: "setTitle",
          title: "Session A",
        },
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: {
          type: "extension_ui_request",
          id: "x4",
          method: "set_editor_text",
          text: "draft",
        },
      });
    });
    await waitFor(() =>
      expect(result.current.notifications).toHaveLength(1),
    );
    expect(result.current.notifications[0]).toMatchObject({
      id: "n1",
      message: "hello",
      notifyType: "warning",
    });
    expect(result.current.statuses).toEqual({ branch: "main" });
    expect(result.current.widgets).toEqual({
      w: { lines: ["l1", "l2"], placement: "belowEditor" },
    });
    expect(result.current.title).toBe("Session A");
    expect(result.current.editorText).toMatchObject({ text: "draft", seq: 1 });
    // 推送类不入交互队列(防阻塞回归)。
    expect(result.current.queue).toHaveLength(0);
  });

  it("dismissNotification removes the notification through the store", async () => {
    const { client, connection } = setup();
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection, client }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: notifyReq("n1", "a"),
      });
      connection.controlStore.applyControlFrame({
        control: "extension-ui",
        request: notifyReq("n2", "b"),
      });
    });
    await waitFor(() =>
      expect(result.current.notifications).toHaveLength(2),
    );
    act(() => {
      result.current.dismissNotification("n1");
    });
    await waitFor(() =>
      expect(result.current.notifications).toHaveLength(1),
    );
    expect(result.current.notifications.map((n) => n.id)).toEqual(["n2"]);
  });

  it("falls back to empty ambient state and no-op dismiss without a connection", () => {
    const { client } = setup();
    const { result } = renderHook(() =>
      useExtensionUI({ sessionId: "s1", connection: undefined, client }),
    );
    expect(result.current.notifications).toEqual([]);
    expect(result.current.statuses).toEqual({});
    expect(result.current.widgets).toEqual({});
    expect(result.current.title).toBeUndefined();
    expect(result.current.editorText).toBeUndefined();
    // 无连接时引用稳定。
    const first = result.current.notifications;
    expect(() => result.current.dismissNotification("nope")).not.toThrow();
    expect(result.current.notifications).toBe(first);
  });
});

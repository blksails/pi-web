import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePiSession } from "../../src/hooks/use-pi-session.js";
import { makeJsonResponse, makeSseResponse } from "../fixtures/sse-samples.js";

function makeFetch(createOk: boolean): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/sessions") && init?.method === "POST") {
      return createOk
        ? makeJsonResponse({ sessionId: "sess-1" })
        : makeJsonResponse({ code: "E", message: "denied" }, 403);
    }
    if (url.endsWith("/stream")) return makeSseResponse("");
    return makeJsonResponse({ ok: true });
  }) as unknown as typeof fetch;
}

describe("usePiSession state machine", () => {
  it("transitions connecting → open and exposes sessionId + transport", async () => {
    const { result } = renderHook(() =>
      usePiSession({
        baseUrl: "http://api.test",
        fetch: makeFetch(true),
        create: { source: "claude" },
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("open"));
    expect(result.current.sessionId).toBe("sess-1");
    expect(result.current.transport).toBeDefined();
    expect(result.current.error).toBeUndefined();
  });

  it("exposes an error state on create failure without throwing", async () => {
    const { result } = renderHook(() =>
      usePiSession({
        baseUrl: "http://api.test",
        fetch: makeFetch(false),
        create: { source: "claude" },
      }),
    );
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.status).toBe("closed");
    expect(result.current.transport).toBeUndefined();
  });

  it("closes the connection on unmount (no dangling subscription)", async () => {
    const fetch = makeFetch(true);
    const { result, unmount } = renderHook(() =>
      usePiSession({
        baseUrl: "http://api.test",
        fetch,
        create: { source: "claude" },
      }),
    );
    await waitFor(() => expect(result.current.connection).toBeDefined());
    const conn = result.current.connection;
    const closeSpy = vi.spyOn(conn!, "close");
    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("explicit close() moves to closed", async () => {
    const { result } = renderHook(() =>
      usePiSession({
        baseUrl: "http://api.test",
        fetch: makeFetch(true),
        create: { source: "claude" },
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => result.current.close());
    await waitFor(() => expect(result.current.status).toBe("closed"));
  });
});

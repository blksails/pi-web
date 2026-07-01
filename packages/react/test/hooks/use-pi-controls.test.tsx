import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePiControls } from "../../src/hooks/use-pi-controls.js";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(ok = true): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (!ok) return makeJsonResponse({ code: "E", message: "fail" }, 500);
    if (url.endsWith("/stats")) return makeJsonResponse({ stats: { t: 1 } });
    if (url.endsWith("/commands"))
      return makeJsonResponse({ commands: [{ name: "help", description: "h" }] });
    if (url.endsWith("/clear_queue"))
      return makeJsonResponse({ steering: ["s"], followUp: ["f"] });
    return makeJsonResponse({ ok: true });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("usePiControls", () => {
  it("each control operation calls its endpoint and reflects pending→success", async () => {
    const { fetch, calls } = mockFetch();
    const client = createPiClient("http://api.test", fetch);
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client }),
    );

    await act(async () => {
      await result.current.setModel({ provider: "p", modelId: "m" });
    });
    expect(calls.at(-1)?.url).toBe("http://api.test/sessions/s1/model");
    expect(result.current.state.setModel).toEqual({
      pending: false,
      error: undefined,
    });

    await act(async () => {
      await result.current.abort();
    });
    expect(calls.at(-1)?.url).toBe("http://api.test/sessions/s1/abort");

    await act(async () => {
      await result.current.steer({ message: "go" });
    });
    expect(calls.at(-1)?.url).toBe("http://api.test/sessions/s1/steer");
  });

  it("getStats / getCommands populate state", async () => {
    const { fetch } = mockFetch();
    const client = createPiClient("http://api.test", fetch);
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.getStats();
      await result.current.getCommands();
    });
    await waitFor(() => expect(result.current.stats).toEqual({ t: 1 }));
    expect(result.current.commands).toEqual([
      { name: "help", description: "h" },
    ]);
  });

  it("exposes error state when an operation fails", async () => {
    const { fetch } = mockFetch(false);
    const client = createPiClient("http://api.test", fetch);
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client }),
    );
    await act(async () => {
      await expect(result.current.abort()).rejects.toBeTruthy();
    });
    expect(result.current.state.abort.error).toBeDefined();
    expect(result.current.state.abort.pending).toBe(false);
  });

  it("clearQueue calls /clear_queue and returns cleared text (message-queue-ui)", async () => {
    const { fetch, calls } = mockFetch();
    const client = createPiClient("http://api.test", fetch);
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client }),
    );
    let cleared: { steering: string[]; followUp: string[] } | undefined;
    await act(async () => {
      cleared = await result.current.clearQueue();
    });
    expect(calls.at(-1)?.url).toBe("http://api.test/sessions/s1/clear_queue");
    expect(calls.at(-1)?.method).toBe("POST");
    expect(cleared).toEqual({ steering: ["s"], followUp: ["f"] });
  });

  it("exposes queue snapshot from control:queue frame (message-queue-ui)", async () => {
    const { fetch } = mockFetch();
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client, connection }),
    );
    expect(result.current.queue).toEqual({ steering: [], followUp: [] });
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "queue",
        steering: ["a", "b"],
        followUp: ["c"],
      } as never);
    });
    await waitFor(() =>
      expect(result.current.queue).toEqual({
        steering: ["a", "b"],
        followUp: ["c"],
      }),
    );
  });

  it("merges SSE bypass stats from the control store", async () => {
    const { fetch } = mockFetch();
    const client = createPiClient("http://api.test", fetch);
    const connection = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: fetch,
    });
    const { result } = renderHook(() =>
      usePiControls({ sessionId: "s1", client, connection }),
    );
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "stats",
        stats: { sse: true },
      } as never);
    });
    await waitFor(() => expect(result.current.stats).toEqual({ sse: true }));
  });
});

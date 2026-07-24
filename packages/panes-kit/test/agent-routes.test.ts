import { describe, expect, it, vi } from "vitest";
import { createAgentRouteClient, PaneHostError } from "../src/index.js";

describe("agent route adapter", () => {
  it("preserves a successful route envelope", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, data: { revision: 2 } }), {
      headers: { "content-type": "application/json" },
    }));
    const client = createAgentRouteClient({ baseUrl: "/api", sessionId: "s/1", fetch: fetch as typeof globalThis.fetch });
    await expect(client.query("pane-data", { pane: "files" })).resolves.toEqual({ ok: true, data: { revision: 2 } });
    expect(fetch.mock.calls[0]?.[0]).toContain("sessions/s%2F1/agent-routes/pane-data?pane=files");
  });

  it("maps a stale session 404 to HOST_UNAVAILABLE instead of a bare HTTP error", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      error: { code: "SESSION_NOT_FOUND", message: "missing" },
    }), { status: 404, headers: { "content-type": "application/json" } }));
    const client = createAgentRouteClient({ baseUrl: "/api", sessionId: "stale", fetch: fetch as typeof globalThis.fetch });
    const error = await client.query("pane-data").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PaneHostError);
    expect(error).toMatchObject({ code: "HOST_UNAVAILABLE", status: 404, message: "当前会话已失效，请重新打开 Agent 会话" });
  });

  it("rejects oversized responses before parsing", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response("{}", { headers: { "content-length": "5000" } }));
    const client = createAgentRouteClient({ baseUrl: "/api", sessionId: "s1", fetch: fetch as typeof globalThis.fetch });
    await expect(client.query("pane-data", {}, 100)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("maps HTTP 409 to REVISION_CONFLICT with the upstream message", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      error: { code: "REVISION_CONFLICT", message: "revision 3 expected" },
    }), { status: 409, headers: { "content-type": "application/json" } }));
    const client = createAgentRouteClient({ baseUrl: "/api", sessionId: "s1", fetch: fetch as typeof globalThis.fetch });
    await expect(client.mutate("pane-data", { revision: 2 })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409,
      message: "revision 3 expected",
    });
  });

  it("maps invalid JSON to ROUTE_FAILED instead of leaking a parse error", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response("<html>proxy error</html>", { status: 200 }));
    const client = createAgentRouteClient({ baseUrl: "/api", sessionId: "s1", fetch: fetch as typeof globalThis.fetch });
    await expect(client.query("pane-data")).rejects.toMatchObject({ code: "ROUTE_FAILED", status: 200 });
  });

  it("retries ROUTE_NOT_FOUND during runner assembly and then succeeds", async () => {
    let attempt = 0;
    const fetch = vi.fn(async (_input: RequestInfo | URL) => ++attempt < 3
      ? new Response(JSON.stringify({ error: { code: "ROUTE_NOT_FOUND", message: "not ready" } }), { status: 404 })
      : new Response(JSON.stringify({ ok: true, data: "ready" })));
    const client = createAgentRouteClient({
      baseUrl: "/api",
      sessionId: "starting",
      fetch: fetch as typeof globalThis.fetch,
      readinessRetry: { attempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
    });
    await expect(client.query("pane-data")).resolves.toEqual({ ok: true, data: "ready" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

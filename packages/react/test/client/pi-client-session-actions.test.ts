/**
 * session-list-item-actions — PiClient 会话管理方法
 * (deleteSessionHistory / renameSession / listSessionFavorites / setSessionFavorites)。
 */
import { describe, it, expect } from "vitest";
import { createPiClient } from "../../src/client/pi-client.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

interface Captured {
  url: string;
  method: string;
  body?: string;
}

function mockFetch(response: Response): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return Promise.resolve(response.clone());
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

describe("PiClient — session actions", () => {
  it("deleteSessionHistory → POST /sessions/delete with sessionId body", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    const res = await client.deleteSessionHistory("s1");
    expect(calls[0]!.url).toBe("http://api.test/sessions/delete");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toContain("s1");
    expect(res.ok).toBe(true);
  });

  it("renameSession → POST /sessions/rename and parses response", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sessionId: "s1", name: "New" }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.renameSession("s1", "New");
    expect(calls[0]!.url).toBe("http://api.test/sessions/rename");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toContain("New");
    expect(res).toEqual({ sessionId: "s1", name: "New" });
  });

  it("listSessionFavorites → GET /sessions/favorites and parses", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sessionIds: ["a", "b"] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.listSessionFavorites();
    expect(calls[0]!.url).toBe("http://api.test/sessions/favorites");
    expect(calls[0]!.method).toBe("GET");
    expect(res.sessionIds).toEqual(["a", "b"]);
  });

  it("setSessionFavorites → POST /sessions/favorites with body and echoes", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sessionIds: ["a"] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.setSessionFavorites({ sessionIds: ["a"] });
    expect(calls[0]!.url).toBe("http://api.test/sessions/favorites");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toContain("a");
    expect(res.sessionIds).toEqual(["a"]);
  });
});

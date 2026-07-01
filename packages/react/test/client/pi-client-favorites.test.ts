/**
 * sidebar-launcher-rail — PiClient listSessions(q) + listFavorites/setFavorites 测试。
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

describe("PiClient — search + favorites", () => {
  it("listSessions 把 q 序列化进 URL", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sessions: [], scope: "cwd", globalEnabled: false }),
    );
    const client = createPiClient("http://api.test", fetch);
    await client.listSessions({ scope: "cwd", q: "auth" });
    expect(calls[0]!.url).toContain("q=auth");
  });

  it("listFavorites → GET /agent-sources/favorites 并解析", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ favorites: [{ source: "/a", name: "A" }] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.listFavorites();
    expect(calls[0]!.url).toBe("http://api.test/agent-sources/favorites");
    expect(calls[0]!.method).toBe("GET");
    expect(res.favorites).toEqual([{ source: "/a", name: "A" }]);
  });

  it("setFavorites → PUT /agent-sources/favorites 带 body 并解析回显", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ favorites: [{ source: "/b", name: "B" }] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.setFavorites({
      favorites: [{ source: "/b", name: "B" }],
    });
    expect(calls[0]!.url).toBe("http://api.test/agent-sources/favorites");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toContain("/b");
    expect(res.favorites).toEqual([{ source: "/b", name: "B" }]);
  });
});

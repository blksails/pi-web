/**
 * agent-sources-list — PiClient.listAgentSources REST 客户端测试。
 *
 * 验证:
 *  - GET /agent-sources 无参数时不带查询串。
 *  - limit / cursor 被正确序列化进 URL。
 *  - 响应 { sources, nextCursor? } 经 schema 解析后返回。
 */
import { describe, it, expect } from "vitest";
import { createPiClient } from "../../src/client/pi-client.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";
import type { AgentSourceItem } from "@blksails/pi-web-protocol";

interface Captured {
  url: string;
  method: string;
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
    });
    return Promise.resolve(response.clone());
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

const sampleItem = (id: string): AgentSourceItem => ({
  id,
  source: id,
  name: id,
  kind: "dir",
  origin: "scan",
  mode: "custom",
});

describe("PiClient.listAgentSources", () => {
  it("无参数 → GET /agent-sources(不带查询串)并解析 sources", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sources: [sampleItem("/a"), sampleItem("/b")] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.listAgentSources({});
    expect(calls[0]!.url).toBe("http://api.test/agent-sources");
    expect(calls[0]!.method).toBe("GET");
    expect(res.sources.map((s) => s.id)).toEqual(["/a", "/b"]);
  });

  it("limit / cursor 序列化进 URL", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sources: [], nextCursor: "next" }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.listAgentSources({ limit: 5, cursor: "c1" });
    expect(calls[0]!.url).toContain("limit=5");
    expect(calls[0]!.url).toContain("cursor=c1");
    expect(res.nextCursor).toBe("next");
  });
});

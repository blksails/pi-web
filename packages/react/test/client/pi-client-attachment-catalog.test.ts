/**
 * createPiClient.materializeCatalogEntry(spec agent-attachment-catalog,任务 5.1;
 * Req 3.2, 4.2)。
 */
import { describe, it, expect, vi } from "vitest";
import { createPiClient } from "../../src/client/pi-client.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

interface Captured {
  url: string;
  method: string;
}

function mockFetch(response: Response): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return response.clone();
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const ATTACHMENT_FIXTURE = {
  id: "att_abc123",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 10,
  origin: "tool-output" as const,
  sessionId: "s-1",
  createdAt: new Date().toISOString(),
};

describe("createPiClient.materializeCatalogEntry", () => {
  it("POSTs to /sessions/:id/attachment-catalog/:entryId/materialize", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({
        attachmentId: "att_abc123",
        attachment: ATTACHMENT_FIXTURE,
        displayUrl: "/attachments/att_abc123/raw?exp=1&sig=abc",
      }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.materializeCatalogEntry("s 1", "entry 1");
    expect(calls[0]?.url).toBe(
      "http://api.test/sessions/s%201/attachment-catalog/entry%201/materialize",
    );
    expect(calls[0]?.method).toBe("POST");
    expect(res.attachmentId).toBe("att_abc123");
    expect(res.attachment.id).toBe("att_abc123");
  });

  it("根相对 displayUrl 前缀 baseUrl(与 getCompletion previewUrl 同策略)", async () => {
    const { fetch } = mockFetch(
      makeJsonResponse({
        attachmentId: "att_abc123",
        attachment: ATTACHMENT_FIXTURE,
        displayUrl: "/attachments/att_abc123/raw?exp=1&sig=abc",
      }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.materializeCatalogEntry("s-1", "entry-1");
    expect(res.displayUrl).toBe(
      "http://api.test/attachments/att_abc123/raw?exp=1&sig=abc",
    );
  });

  it("已带 baseUrl 前缀的 displayUrl 不重复前缀", async () => {
    const { fetch } = mockFetch(
      makeJsonResponse({
        attachmentId: "att_abc123",
        attachment: ATTACHMENT_FIXTURE,
        displayUrl: "http://api.test/attachments/att_abc123/raw?exp=1&sig=abc",
      }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.materializeCatalogEntry("s-1", "entry-1");
    expect(res.displayUrl).toBe(
      "http://api.test/attachments/att_abc123/raw?exp=1&sig=abc",
    );
  });

  it("失败(非 2xx)经 PiHttpError 向上抛", async () => {
    const { fetch } = mockFetch(
      new Response(JSON.stringify({ error: { code: "ENTRY_NOT_FOUND", message: "gone" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createPiClient("http://api.test", fetch);
    await expect(client.materializeCatalogEntry("s-1", "ghost")).rejects.toThrow();
  });
});

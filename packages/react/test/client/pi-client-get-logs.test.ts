/**
 * Task 3.2 — getLogs REST client tests.
 *
 * Verifies:
 *  - GET /sessions/:id/logs is called correctly (no query params when none supplied).
 *  - Query params level, limit, since are serialised into the URL.
 *  - The response { entries: LogEntry[] } is parsed and entries are returned.
 *  - URL-encoding of session ids with spaces works.
 *  - 404 throws PiHttpError (same as other endpoints).
 */
import { describe, it, expect, vi } from "vitest";
import { createPiClient } from "../../src/client/pi-client.js";
import { PiHttpError } from "../../src/client/errors.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";
import type { LogEntry } from "@blksails/pi-web-logger";

// ── mock helpers ───────────────────────────────────────────────────────────────

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

function sampleEntry(id: string): LogEntry {
  return { id, level: "info", ns: "agent:demo", msg: `msg ${id}`, ts: 1000 };
}

// ── getLogs ────────────────────────────────────────────────────────────────────

describe("createPiClient — getLogs", () => {
  it("GETs /sessions/:id/logs with no query params when query is omitted", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ entries: [sampleEntry("e-1")] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const result = await client.getLogs("sess-1");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("http://api.test/sessions/sess-1/logs");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("e-1");
  });

  it("GETs /sessions/:id/logs with no query params when query is empty object", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("sess-1", {});
    expect(calls[0]!.url).toBe("http://api.test/sessions/sess-1/logs");
  });

  it("serialises level query param", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("s1", { level: "warn" });
    expect(calls[0]!.url).toBe("http://api.test/sessions/s1/logs?level=warn");
  });

  it("serialises limit query param", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("s1", { limit: 50 });
    expect(calls[0]!.url).toBe("http://api.test/sessions/s1/logs?limit=50");
  });

  it("serialises since query param", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("s1", { since: 1700000000000 });
    expect(calls[0]!.url).toBe("http://api.test/sessions/s1/logs?since=1700000000000");
  });

  it("serialises all three query params together", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("s1", { level: "error", limit: 100, since: 123456 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/sessions/s1/logs");
    expect(url.searchParams.get("level")).toBe("error");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("since")).toBe("123456");
  });

  it("URL-encodes session ids with spaces", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    await client.getLogs("my session");
    expect(calls[0]!.url).toBe("http://api.test/sessions/my%20session/logs");
  });

  it("parses and returns all entries from the response", async () => {
    const entries = [sampleEntry("a-1"), sampleEntry("a-2"), sampleEntry("a-3")];
    const { fetch } = mockFetch(makeJsonResponse({ entries }));
    const client = createPiClient("http://api.test", fetch);
    const result = await client.getLogs("s1");
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("returns an empty array when entries is empty", async () => {
    const { fetch } = mockFetch(makeJsonResponse({ entries: [] }));
    const client = createPiClient("http://api.test", fetch);
    const result = await client.getLogs("s1");
    expect(result).toEqual([]);
  });

  it("404 throws PiHttpError", async () => {
    const { fetch } = mockFetch(makeJsonResponse({}, 404));
    const client = createPiClient("http://api.test", fetch);
    await expect(client.getLogs("s1")).rejects.toBeInstanceOf(PiHttpError);
    await expect(client.getLogs("s1")).rejects.toMatchObject({ status: 404 });
  });
});

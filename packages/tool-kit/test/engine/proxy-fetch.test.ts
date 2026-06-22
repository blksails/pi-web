import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFetch } from "../../src/engine/proxy-fetch.js";

describe("proxyFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses globalThis.fetch directly when no proxyUrl provided", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await proxyFetch("https://example.com/api");

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/api", undefined);
    expect(result).toBe(mockResponse);
  });

  it("uses globalThis.fetch when proxyUrl is empty string", async () => {
    const mockResponse = new Response("{}", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await proxyFetch("https://example.com/api", undefined, "");

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("falls through to globalThis.fetch for socks5 proxy (Wave 1 TODO)", async () => {
    // socks5 is not yet implemented in Wave 1; should fall through to direct fetch.
    const mockResponse = new Response("{}", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await proxyFetch("https://example.com/api", undefined, "socks5://proxy.local:1080");

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("passes init options to globalThis.fetch", async () => {
    const mockResponse = new Response("{}", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);
    const init: RequestInit = { method: "POST", body: "{}" };

    await proxyFetch("https://example.com/api", init);

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/api", init);
  });
});

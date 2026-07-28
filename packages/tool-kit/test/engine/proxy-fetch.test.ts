import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFetch } from "../../src/engine/proxy-fetch.js";

describe("proxyFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ★无代理分支自 2026-07-28 起会附加一个放宽超时的 undici dispatcher(undici 默认
  // headersTimeout 300s 会掐断图像端点,见 proxy-fetch.ts TRANSPORT_TIMEOUT_MS)。
  // **调用者仍是 globalThis.fetch**(这是硬约束:改调 undici.fetch 会让所有 spy 失效、
  // 测试打真实网络),故此处断言从「逐字 init」放宽为「URL 精确 + 带 dispatcher」。
  it("uses globalThis.fetch directly when no proxyUrl provided (with relaxed-timeout dispatcher)", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await proxyFetch("https://example.com/api");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe("https://example.com/api");
    expect((calledInit as { dispatcher?: unknown }).dispatcher).toBeDefined();
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

  it("passes init options to globalThis.fetch (原字段逐字保留,仅多出 dispatcher)", async () => {
    const mockResponse = new Response("{}", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);
    const init: RequestInit = { method: "POST", body: "{}" };

    await proxyFetch("https://example.com/api", init);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });
});

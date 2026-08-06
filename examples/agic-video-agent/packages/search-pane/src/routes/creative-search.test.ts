import { afterEach, describe, expect, it, vi } from "vitest";
import { creativeSearchHandler } from "./creative-search.js";

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  vi.unstubAllGlobals();
});

describe("creative-search route", () => {
  it("平台缺席时稳定降级", async () => {
    process.env = {};
    await expect(
      creativeSearchHandler({ body: { query: "海报" } } as never),
    ).resolves.toEqual({ error: "platform_unavailable", items: [] });
  });

  it("经本地 Webapp BFF 返回混合结果", async () => {
    process.env = {
      PI_LABS_WEBAPP_URL: "http://127.0.0.1:4000",
      PI_WEB_DESKTOP_CREDENTIAL: "token",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "creative-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      creativeSearchHandler({ body: { query: "海报", limit: 3 } } as never),
    ).resolves.toEqual({ items: [{ id: "creative-1" }] });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:4000/api/agent/materials"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          op: "similar-search",
          text: "海报",
          limit: 3,
        }),
      }),
    );
  });

  it("以图搜图透传图片 data URI", async () => {
    process.env = {
      PI_LABS_WEBAPP_URL: "http://127.0.0.1:4000",
      PI_WEB_DESKTOP_CREDENTIAL: "token",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await creativeSearchHandler({
      body: { imageDataUri: "data:image/jpeg;base64,AA==", limit: 8 },
    } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        body: JSON.stringify({
          op: "similar-search",
          image_url: "data:image/jpeg;base64,AA==",
          limit: 8,
        }),
      }),
    );
  });
});

/**
 * 单元:createAigcModelsRoute —— GET /aigc/models 只读模型目录(aigc-tool-settings)。
 * 直接以最小 RequestContext 调 handler(避开 createPiWebHandler alias 陷阱)。
 */
import { describe, it, expect } from "vitest";
import { createAigcModelsRoute } from "../../src/aigc-settings/index.js";

function ctxOf(req: Request) {
  return { req, auth: {} as never, url: new URL(req.url) };
}

describe("createAigcModelsRoute", () => {
  it("GET /aigc/models → { models: [{model,label,provider}] }(非空,含已知模型)", async () => {
    const routes = createAigcModelsRoute();
    const get = routes.find((r) => r.method === "GET" && r.path === "/aigc/models");
    expect(get).toBeDefined();
    const res = await get!.handler(ctxOf(new Request("http://x/aigc/models")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: { model: string; label: string; provider: string }[];
    };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    const ids = body.models.map((m) => m.model);
    expect(ids).toContain("gpt-image-2");
    // 每项形态完整
    for (const m of body.models) {
      expect(typeof m.model).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(typeof m.provider).toBe("string");
    }
  });
});

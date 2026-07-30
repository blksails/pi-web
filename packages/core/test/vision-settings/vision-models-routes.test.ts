/**
 * 单元:createVisionModelsRoute —— GET /vision/models(spec canvas-vision-readout,Req 3.1/3.6)。
 * 直接以最小 RequestContext 调 handler(避开 createPiWebHandler alias 陷阱)。
 *
 * 取数经 deps 注入,故本测试**不加载 pi SDK**。
 */
import { describe, it, expect, vi } from "vitest";
import { createVisionModelsRoute } from "../../src/vision-settings/vision-models-routes.js";
import type { VisionModelOptions } from "../../src/vision-settings/vision-model-options.types.js";

function ctxOf(req: Request) {
  return { req, auth: {} as never, url: new URL(req.url) };
}

function routeOf(listModels: () => VisionModelOptions) {
  const routes = createVisionModelsRoute({ listModels });
  const get = routes.find((r) => r.method === "GET" && r.path === "/vision/models");
  expect(get).toBeDefined();
  return get!;
}

const SAMPLE: VisionModelOptions = {
  models: [
    { value: "apiservices/gpt-5.4", label: "GPT-5.4", provider: "apiservices" },
    { value: "apiservices/gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "apiservices" },
  ],
};

describe("createVisionModelsRoute", () => {
  it("GET /vision/models → 200 + { models: [{value,label,provider}] }(3.1)", async () => {
    const res = await routeOf(() => SAMPLE).handler(ctxOf(new Request("http://x/vision/models")));

    expect(res.status).toBe(200);
    const body = (await res.json()) as VisionModelOptions;
    expect(body.models).toHaveLength(2);
    expect(body.models[0]).toEqual({
      value: "apiservices/gpt-5.4",
      label: "GPT-5.4",
      provider: "apiservices",
    });
  });

  it("value 形如 provider/id —— 可直接填进工具的 model 参数", async () => {
    const res = await routeOf(() => SAMPLE).handler(ctxOf(new Request("http://x/vision/models")));
    const body = (await res.json()) as VisionModelOptions;
    for (const m of body.models) {
      expect(m.value).toMatch(/^[^/]+\/.+$/);
      expect(m.value.startsWith(`${m.provider}/`)).toBe(true);
    }
  });

  it("返回体不含任何凭据 / baseUrl 字段(端点是公开只读的)", async () => {
    const res = await routeOf(() => SAMPLE).handler(ctxOf(new Request("http://x/vision/models")));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("baseUrl");
    expect(raw).not.toContain("sk-");
  });

  it("取数抛错 → 200 + 空清单(降级,不把 500 透给前端;3.6)", async () => {
    const listModels = vi.fn(() => {
      throw new Error("models.json 损坏");
    });
    const res = await routeOf(listModels).handler(ctxOf(new Request("http://x/vision/models")));

    expect(res.status).toBe(200);
    // jsonResponse 会附加 protocolVersion,故只断言 models 字段。
    expect(await res.json()).toMatchObject({ models: [] });
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("空清单 → 200 + { models: [] }(不是 404)", async () => {
    const res = await routeOf(() => ({ models: [] })).handler(
      ctxOf(new Request("http://x/vision/models")),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ models: [] });
  });
});

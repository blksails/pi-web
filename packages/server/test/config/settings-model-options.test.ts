/**
 * GET /config/models 数据端点:供 settings 的 provider/model 可搜索下拉(widget)取数。
 * 覆盖正常返回、空集回退(无接缝/抛错)、以及路由顺序(不被 /config/:domain 吃成未知域)。
 */
import { describe, it, expect } from "vitest";
import { createConfigRoutes } from "../../src/config/config-routes.js";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import type { ModelOptions } from "../../src/config/model-options.types.js";

const SAMPLE: ModelOptions = {
  providers: ["apiservices", "openrouter"],
  models: [
    { provider: "apiservices", id: "gpt-5.4", name: "GPT-5.4" },
    { provider: "openrouter", id: "anthropic/claude-sonnet-4.6", name: "Claude" },
  ],
};

function makeHandler(listModelOptions?: () => ModelOptions | Promise<ModelOptions>) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createConfigRoutes({ listModelOptions });
  return createPiWebHandler({ manager, store, routes, authResolver: () => ({ anonymous: true }) });
}

async function getModels(handler: ReturnType<typeof makeHandler>) {
  const res = await handler(new Request("http://x/config/models"));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text()) as { providers?: string[]; models?: unknown[] };
}

describe("GET /config/models", () => {
  it("返回注入的 provider/模型清单", async () => {
    const body = await getModels(makeHandler(() => SAMPLE));
    expect(body.providers).toEqual(["apiservices", "openrouter"]);
    expect(body.models).toHaveLength(2);
    expect(body.models).toContainEqual({
      provider: "apiservices",
      id: "gpt-5.4",
      name: "GPT-5.4",
    });
  });

  it("未提供接缝时返回空集(前端回退文本输入)", async () => {
    const body = await getModels(makeHandler(undefined));
    expect(body.providers).toEqual([]);
    expect(body.models).toEqual([]);
  });

  it("取数抛错时返回空集,不报错", async () => {
    const body = await getModels(
      makeHandler(() => {
        throw new Error("registry boom");
      }),
    );
    expect(body.providers).toEqual([]);
    expect(body.models).toEqual([]);
  });

  it("支持异步接缝", async () => {
    const body = await getModels(makeHandler(async () => SAMPLE));
    expect(body.providers).toEqual(["apiservices", "openrouter"]);
  });

  it("/config/models 不被 /config/:domain 吃成未知域 404", async () => {
    // 关键:路由顺序保证 models 端点优先于 :domain 通配。
    const res = await makeHandler(() => SAMPLE)(new Request("http://x/config/models"));
    expect(res.status).toBe(200);
    // 反证:未知域仍 404。
    const res404 = await makeHandler(() => SAMPLE)(new Request("http://x/config/bogus"));
    expect(res404.status).toBe(404);
  });
});

/**
 * 两个展示出口对可见性配置的遵守(provider-visibility-config 任务 4.1;
 * Req 6.1, 6.2, 6.3, 7.1, 7.3)。
 *
 * 覆盖的是**出口层的集成契约**,不重复测过滤器本身的逻辑(那在
 * `model-catalog/visibility-filter.test.ts`):
 *  - `GET /config/models` —— 装配层把过滤套在 `listModelOptions` 产出之后;
 *  - `GET /sessions/:id/models` —— 经 `readProviderVisibility` 注入接缝;
 *  - 两者与既有 `PI_WEB_HIDE_PROVIDERS`(**彻底禁用**,语义不同)叠加时互不干扰;
 *  - 未配置时行为与引入前一致(Req 7.1)。
 */
import { describe, expect, it } from "vitest";
import type { RpcResponse } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { createConfigRoutes } from "../../src/http/routes/config-routes.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";
import {
  applyProviderVisibility,
  type ProviderVisibilityConfig,
} from "../../src/model-catalog/visibility-filter.js";
import type { ModelOptions } from "../../src/config/model-options.types.js";

const CATALOG: ModelOptions = {
  providers: ["openrouter", "sufy"],
  models: [
    { provider: "openrouter", id: "gpt-4o", name: "GPT-4o", output: ["text"] },
    { provider: "openrouter", id: "claude-3", name: "Claude 3", output: ["text"] },
    { provider: "sufy", id: "sufy-image", name: "Sufy Image", output: ["image"] },
  ],
};

/** 复刻装配层(pi-handler)的出口形态:目录产出 → 套可见性过滤。 */
function makeCatalogHandler(
  visibility: ProviderVisibilityConfig | undefined,
): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createConfigRoutes({
    listModelOptions: (query) => {
      const filteredByType =
        query.output === undefined
          ? CATALOG
          : {
              providers: CATALOG.providers,
              models: CATALOG.models.filter((m) => m.output?.includes(query.output as never)),
            };
      return applyProviderVisibility(filteredByType, visibility);
    },
  });
  return createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => ({ anonymous: true }),
  });
}

function makeSessionHandler(
  visibility: ProviderVisibilityConfig | undefined,
): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  session.setResponse(
    () =>
      ({
        type: "response",
        command: "get_available_models",
        success: true,
        data: {
          models: [
            { provider: "openrouter", id: "gpt-4o" },
            { provider: "openrouter", id: "claude-3" },
            { provider: "sufy", id: "sufy-image" },
          ],
        },
      }) as unknown as RpcResponse,
  );
  store.create(asPiSession(session));
  return createPiWebHandler({
    manager,
    store,
    ...(visibility === undefined ? {} : { readProviderVisibility: () => visibility }),
  });
}

async function readModels(
  handler: (req: Request) => Promise<Response>,
  path: string,
): Promise<{ providers?: string[]; models: Array<{ provider: string; id: string }> }> {
  const res = await handler(new Request(`http://x${path}`, { method: "GET" }));
  expect(res.status).toBe(200);
  return (await res.json()) as never;
}

describe("GET /config/models — 部署级目录出口", () => {
  it("未配置时产出与引入前一致(Req 7.1)", async () => {
    const body = await readModels(makeCatalogHandler(undefined), "/config/models");
    expect(body.models.map((m) => m.id)).toEqual(["gpt-4o", "claude-3", "sufy-image"]);
    expect(body.providers).toEqual(["openrouter", "sufy"]);
  });

  it("隐藏 provider 后其模型不再列出,providers 同步收敛(Req 2.1)", async () => {
    const body = await readModels(
      makeCatalogHandler({ openrouter: { hidden: true } }),
      "/config/models",
    );
    expect(body.models.map((m) => m.id)).toEqual(["sufy-image"]);
    expect(body.providers).toEqual(["sufy"]);
  });

  it("勾掉模型后仅该模型消失,同 provider 其余保留(Req 4.2)", async () => {
    const body = await readModels(
      makeCatalogHandler({ openrouter: { hiddenModels: ["gpt-4o"] } }),
      "/config/models",
    );
    expect(body.models.map((m) => m.id)).toEqual(["claude-3", "sufy-image"]);
  });

  it("类型筛选与可见性叠加生效,而非互相覆盖(Req 6.3)", async () => {
    // 只要 text 输出的:本应是 gpt-4o + claude-3;再隐藏 gpt-4o → 只剩 claude-3。
    const body = await readModels(
      makeCatalogHandler({ openrouter: { hiddenModels: ["gpt-4o"] } }),
      "/config/models?output=text",
    );
    expect(body.models.map((m) => m.id)).toEqual(["claude-3"]);

    // 同一份配置下取 image:不受 openrouter 的勾选影响。
    const image = await readModels(
      makeCatalogHandler({ openrouter: { hiddenModels: ["gpt-4o"] } }),
      "/config/models?output=image",
    );
    expect(image.models.map((m) => m.id)).toEqual(["sufy-image"]);
  });
});

describe("GET /sessions/:id/models — 会话可用模型出口", () => {
  it("未注入可见性接缝时行为与引入前一致(Req 7.1)", async () => {
    const body = await readModels(makeSessionHandler(undefined), "/sessions/sess-1/models");
    expect(body.models.map((m) => m.id)).toEqual(["gpt-4o", "claude-3", "sufy-image"]);
  });

  it("隐藏 provider 后清单不再列出它(Req 6.2)", async () => {
    const body = await readModels(
      makeSessionHandler({ sufy: { hidden: true } }),
      "/sessions/sess-1/models",
    );
    expect(body.models.map((m) => m.id)).toEqual(["gpt-4o", "claude-3"]);
  });

  it("勾掉的模型不再列出,同 provider 其余保留(Req 4.2)", async () => {
    const body = await readModels(
      makeSessionHandler({ openrouter: { hiddenModels: ["claude-3"] } }),
      "/sessions/sess-1/models",
    );
    expect(body.models.map((m) => m.id)).toEqual(["gpt-4o", "sufy-image"]);
  });

  it("与 PI_WEB_HIDE_PROVIDERS 的彻底禁用叠加,两层各自生效(Req 7.3)", async () => {
    const prev = process.env["PI_WEB_HIDE_PROVIDERS"];
    process.env["PI_WEB_HIDE_PROVIDERS"] = "sufy";
    try {
      const body = await readModels(
        makeSessionHandler({ openrouter: { hiddenModels: ["gpt-4o"] } }),
        "/sessions/sess-1/models",
      );
      // sufy 被部署方彻底禁用;gpt-4o 被使用者勾掉;只剩 claude-3。
      expect(body.models.map((m) => m.id)).toEqual(["claude-3"]);
    } finally {
      if (prev === undefined) delete process.env["PI_WEB_HIDE_PROVIDERS"];
      else process.env["PI_WEB_HIDE_PROVIDERS"] = prev;
    }
  });
});

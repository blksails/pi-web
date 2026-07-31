/**
 * 集成:GET /config/models?output=image —— 端点合一后的部署级目录查询
 * (multi-gateway-providers 任务 4.3,Req 3.1, 3.2, 3.4)。
 *
 * 原独立的 `GET /aigc/models`(`createAigcModelsRoute`,曾住在
 * `src/aigc-settings/aigc-models-routes.ts`)已随本任务删除 —— 其能力由部署级目录端点的
 * 类型筛选完全覆盖(Req 3.2)。本文件原是那个已删除路由的单测,现改为验证「新端点的
 * output=image 筛选结果与旧端点等价」这条迁移不变式(design.md「集成测试」§2)。
 *
 * 旧端点未注入 `listEntries` 时的输出 = 静态 `AIGC_MODEL_CATALOG` 原样返回,形态
 * `{model,label,provider}`;新端点走 `ModelCatalogService.query()` 的统一投影
 * (`id`/`name` 取代 `model`/`label`)。按 id/model 对齐后比较其余字段一致。
 */
import { describe, it, expect } from "vitest";
import { AIGC_MODEL_CATALOG } from "@blksails/pi-web-tool-kit";
import type { AigcCatalogEntry } from "@blksails/pi-web-tool-kit";
import { createConfigRoutes } from "../../src/http/routes/config-routes.js";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createModelCatalogService } from "../../src/model-catalog/service.js";
import type { CatalogQuery } from "../../src/model-catalog/service.js";

const GATEWAY_IMAGE_ENTRY: AigcCatalogEntry = {
  model: "gw-image-1",
  label: "Gateway Image 1",
  provider: "ai-gateway",
};

function makeHandler(opts: { gateway?: boolean } = {}) {
  const service = createModelCatalogService({
    listSelfChat: () => ({ providers: [], models: [] }),
    imageCatalog: AIGC_MODEL_CATALOG,
    gatewayImageCatalog: opts.gateway ? [GATEWAY_IMAGE_ENTRY] : undefined,
    hiddenProviders: new Set(),
  });
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createConfigRoutes({
    listModelOptions: (q) =>
      service.query({
        input: q.input as CatalogQuery["input"],
        output: q.output as CatalogQuery["output"],
      }),
  });
  return createPiWebHandler({ manager, store, routes, authResolver: () => ({ anonymous: true }) });
}

type ResponseModel = {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly input: readonly string[];
  readonly output: readonly string[];
  readonly source?: string;
};

async function getModels(
  handler: ReturnType<typeof makeHandler>,
  qs: string,
): Promise<{ providers: string[]; models: ResponseModel[] }> {
  const res = await handler(new Request(`http://x/config/models${qs}`));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text()) as { providers: string[]; models: ResponseModel[] };
}

describe("GET /config/models?output=image — 与旧 GET /aigc/models 等价(Req 3.2)", () => {
  it("按 output=image 筛选的结果与静态 AIGC_MODEL_CATALOG(旧端点默认输出)逐条等价", async () => {
    const body = await getModels(makeHandler(), "?output=image");
    expect(body.models.length).toBe(AIGC_MODEL_CATALOG.length);

    const byId = new Map(body.models.map((m) => [m.id, m]));
    for (const old of AIGC_MODEL_CATALOG) {
      const found = byId.get(old.model);
      expect(found, `缺少旧目录条目 ${old.model}`).toBeDefined();
      expect(found!.name).toBe(old.label);
      expect(found!.provider).toBe(old.provider);
      expect(found!.output).toContain("image");
    }
  });

  it("注入网关图像目录后 output=image 的增量恰是网关条目(旧端点同样会含网关条目,非回归)", async () => {
    const withoutGateway = await getModels(makeHandler({ gateway: false }), "?output=image");
    const withGateway = await getModels(makeHandler({ gateway: true }), "?output=image");

    expect(withGateway.models.length).toBe(withoutGateway.models.length + 1);
    const added = withGateway.models.find((m) => m.id === GATEWAY_IMAGE_ENTRY.model);
    expect(added).toBeDefined();
    expect(added!.provider).toBe(GATEWAY_IMAGE_ENTRY.provider);
    expect(added!.source).toBe("ai-gateway");
  });

  it("旧路径 GET /aigc/models 已不存在(路由未注册,与 :domain 通配无关)", async () => {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const routes = createConfigRoutes({});
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    });
    const res = await handler(new Request("http://x/aigc/models"));
    expect(res.status).not.toBe(200);
  });
});

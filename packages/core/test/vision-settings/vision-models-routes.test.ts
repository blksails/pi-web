/**
 * 集成:GET /config/models?input=image —— 端点合一后的部署级目录查询
 * (multi-gateway-providers 任务 4.3,Req 3.1, 3.2, 3.4)。
 *
 * 原独立的 `GET /vision/models`(`createVisionModelsRoute`,曾住在
 * `src/vision-settings/vision-models-routes.ts`)已随本任务删除 —— 其能力由部署级目录
 * 端点的类型筛选完全覆盖(Req 3.2, 4.5)。本文件原是那个已删除路由的单测,现改为验证
 * 「新端点的 input=image 筛选结果与旧视觉模型清单等价」这条迁移不变式
 * (design.md「集成测试」§2)。
 *
 * 旧清单(`packages/tool-kit/src/vision/select-model.ts` 的 `listVisionModels`)=
 * `registry.getAvailable()`(已配置凭证的对话模型)中声明 `input` 含 `"image"` 的子集,
 * `value` 形如 `provider/id`。这与 `listModelOptions(agentDir)` 输出的 self chat 目录
 * 经 `query({input:"image"})` 筛选的子集是同一份数据、同一个筛选谓词
 * (`m.input.includes("image")`),故此处以等价的 self `ModelOption` 夹具模拟
 * (core 测试的既有纪律:不加载 pi SDK)。
 *
 * ★ 视觉清单今天不含图像静态目录/网关模型(旧端点只读 self models.json);合一后
 * `input=image` 会多出这部分(design.md 迁移说明「预期内的能力增强」)——单独断言该
 * 增量,不当回归。
 */
import { describe, it, expect } from "vitest";
import { createConfigRoutes } from "../../src/http/routes/config-routes.js";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createModelCatalogService } from "../../src/model-catalog/service.js";
import type { CatalogQuery } from "../../src/model-catalog/service.js";
import type { ModelOptions } from "../../src/config/model-options.types.js";
import type { AigcCatalogEntry } from "@blksails/pi-web-tool-kit";

// 模拟 listModelOptions(agentDir) 的输出:一个可读图(旧视觉清单会含)、一个纯文本
// (旧视觉清单不会含)的已配置对话模型 —— 同构 pi SDK `Model` 经任务 4.2 补齐后的形态。
const SELF_CHAT: ModelOptions = {
  providers: ["apiservices"],
  models: [
    { provider: "apiservices", id: "gpt-5.4", name: "GPT-5.4", input: ["text"], output: ["text"] },
    {
      provider: "apiservices",
      id: "gpt-5.4-vision",
      name: "GPT-5.4 Vision",
      input: ["text", "image"],
      output: ["text"],
    },
  ],
};

const IMAGE_ENTRY: AigcCatalogEntry = { model: "img-1", label: "Image 1", provider: "self-image" };

function makeHandler(opts: { imageCatalog?: boolean } = {}) {
  const service = createModelCatalogService({
    listSelfChat: () => SELF_CHAT,
    imageCatalog: opts.imageCatalog ? [IMAGE_ENTRY] : [],
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
};

async function getModels(
  handler: ReturnType<typeof makeHandler>,
  qs: string,
): Promise<{ providers: string[]; models: ResponseModel[] }> {
  const res = await handler(new Request(`http://x/config/models${qs}`));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text()) as { providers: string[]; models: ResponseModel[] };
}

describe("GET /config/models?input=image — 与旧 GET /vision/models 等价(Req 3.2, 4.5)", () => {
  it("旧视觉清单里 input 含 image 的对话模型均出现,纯文本模型被排除", async () => {
    const body = await getModels(makeHandler(), "?input=image");
    const ids = body.models.map((m) => `${m.provider}/${m.id}`);
    expect(ids).toContain("apiservices/gpt-5.4-vision");
    expect(ids).not.toContain("apiservices/gpt-5.4");
  });

  it("字段值与旧清单一致 —— provider/id 可拼成旧 value 形态,name 不变", async () => {
    const body = await getModels(makeHandler(), "?input=image");
    const found = body.models.find((m) => m.id === "gpt-5.4-vision");
    expect(found).toBeDefined();
    expect(found!.provider).toBe("apiservices");
    expect(found!.name).toBe("GPT-5.4 Vision");
  });

  it("★ 增量:图像静态目录默认声明 input 含 image,合一后会多出 —— 预期内的能力增强,不是回归", async () => {
    const withoutImageCatalog = await getModels(makeHandler({ imageCatalog: false }), "?input=image");
    const withImageCatalog = await getModels(makeHandler({ imageCatalog: true }), "?input=image");

    expect(withImageCatalog.models.length).toBe(withoutImageCatalog.models.length + 1);
    expect(withImageCatalog.models.map((m) => m.id)).toContain(IMAGE_ENTRY.model);
    // ↑ 这条增量是端点语义的正确行为(单条件 input=image);「视觉理解」这一**消费面**
    // (VisionModelSelectField / Canvas 解读弹层,任务 6.3)必须再加 output=text 约束,
    // 见下一条用例。
  });

  it("视觉理解消费面契约:?input=image&output=text 排除图像目录条目(六批完整性批评 gap 4,任务 6.3)", async () => {
    // 图像目录条目缺省 output=["image"](service.ts DEFAULT_IMAGE_OUTPUT)——它是「文生图/
    // 图生图」模型,不是「读图产文本」的视觉理解模型。只按 input=image 筛(旧/错误契约)
    // 会把它纳入「视觉模型」下拉与画布解读弹层;消费面必须同时约束 output=text 才能排除它。
    const body = await getModels(makeHandler({ imageCatalog: true }), "?input=image&output=text");
    const ids = body.models.map((m) => `${m.provider}/${m.id}`);
    expect(ids).toContain("apiservices/gpt-5.4-vision");
    expect(body.models.map((m) => m.id)).not.toContain(IMAGE_ENTRY.model);
  });

  it("旧路径 GET /vision/models 已不存在(路由未注册)", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/vision/models"));
    expect(res.status).not.toBe(200);
  });
});

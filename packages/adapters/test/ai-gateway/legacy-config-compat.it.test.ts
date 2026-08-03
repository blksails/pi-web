/**
 * 存量配置零迁移回归闸门(spec: multi-gateway-providers,任务 7.1;Req 9.1, 9.3)。
 *
 * ★ 本任务的交付形态是「零迁移的回归闸门」,不是「写一个迁移器」——见 tasks.md 任务
 * 7.1 的 `## Implementation Notes`。Req 9.3 在本特性下**无对象可迁移**:唯一的真映射
 * (image 侧 `ai-gateway` → `blksails-ai`)只作用于 AIGC 静态目录条目自身
 * (`ModelCatalogService.toImageCatalogModel`),绝不适用于 `settings.json.defaultProvider`
 * 或 `aigc.json.visionModel` 这类**对话命名空间**的配置文件值 —— 后两者的 provider 段
 * 字面量(`"ai-gateway"`)与 image 侧的 `ai-gateway` 是"同名不同义"的两个东西
 * (design.md:369, design.md:499, research.md §4.7)。
 *
 * 以「改造前的配置文件内容」为输入,走**真实**消费路径(真实 `resolveGatewayInstances`
 * 合成缺省网关实例、真实 `createGatewayCatalogs`/`mergeModelCatalog` 组装、真实
 * `ModelCatalogService.query()`),而非手写 stub 喂期望值:
 * - Req 9.1:未设 `PI_WEB_GATEWAYS`、只设存量单实例变量 → 合成的缺省实例标识必须
 *   逐字等于存量 `settings.json` 里写死的 `"ai-gateway"`,且该 provider 与其模型能在
 *   真实目录查询结果里被找到。
 * - Req 9.3:视觉偏好复合键的两类存量形态(自定义 provider 形态、缺省网关实例形态)
 *   必须原样出现在 `query({input:"image", output:"text"})` 拼出的候选集里 ——
 *   chat 侧(`toChatCatalogModel`)从不归一 provider 段,归一只发生在 image 侧
 *   (`toImageCatalogModel`),两者不可混淆。
 *
 * Req 9.2(图像模型启停,裸 model id 零迁移)见 `packages/tool-kit/test/aigc/
 * legacy-config-compat.it.test.ts`——那条走的是 `resolveAigcToolSettings` +
 * `deriveActiveModels` 真实消费路径,与网关实例解析无关,不属于本文件边界。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelCatalogService } from "@blksails/pi-web-core/model-catalog/service.js";
import type { ModelOptions } from "@blksails/pi-web-core/config/model-options.types.js";
import {
  resolveGatewayInstances,
  createGatewayCatalogs,
} from "../../src/ai-gateway/instances.js";
import { mergeModelCatalog } from "../../src/ai-gateway/model-catalog.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `legacy-compat-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const EMPTY_SELF_CHAT: ModelOptions = { providers: [], models: [] };

function jsonFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("Req 9.1 — 默认 provider/模型:存量单实例 env 合成的缺省网关实例继续可定位", () => {
  it("仅设存量 BLKSAILS_GATEWAY_BASE_URL(不设 PI_WEB_GATEWAYS)→ settings.json 的 defaultProvider/defaultModel 在真实目录查询结果里可命中", async () => {
    // 改造前的 settings.json:defaultProvider 用的是缺省网关实例 id 的字面量。
    await fs.writeFile(
      join(tmpDir, "settings.json"),
      JSON.stringify({ defaultProvider: "ai-gateway", defaultModel: "gpt-4o" }),
    );

    // 真实解析:未设 PI_WEB_GATEWAYS,只设存量单实例变量 → 走 resolveLegacyDefaultInstance。
    const instances = resolveGatewayInstances({
      BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com",
      BLKSAILS_GATEWAY_API_KEY: "sk-legacy",
    });
    expect(instances).toHaveLength(1);
    // ★ 断言用字面量 "ai-gateway",不是导入的 DEFAULT_GATEWAY_INSTANCE_ID 常量——
    // 若该常量的字面量被改名,本行必须报红(存量 settings.json 写死的正是这个字面量,
    // 常量改名 = 破坏存量兼容,不能让"跟着常量走"的断言把这种破坏悄悄放过)。
    expect(instances[0]?.id).toBe("ai-gateway");

    const catalogs = createGatewayCatalogs(instances, {
      env: {},
      fetchImpl: jsonFetch({ data: [{ id: "gpt-4o", owned_by: "openai" }] }),
    });
    const catalog = catalogs.get(instances[0]!.id);
    expect(catalog).toBeDefined();
    await catalog!.refresh();

    const service = createModelCatalogService({
      listSelfChat: () => EMPTY_SELF_CHAT,
      gatewayChat: catalog!,
      mergeCatalog: mergeModelCatalog,
      imageCatalog: [],
      hiddenProviders: new Set(),
    });

    const result = service.query();

    const settingsRaw = await fs.readFile(join(tmpDir, "settings.json"), "utf8");
    const settings = JSON.parse(settingsRaw) as { defaultProvider: string; defaultModel: string };

    // 存量 defaultProvider 仍能在目录 providers 清单里找到自己 —— 不是"文件里的值没变"
    // 这种弱断言,而是它依旧能命中一个真实存在的 provider(Req 9.1「继续生效」)。
    expect(result.providers).toContain(settings.defaultProvider);
    expect(
      result.models.some(
        (m) => m.provider === settings.defaultProvider && m.id === settings.defaultModel,
      ),
    ).toBe(true);
  });
});

describe("Req 9.3 — 视觉偏好:存量复合键原样命中真实候选集,不因归一被错误覆盖", () => {
  it("自定义 provider 形态(用户自身 pi models.json 注册的 provider,如 apiservices/gpt-5.4;research.md §4.7 实测样本)原样命中 query({input:image, output:text})", () => {
    const service = createModelCatalogService({
      listSelfChat: () => ({
        providers: ["apiservices"],
        models: [
          {
            provider: "apiservices",
            id: "gpt-5.4",
            name: "GPT-5.4",
            input: ["text", "image"],
            output: ["text"],
          },
        ],
      }),
      imageCatalog: [],
      hiddenProviders: new Set(),
    });

    const result = service.query({ input: "image", output: "text" });
    const candidates = new Set(result.models.map((m) => `${m.provider}/${m.id}`));

    // research.md §4.7 实测:本机 aigc.json 的 visionModel 字面值。
    expect(candidates.has("apiservices/gpt-5.4")).toBe(true);
  });

  it("缺省网关实例形态(声明 input 含 image 的聊天模型)原样命中,provider 段不被误套 image 侧的归一表", async () => {
    // 显式声明一个标识恰为 "ai-gateway" 的网关实例(与 Req 9.1 合成的缺省实例同名,
    // 但走的是显式声明路径,借此让 _INPUT/_OUTPUT 得以配置——纯为测试构造确定性场景,
    // 不影响所验证的核心事实:chat 侧的 "ai-gateway" 与 image 侧的 "ai-gateway" 是否
    // 被错误地统一归一)。
    const instances = resolveGatewayInstances({
      PI_WEB_GATEWAYS: "ai-gateway",
      PI_WEB_GATEWAY_AI_GATEWAY_BASE_URL: "http://gw.example.com",
      PI_WEB_GATEWAY_AI_GATEWAY_INPUT: "text,image",
      PI_WEB_GATEWAY_AI_GATEWAY_OUTPUT: "text",
      // 缺省归属白名单只放行 anthropic/openai/google-ai-studio(config.ts
      // DEFAULT_PROVIDER_ALLOWLIST);显式声明本实例的归属白名单,避免示例模型的
      // owned_by 被无关的缺省白名单过滤掉——这里验证的是归一逻辑,不是白名单逻辑。
      PI_WEB_GATEWAY_AI_GATEWAY_ALLOWLIST: "dashscope",
    });
    expect(instances[0]?.id).toBe("ai-gateway");

    const catalogs = createGatewayCatalogs(instances, {
      env: {},
      fetchImpl: jsonFetch({ data: [{ id: "qwen-vl-max", owned_by: "dashscope" }] }),
    });
    const catalog = catalogs.get(instances[0]!.id);
    expect(catalog).toBeDefined();
    await catalog!.refresh();

    const service = createModelCatalogService({
      listSelfChat: () => EMPTY_SELF_CHAT,
      gatewayChat: catalog!,
      mergeCatalog: mergeModelCatalog,
      imageCatalog: [],
      hiddenProviders: new Set(),
    });

    const result = service.query({ input: "image", output: "text" });
    const candidates = new Set(result.models.map((m) => `${m.provider}/${m.id}`));

    // 存量写在 aigc.json 里的复合键(改造前) —— chat 侧从不归一 provider 段,原样命中。
    const legacyVisionPreference = "ai-gateway/qwen-vl-max";
    expect(candidates.has(legacyVisionPreference)).toBe(true);
    // ★ 判别力:若有人让 chat 侧也套用 image 侧那张归一表(ai-gateway → blksails-ai),
    // 候选集会变成 "blksails-ai/qwen-vl-max",上面那行必须转红、这行必须转真。
    expect(candidates.has("blksails-ai/qwen-vl-max")).toBe(false);
  });
});

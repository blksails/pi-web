/**
 * model-catalog · ModelCatalogService 单测(model-catalog spec task 2.1,
 * design.md「ModelCatalogService」组件块;Req 1.3, 1.4, 4.3, 5.1–5.4)。
 *
 * 四组核心断言:
 * 1. 字节一致(引用级透传):gateway 未注入且 hidden 空 → chat/image 输出 === 输入引用(1.3/4.3)。
 * 2. 过滤边界:hidden 仅作用对话命名空间,图像命名空间不吃 hidden(5.1/5.2)。
 * 3. 剔除:hidden 含 `ai-gateway` → 网关对话条目整体剔除(5.3)。
 * 4. 并入:gatewayImageCatalog 注入 → imageEntries 尾部并入网关条目且 source 标记正确(4.1/4.5)。
 * 另:注入 gateway 时 chatOptions 经 mergeModelCatalog(providers=self-only、网关条目
 * provider="ai-gateway"),gateway 空快照 = merge 空数组(fail-soft 透传,1.4)。
 */
import { describe, expect, it } from "vitest";
import type { AigcCatalogEntry } from "@blksails/pi-web-tool-kit";
import { createModelCatalogService } from "@blksails/pi-web-core/model-catalog/index.js";
import { mergeModelCatalog } from "../../src/ai-gateway/model-catalog.js";
import type { GatewayModelEntry } from "../../src/ai-gateway/model-catalog.js";
import type { ModelOptions } from "@blksails/pi-web-core/config/model-options.types.js";

const SELF_CHAT: ModelOptions = {
  providers: ["dashscope", "openrouter"],
  models: [
    { provider: "openrouter", id: "gpt-5", name: "GPT-5" },
    { provider: "dashscope", id: "qwen-max", name: "Qwen Max" },
  ],
};

const GATEWAY_CHAT: readonly GatewayModelEntry[] = [
  { model: "gpt-4o", ownedBy: "openai-compat", source: "ai-gateway" },
  // 与 self 同 id 跨归属:不吞并,两条并存(merge key = provider/id)。
  { model: "qwen-max", ownedBy: "dashscope-token-plan", source: "ai-gateway" },
];

const IMAGE_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2", label: "GPT Image 2 · NewAPI", provider: "newapi" },
  { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image · OpenRouter", provider: "openrouter" },
];

const GATEWAY_IMAGE_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-1", label: "GPT Image 1 · AI Gateway", provider: "newapi" },
  { model: "qwen-image", label: "Qwen Image · AI Gateway", provider: "dashscope" },
];

describe("ModelCatalogService — 字节一致(gateway 未注入,引用级透传)", () => {
  it("hidden 空集时 chatOptions() 返回 listSelfChat() 的同一引用(Req 1.3)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.chatOptions()).toBe(SELF_CHAT);
  });

  it("gatewayImageCatalog 未注入时 imageEntries() 返回 imageCatalog 的同一引用(Req 4.3)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.imageEntries()).toBe(IMAGE_CATALOG);
  });
});

describe("ModelCatalogService — 过滤边界(hidden 仅作用对话命名空间)", () => {
  it("hidden={openrouter} 剔除 chat 的 openrouter 条目与 provider(Req 5.1)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(["openrouter"]),
    });
    const chat = svc.chatOptions();
    expect(chat.providers).toEqual(["dashscope"]);
    expect(chat.models).toEqual([{ provider: "dashscope", id: "qwen-max", name: "Qwen Max" }]);
  });

  it("hidden={openrouter} 不影响 imageEntries(图像命名空间独立,Req 5.2)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(["openrouter"]),
    });
    // 未注入网关图像目录:仍是引用级透传,openrouter 图像条目保留。
    expect(svc.imageEntries()).toBe(IMAGE_CATALOG);
  });

  it("hidden={openrouter} + 注入网关图像目录:两侧图像条目均不吃 hidden(Req 5.2)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      gatewayImageCatalog: GATEWAY_IMAGE_CATALOG,
      hiddenProviders: new Set(["openrouter"]),
    });
    const entries = svc.imageEntries();
    expect(entries).toHaveLength(IMAGE_CATALOG.length + GATEWAY_IMAGE_CATALOG.length);
    expect(entries.some((e) => e.provider === "openrouter")).toBe(true);
  });
});

describe("ModelCatalogService — hidden 含 ai-gateway 时网关条目整体剔除", () => {
  it("chatOptions().models 无 source=ai-gateway 条目,self 条目保留(Req 5.3)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
      // 合并能力经装配层注入(spec: core-package-extraction 任务 3.1);与 gatewayChat 同进同出。
      mergeCatalog: mergeModelCatalog,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(["ai-gateway"]),
    });
    const chat = svc.chatOptions();
    expect(chat.models.some((m) => m.source === "ai-gateway")).toBe(false);
    expect(chat.models.some((m) => m.provider === "ai-gateway")).toBe(false);
    // self 条目集合守恒(聚合形态附 source/availability 标记)。
    expect(chat.models).toEqual([
      { provider: "openrouter", id: "gpt-5", name: "GPT-5", source: "self", availability: "session" },
      { provider: "dashscope", id: "qwen-max", name: "Qwen Max", source: "self", availability: "session" },
    ]);
    // providers 本就 self-only,无 ai-gateway,不受影响。
    expect(chat.providers).toEqual(["dashscope", "openrouter"]);
  });
});

describe("ModelCatalogService — 图像目录并入(source 标记)", () => {
  it("注入 gatewayImageCatalog:self 条目附 source=self,尾部并入网关条目附 source=ai-gateway(Req 4.1/4.5)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      gatewayImageCatalog: GATEWAY_IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.imageEntries()).toEqual([
      { ...IMAGE_CATALOG[0], source: "self" },
      { ...IMAGE_CATALOG[1], source: "self" },
      { ...GATEWAY_IMAGE_CATALOG[0], source: "ai-gateway" },
      { ...GATEWAY_IMAGE_CATALOG[1], source: "ai-gateway" },
    ]);
  });
});

describe("ModelCatalogService — 注入 gateway 时 chat 经 mergeModelCatalog 聚合", () => {
  it("providers=self-only,网关条目 provider=ai-gateway 且附 channel/availability;同 id 跨归属不吞并", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
      // 合并能力经装配层注入(spec: core-package-extraction 任务 3.1);与 gatewayChat 同进同出。
      mergeCatalog: mergeModelCatalog,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    const chat = svc.chatOptions();
    // ★spec ai-gateway-session-models Req 6.1:providers 追加 ai-gateway(网关模型已可
    // 接入会话);渠道名仍恒不进入。availability 同步由 "catalog" 修订为 "session"(Req 5.1)。
    expect(chat.providers).toEqual(["dashscope", "openrouter", "ai-gateway"]);
    // 默认 precedence=gateway:网关块在前,self 块在后。
    expect(chat.models).toEqual([
      { provider: "ai-gateway", id: "gpt-4o", name: "gpt-4o", source: "ai-gateway", channel: "openai-compat", availability: "session" },
      { provider: "ai-gateway", id: "qwen-max", name: "qwen-max", source: "ai-gateway", channel: "dashscope-token-plan", availability: "session" },
      { provider: "openrouter", id: "gpt-5", name: "GPT-5", source: "self", availability: "session" },
      { provider: "dashscope", id: "qwen-max", name: "Qwen Max", source: "self", availability: "session" },
    ]);
  });

  it("modelPrecedence=self:self 块在前(块排序,不做覆盖删除)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
      // 合并能力经装配层注入(spec: core-package-extraction 任务 3.1);与 gatewayChat 同进同出。
      mergeCatalog: mergeModelCatalog,
      modelPrecedence: "self",
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    const ids = svc.chatOptions().models.map((m) => `${m.provider}/${m.id}`);
    expect(ids).toEqual([
      "openrouter/gpt-5",
      "dashscope/qwen-max",
      "ai-gateway/gpt-4o",
      "ai-gateway/qwen-max",
    ]);
  });

  it("gateway 快照为空集时 = merge 空数组(fail-soft 透传,Req 1.4)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => [] },
      // 合并能力经装配层注入(spec: core-package-extraction 任务 3.1);与 gatewayChat 同进同出。
      mergeCatalog: mergeModelCatalog,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    const chat = svc.chatOptions();
    expect(chat.providers).toEqual(["dashscope", "openrouter"]);
    expect(chat.models).toEqual([
      { provider: "openrouter", id: "gpt-5", name: "GPT-5", source: "self", availability: "session" },
      { provider: "dashscope", id: "qwen-max", name: "Qwen Max", source: "self", availability: "session" },
    ]);
  });
});

/**
 * Cloudflare 图像目录并入(spec cloudflare-aigc-provider,Req 4.2)。
 *
 * ★ 这组用例是补一个**已发生的缺口**:该 spec 的 design 只覆盖了 tool-kit 内的路由与目录,
 * 漏掉了宿主侧 `/aigc/models` 的装配层(本 service + lib/app/pi-handler.ts),导致 provider
 * 实现完成、工具侧可用,但设置页的模型开关面板里一条 Cloudflare 模型都列不出来。
 * 真机 `curl /api/aigc/models` 返回 17 条、cloudflare 0 条时才暴露。
 */
const CLOUDFLARE_IMAGE_CATALOG: readonly AigcCatalogEntry[] = [
  { model: "gpt-image-2-cf", label: "GPT Image 2 · Cloudflare", provider: "cloudflare" },
  { model: "flux-1-schnell-cf", label: "FLUX.1 schnell · Cloudflare", provider: "cloudflare" },
];

describe("ModelCatalogService — Cloudflare 图像目录并入(Req 4.2)", () => {
  it("两套可选 provider 都未注入时仍是引用级透传(字节一致不回归)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.imageEntries()).toBe(IMAGE_CATALOG);
  });

  it("只注入 cloudflareImageCatalog:self 附 source=self,CF 条目附 source=cloudflare", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      cloudflareImageCatalog: CLOUDFLARE_IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    const entries = svc.imageEntries();
    expect(entries).toHaveLength(IMAGE_CATALOG.length + CLOUDFLARE_IMAGE_CATALOG.length);
    for (const e of entries.slice(0, IMAGE_CATALOG.length)) expect(e.source).toBe("self");
    for (const e of entries.slice(IMAGE_CATALOG.length)) expect(e.source).toBe("cloudflare");
    expect(entries.map((e) => e.model)).toContain("gpt-image-2-cf");
  });

  it("★ 只注入网关时输出与 Cloudflare 引入前逐字节一致(不回归既有行为)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      gatewayImageCatalog: GATEWAY_IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.imageEntries()).toEqual([
      ...IMAGE_CATALOG.map((e) => ({ ...e, source: "self" })),
      ...GATEWAY_IMAGE_CATALOG.map((e) => ({ ...e, source: "ai-gateway" })),
    ]);
  });

  it("两者同时注入:顺序为 self → ai-gateway → cloudflare,三段 source 各自正确", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      gatewayImageCatalog: GATEWAY_IMAGE_CATALOG,
      cloudflareImageCatalog: CLOUDFLARE_IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.imageEntries().map((e) => e.source)).toEqual([
      ...IMAGE_CATALOG.map(() => "self"),
      ...GATEWAY_IMAGE_CATALOG.map(() => "ai-gateway"),
      ...CLOUDFLARE_IMAGE_CATALOG.map(() => "cloudflare"),
    ]);
  });
});

/**
 * 欠债解除后的注入契约(spec: core-package-extraction,任务 3.1;Req 3.2/3.3)。
 *
 * 目录服务属内核层,不再值导入 ai-gateway 适配器;合并能力经 `mergeCatalog` 注入。
 * 这组断言守的是**注入与否的两种形态都正确**,尤其是「漏注入」这一种 ——
 * 它是唯一一种能跑通、但结果悄悄错掉的形态。
 */
describe("ModelCatalogService — 合并能力的注入契约", () => {
  it("两者都不注入时,行为与「网关套件未启用」逐字节一致(Req 3.3)", () => {
    const withoutAnything = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    // 引用级透传是「逐字节一致」最强的判据:连对象都没被重建过。
    expect(withoutAnything.chatOptions()).toBe(SELF_CHAT);
  });

  it("只注入 mergeCatalog、不注入 gatewayChat 时,仍走未启用路径", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      mergeCatalog: mergeModelCatalog,
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    // 启用判别始终是 gatewayChat 注入与否(与装配层/runner 侧判据同源),不是 mergeCatalog。
    expect(svc.chatOptions()).toBe(SELF_CHAT);
  });

  it("注入了 gatewayChat 却漏了 mergeCatalog 时**当场抛错**,不静默降级(Req 3.2)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
      // mergeCatalog 故意不传 —— 模拟装配点漏传。
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    // ★ 若这里改成静默退回未启用形态,测试会变成 `toBe(SELF_CHAT)` 并**照样通过**,
    //   而真机表现是「网关模型从列表里凭空消失」—— 没有任何报错可循。
    expect(() => svc.chatOptions()).toThrowError(/gatewayChat 却没有注入 mergeCatalog/);
  });

  it("注入的合并能力确实被调用(而非服务内部另有一条硬编码路径)", () => {
    const calls: unknown[][] = [];
    const spy = ((...args: unknown[]) => {
      calls.push(args);
      return { providers: [], models: [] };
    }) as unknown as typeof mergeModelCatalog;
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
      mergeCatalog: spy,
      modelPrecedence: "self",
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    expect(svc.chatOptions()).toEqual({ providers: [], models: [] });
    expect(calls).toHaveLength(1);
    // 三个入参逐一核对:漏传 precedence 会让 env 配的块排序静默失效。
    expect(calls[0]).toEqual([SELF_CHAT.models, GATEWAY_CHAT, "self"]);
  });
});

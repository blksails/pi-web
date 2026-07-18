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
import { createModelCatalogService } from "../../src/model-catalog/index.js";
import type { GatewayModelEntry } from "../../src/ai-gateway/model-catalog.js";
import type { ModelOptions } from "../../src/config/model-options.types.js";

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
      imageCatalog: IMAGE_CATALOG,
      hiddenProviders: new Set(),
    });
    const chat = svc.chatOptions();
    // providers 仅含 self 来源 provider(去重排序),不含 ai-gateway 与任何渠道名。
    expect(chat.providers).toEqual(["dashscope", "openrouter"]);
    // 默认 precedence=gateway:网关块在前,self 块在后。
    expect(chat.models).toEqual([
      { provider: "ai-gateway", id: "gpt-4o", name: "gpt-4o", source: "ai-gateway", channel: "openai-compat", availability: "catalog" },
      { provider: "ai-gateway", id: "qwen-max", name: "qwen-max", source: "ai-gateway", channel: "dashscope-token-plan", availability: "catalog" },
      { provider: "openrouter", id: "gpt-5", name: "GPT-5", source: "self", availability: "session" },
      { provider: "dashscope", id: "qwen-max", name: "Qwen Max", source: "self", availability: "session" },
    ]);
  });

  it("modelPrecedence=self:self 块在前(块排序,不做覆盖删除)", () => {
    const svc = createModelCatalogService({
      listSelfChat: () => SELF_CHAT,
      gatewayChat: { get: () => GATEWAY_CHAT },
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

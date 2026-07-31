/**
 * model-options-filter 单元测试:provider 排除过滤(纯函数,无 pi SDK)。
 *
 * 覆盖 parseHiddenProviders(逗号分隔解析、空白/空项处理)与 excludeProviders
 * (剔除指定 provider 的模型与 provider 名、空名单零拷贝、不改入参)。
 *
 * multi-gateway-providers spec 任务 4.4(Req 5.1):补一组 `excludeProviders` 泛型化
 * 的回归用例 —— 用一个**非** `ModelOptions` 的形状(镜像 `ModelCatalogService.query()`
 * 的 `CatalogQueryResult`,含 `input`/`output`/`source` 等 chat 侧没有的字段)驱动同一
 * 函数,证明过滤逻辑不依赖 chat 命名空间的具体字段集,可被 `query()` 复用于统一投影,
 * 使隐藏名单对 image 侧模型同样生效(不因类型不同而例外)。
 */
import { describe, expect, it } from "vitest";
import {
  parseHiddenProviders,
  excludeProviders,
  excludeProviderModels,
} from "../../src/config/model-options-filter.js";
import type { ModelOptions } from "../../src/config/model-options.types.js";

const SAMPLE: ModelOptions = {
  providers: ["anthropic", "openai", "openrouter"],
  models: [
    { provider: "anthropic", id: "claude-opus-4-8", name: "Claude Opus" },
    { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku" },
    { provider: "openai", id: "gpt-image-2", name: "GPT Image 2" },
    { provider: "openrouter", id: "some/model", name: "Some Model" },
  ],
};

describe("parseHiddenProviders", () => {
  it("解析逗号分隔名单为集合", () => {
    const set = parseHiddenProviders("anthropic,openai");
    expect(set.has("anthropic")).toBe(true);
    expect(set.has("openai")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("去除空白并忽略空项", () => {
    const set = parseHiddenProviders("  anthropic , , openai ,");
    expect([...set].sort()).toEqual(["anthropic", "openai"]);
  });

  it("undefined/空串/全空白 → 空集合", () => {
    expect(parseHiddenProviders(undefined).size).toBe(0);
    expect(parseHiddenProviders("").size).toBe(0);
    expect(parseHiddenProviders("   ").size).toBe(0);
    expect(parseHiddenProviders(",,").size).toBe(0);
  });
});

describe("excludeProviders", () => {
  it("剔除指定 provider 的模型与 provider 名", () => {
    const out = excludeProviders(SAMPLE, new Set(["anthropic"]));
    expect(out.providers).toEqual(["openai", "openrouter"]);
    expect(out.models.map((m) => m.id)).toEqual(["gpt-image-2", "some/model"]);
    expect(out.models.some((m) => m.provider === "anthropic")).toBe(false);
  });

  it("可一次剔除多个 provider", () => {
    const out = excludeProviders(SAMPLE, new Set(["anthropic", "openrouter"]));
    expect(out.providers).toEqual(["openai"]);
    expect(out.models.map((m) => m.id)).toEqual(["gpt-image-2"]);
  });

  it("空名单 → 原样返回(零拷贝快路径)且不改入参", () => {
    const out = excludeProviders(SAMPLE, new Set());
    expect(out).toBe(SAMPLE);
    expect(SAMPLE.models).toHaveLength(4);
  });

  it("名单含不存在的 provider → 无副作用", () => {
    const out = excludeProviders(SAMPLE, new Set(["does-not-exist"]));
    expect(out.providers).toEqual(SAMPLE.providers);
    expect(out.models).toHaveLength(4);
  });

  it("不改原入参对象(纯函数)", () => {
    const before = JSON.stringify(SAMPLE);
    excludeProviders(SAMPLE, new Set(["openai"]));
    expect(JSON.stringify(SAMPLE)).toBe(before);
  });
});

describe("excludeProviders(泛型化,非 ModelOptions 形状 —— 镜像 query() 的 CatalogQueryResult)", () => {
  /** 镜像 CatalogModel:字段集与 ModelOption 不同(多 input/output/source,无强制 name)。 */
  interface CatalogLikeModel {
    readonly provider: string;
    readonly id: string;
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly source: string;
  }

  const CATALOG_LIKE: { providers: readonly string[]; models: readonly CatalogLikeModel[] } = {
    providers: ["newapi", "ai-gateway"],
    models: [
      { provider: "newapi", id: "gpt-image-2", input: ["text"], output: ["image"], source: "self" },
      { provider: "ai-gateway", id: "qwen-image", input: ["text"], output: ["image"], source: "ai-gateway" },
    ],
  };

  it("对非 ModelOptions 形状(image/统一投影)同样剔除隐藏 provider", () => {
    const out = excludeProviders(CATALOG_LIKE, new Set(["ai-gateway"]));
    expect(out.providers).toEqual(["newapi"]);
    expect(out.models.map((m) => m.id)).toEqual(["gpt-image-2"]);
    expect(out.models.every((m) => m.provider !== "ai-gateway")).toBe(true);
  });

  it("空名单 → 原样返回(零拷贝快路径),该形状同样成立", () => {
    const out = excludeProviders(CATALOG_LIKE, new Set());
    expect(out).toBe(CATALOG_LIKE);
  });
});

describe("excludeProviderModels(会话 RPC 模型列表,形状宽松)", () => {
  const MODELS = [
    { id: "claude-opus", provider: "openrouter", name: "Claude Opus" },
    { id: "qwen-max", provider: "dashscope", name: "Qwen Max" },
    { id: "gpt-5", provider: "apiservices", name: "GPT 5" },
  ];

  it("剔除指定 provider 的模型", () => {
    const out = excludeProviderModels(MODELS, new Set(["openrouter"]));
    expect(out.map((m) => m.id)).toEqual(["qwen-max", "gpt-5"]);
    expect(out.some((m) => m.provider === "openrouter")).toBe(false);
  });

  it("空名单 → 原样返回(零拷贝快路径)", () => {
    const out = excludeProviderModels(MODELS, new Set());
    expect(out).toBe(MODELS);
  });

  it("无 provider 字段或非字符串的项 → 保守保留", () => {
    const loose = [
      { id: "a", provider: "openrouter" },
      { id: "b" },
      { id: "c", provider: 123 },
    ];
    const out = excludeProviderModels(loose, new Set(["openrouter"]));
    expect(out.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("不改原入参数组(纯函数)", () => {
    const before = JSON.stringify(MODELS);
    excludeProviderModels(MODELS, new Set(["dashscope"]));
    expect(JSON.stringify(MODELS)).toBe(before);
  });
});

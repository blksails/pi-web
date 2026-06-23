/**
 * model-options-filter 单元测试:provider 排除过滤(纯函数,无 pi SDK)。
 *
 * 覆盖 parseHiddenProviders(逗号分隔解析、空白/空项处理)与 excludeProviders
 * (剔除指定 provider 的模型与 provider 名、空名单零拷贝、不改入参)。
 */
import { describe, expect, it } from "vitest";
import {
  parseHiddenProviders,
  excludeProviders,
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

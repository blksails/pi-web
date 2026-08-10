/**
 * visibility-filter 单元测试:空配置直通(引用相等)、隐藏 provider、勾掉模型、
 * providers 列表随 models 收敛、无效条目忽略、目录新增模型自动可见
 * (provider-visibility-config task 1.1)。
 */
import { describe, expect, it } from "vitest";
import {
  applyProviderVisibility,
  filterVisibleModels,
  isVisibilityEmpty,
  type ProviderVisibilityConfig,
} from "../../src/model-catalog/visibility-filter.js";

interface TestModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}

function makeResult(): { providers: readonly string[]; models: readonly TestModel[] } {
  return {
    providers: ["openrouter", "dashscope", "sufy"],
    models: [
      { provider: "openrouter", id: "gpt-4o", name: "GPT-4o" },
      { provider: "openrouter", id: "claude-3", name: "Claude 3" },
      { provider: "dashscope", id: "qwen-max", name: "Qwen Max" },
      { provider: "sufy", id: "sufy-image", name: "Sufy Image" },
    ],
  };
}

describe("isVisibilityEmpty", () => {
  it("undefined 视为空", () => {
    expect(isVisibilityEmpty(undefined)).toBe(true);
  });

  it("无键视为空", () => {
    expect(isVisibilityEmpty({})).toBe(true);
  });

  it("有键但内容为空壳仍视为空(打开又关上不应破坏零侵入)", () => {
    expect(isVisibilityEmpty({ openrouter: {} })).toBe(true);
    expect(isVisibilityEmpty({ openrouter: { hiddenModels: [] } })).toBe(true);
    expect(isVisibilityEmpty({ openrouter: { hidden: false } })).toBe(true);
  });

  it("有隐藏的 provider 或勾掉的模型时不为空", () => {
    expect(isVisibilityEmpty({ sufy: { hidden: true } })).toBe(false);
    expect(isVisibilityEmpty({ openrouter: { hiddenModels: ["gpt-4o"] } })).toBe(false);
  });
});

describe("applyProviderVisibility", () => {
  it("★ 空配置返回入参同一引用(Req 7.1 零侵入的机械判据)", () => {
    const result = makeResult();
    expect(applyProviderVisibility(result, undefined)).toBe(result);
    expect(applyProviderVisibility(result, {})).toBe(result);
    expect(applyProviderVisibility(result, { openrouter: {} })).toBe(result);
  });

  it("隐藏 provider 时其全部模型消失,providers 列表同步收敛", () => {
    const result = makeResult();
    const cfg: ProviderVisibilityConfig = { openrouter: { hidden: true } };
    const filtered = applyProviderVisibility(result, cfg);

    expect(filtered.models.map((m) => m.id)).toEqual(["qwen-max", "sufy-image"]);
    expect(filtered.providers).toEqual(["dashscope", "sufy"]);
  });

  it("勾掉模型时仅该模型消失,同 provider 其余模型保留", () => {
    const result = makeResult();
    const cfg: ProviderVisibilityConfig = { openrouter: { hiddenModels: ["gpt-4o"] } };
    const filtered = applyProviderVisibility(result, cfg);

    expect(filtered.models.map((m) => m.id)).toEqual(["claude-3", "qwen-max", "sufy-image"]);
    // openrouter 还剩 claude-3,故仍在 providers 列表里
    expect(filtered.providers).toEqual(["openrouter", "dashscope", "sufy"]);
  });

  it("某 provider 的模型被逐条勾光时,它也从 providers 列表消失", () => {
    const result = makeResult();
    const cfg: ProviderVisibilityConfig = {
      openrouter: { hiddenModels: ["gpt-4o", "claude-3"] },
    };
    const filtered = applyProviderVisibility(result, cfg);

    expect(filtered.models.map((m) => m.id)).toEqual(["qwen-max", "sufy-image"]);
    expect(filtered.providers).toEqual(["dashscope", "sufy"]);
  });

  it("配置引用不存在的 provider 或模型时被自然忽略,不使整份配置失效(Req 7.4)", () => {
    const result = makeResult();
    const cfg: ProviderVisibilityConfig = {
      "ghost-provider": { hidden: true },
      openrouter: { hiddenModels: ["already-removed-model", "gpt-4o"] },
    };
    const filtered = applyProviderVisibility(result, cfg);

    // ghost-provider 不存在 → 无影响;already-removed-model 不存在 → 无影响;
    // 同一份配置里的 gpt-4o 照常生效。
    expect(filtered.models.map((m) => m.id)).toEqual(["claude-3", "qwen-max", "sufy-image"]);
  });

  it("目录后来新增的模型不在勾掉名单中,默认可见(Req 4.4)", () => {
    const cfg: ProviderVisibilityConfig = { openrouter: { hiddenModels: ["gpt-4o"] } };
    const grown = {
      providers: ["openrouter"],
      models: [
        { provider: "openrouter", id: "gpt-4o", name: "GPT-4o" },
        { provider: "openrouter", id: "brand-new", name: "Brand New" },
      ],
    };
    const filtered = applyProviderVisibility(grown, cfg);

    expect(filtered.models.map((m) => m.id)).toEqual(["brand-new"]);
  });

  it("同时隐藏 provider 与勾掉模型时两者叠加生效", () => {
    const result = makeResult();
    const cfg: ProviderVisibilityConfig = {
      sufy: { hidden: true },
      openrouter: { hiddenModels: ["claude-3"] },
    };
    const filtered = applyProviderVisibility(result, cfg);

    expect(filtered.models.map((m) => m.id)).toEqual(["gpt-4o", "qwen-max"]);
    expect(filtered.providers).toEqual(["openrouter", "dashscope"]);
  });

  it("过滤不改动入参对象(纯函数)", () => {
    const result = makeResult();
    const before = JSON.stringify(result);
    applyProviderVisibility(result, { openrouter: { hidden: true } });
    expect(JSON.stringify(result)).toBe(before);
  });
});

describe("filterVisibleModels(宽松形态,供会话侧使用)", () => {
  it("空配置返回入参同一引用", () => {
    const models = makeResult().models;
    expect(filterVisibleModels(models, undefined)).toBe(models);
    expect(filterVisibleModels(models, {})).toBe(models);
  });

  it("无命中时也返回同一引用(避免无谓的新对象)", () => {
    const models = makeResult().models;
    expect(filterVisibleModels(models, { "ghost-provider": { hidden: true } })).toBe(models);
  });

  it("隐藏 provider 与勾掉模型同样生效", () => {
    const models = makeResult().models;
    expect(
      filterVisibleModels(models, {
        sufy: { hidden: true },
        openrouter: { hiddenModels: ["gpt-4o"] },
      }).map((m) => m.id),
    ).toEqual(["claude-3", "qwen-max"]);
  });

  it("provider 非字符串时保留该条(无法判定,宁可多显示也不误删)", () => {
    const models = [
      { provider: undefined, id: "unknown-shape" },
      { provider: "sufy", id: "sufy-image" },
    ];
    expect(filterVisibleModels(models, { sufy: { hidden: true } }).map((m) => m.id)).toEqual([
      "unknown-shape",
    ]);
  });

  it("id 非字符串时不参与逐模型勾选判定,该条保留", () => {
    const models = [{ provider: "openrouter", id: undefined }];
    expect(filterVisibleModels(models, { openrouter: { hiddenModels: ["gpt-4o"] } })).toHaveLength(
      1,
    );
  });
});

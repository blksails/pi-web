/**
 * 单元:providers 配置域 —— 校验 schema 与表单 IR(spec: multi-gateway-providers,
 * 任务 5.1;Req 7.1, 7.5, 7.6, 7.7)。
 */
import { describe, it, expect } from "vitest";
import {
  createProvidersConfigSchema,
  providersFormSchema,
  PROVIDER_MODALITIES,
} from "../../src/config/domains/providers.js";
import type { FieldDescriptor } from "../../src/config/form-schema.js";

const RESERVED = new Set(["anthropic", "openai"]);

const validProvider = {
  id: "my-provider",
  baseUrl: "https://api.example.com/v1",
  models: [{ id: "model-a", name: "Model A" }],
};

describe("createProvidersConfigSchema — 校验(Req 7.5, 7.6, 7.7)", () => {
  it("接受一条合法条目", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.safeParse({ providers: [validProvider] });
    expect(r.success).toBe(true);
  });

  it("enabled 缺省视为启用(Req 7.5 的反面)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.parse({ providers: [validProvider] }) as {
      providers: readonly { enabled: boolean }[];
    };
    expect(r.providers[0]?.enabled).toBe(true);
  });

  it("停用条目仍校验通过,保留配置(Req 7.5)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.safeParse({ providers: [{ ...validProvider, enabled: false }] });
    expect(r.success).toBe(true);
  });

  it("缺访问地址 → 拒绝(Req 7.2 的必填前提)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.safeParse({ providers: [{ id: "my-provider" }] });
    expect(r.success).toBe(false);
  });

  it("标识形态非法(大写/空白/连字符起止) → 拒绝", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    for (const bad of ["My-Provider", "has space", "-lead", "trail-", ""]) {
      const r = schema.safeParse({
        providers: [{ ...validProvider, id: bad }],
      });
      expect(r.success, `id ${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("两条目同标识 → 拒绝,issue 精确指向下标为 1 的条目(Req 7.6)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.safeParse({
      providers: [validProvider, { ...validProvider }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // 变异判据:删掉重复标识检查 → 此处转红。
      expect(r.error.issues.some((i) => i.path.join(".") === "providers.1.id")).toBe(true);
    }
  });

  it("标识与保留名冲突 → 拒绝,issue 精确指向该条目下标(Req 7.6)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const r = schema.safeParse({
      providers: [
        { ...validProvider, id: "harmless" },
        { ...validProvider, id: "anthropic" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // 变异判据:删掉保留名注入检查 → 此处转红(reservedProviderIds 未被消费)。
      expect(r.error.issues.some((i) => i.path.join(".") === "providers.1.id")).toBe(true);
      // 未冲突的第 0 条不应被牵连报错。
      expect(r.error.issues.some((i) => i.path.join(".") === "providers.0.id")).toBe(false);
    }
  });

  it("保留名集合由调用方注入 —— 同一 id 换一套保留名集合后结果不同(证明非硬编码)", () => {
    const schemaWithoutConflict = createProvidersConfigSchema(new Set(["someone-else"]));
    const schemaWithConflict = createProvidersConfigSchema(new Set(["anthropic"]));
    const payload = { providers: [{ ...validProvider, id: "anthropic" }] };
    expect(schemaWithoutConflict.safeParse(payload).success).toBe(true);
    expect(schemaWithConflict.safeParse(payload).success).toBe(false);
  });

  it("input/output 只接受本产品维护的取值域(Req 7.7)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const ok = schema.safeParse({
      providers: [{ ...validProvider, input: ["text", "image"], output: ["text"] }],
    });
    expect(ok.success).toBe(true);

    const bad = schema.safeParse({
      providers: [{ ...validProvider, input: ["not-a-modality"] }],
    });
    expect(bad.success).toBe(false);
  });

  it("PROVIDER_MODALITIES 覆盖四种取值", () => {
    expect([...PROVIDER_MODALITIES].sort()).toEqual(["audio", "image", "text", "video"]);
  });
});

describe("providersFormSchema — 表单 IR(Req 7.1, 7.7)", () => {
  const providersField = providersFormSchema.fields.find((f) => f.key === "providers");
  const itemFields = providersField?.itemFields ?? [];

  it("provider 列表用 objectList(Req 7.1)", () => {
    expect(providersField?.kind).toBe("objectList");
    expect(itemFields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "id",
        "displayName",
        "enabled",
        "baseUrl",
        "apiKey",
        "input",
        "output",
        "models",
      ]),
    );
  });

  it("凭据字段标为 secret(Req 7.3)", () => {
    // 变异判据:把 apiKey 的 kind 改回 string → 此处转红。
    expect(itemFields.find((f) => f.key === "apiKey")?.kind).toBe("secret");
  });

  it("输入/输出类型用 multiEnum,选项覆盖取值域(Req 7.7)", () => {
    const inputField = itemFields.find((f) => f.key === "input");
    const outputField = itemFields.find((f) => f.key === "output");
    expect(inputField?.kind).toBe("multiEnum");
    expect(outputField?.kind).toBe("multiEnum");
    const values = (inputField?.enumOptions ?? []).map((o) => o.value).sort();
    expect(values).toEqual([...PROVIDER_MODALITIES].sort());
  });

  it("模型清单是嵌套的 objectList(Req 7.1)", () => {
    const modelsField = itemFields.find((f) => f.key === "models");
    expect(modelsField?.kind).toBe("objectList");
    const modelItemFields = (modelsField?.itemFields ?? []) as readonly FieldDescriptor[];
    expect(modelItemFields.map((f) => f.key)).toEqual(expect.arrayContaining(["id", "name"]));
  });

  it("启用开关存在且默认值为 true", () => {
    const enabledField = itemFields.find((f) => f.key === "enabled");
    expect(enabledField?.kind).toBe("boolean");
    expect(enabledField?.default).toBe(true);
  });
});

/**
 * provider-visibility-config spec 任务 1.2:展示可见性字段。
 *
 * 它与条目内的 `enabled` 是两回事 —— `enabled` 只管自定义条目且停用即不进目录;
 * `visibility` 覆盖全部已注册 provider 且只作用于展示层。
 */
describe("providers 配置域 — 展示可见性(provider-visibility-config Req 5.4, 7.5)", () => {
  it("未提供时缺省为空对象(零侵入:等价于全部可见)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const parsed = schema.parse({ providers: [validProvider] });
    expect(parsed.visibility).toEqual({});
  });

  it("接受按 provider 标识分键的隐藏声明", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const parsed = schema.parse({
      providers: [],
      visibility: {
        sufy: { hidden: true },
        openrouter: { hiddenModels: ["gpt-4o", "claude-3"] },
      },
    });
    expect(parsed.visibility.sufy?.hidden).toBe(true);
    expect(parsed.visibility.openrouter?.hiddenModels).toEqual(["gpt-4o", "claude-3"]);
  });

  it("两个字段皆可缺省(空壳条目合法)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const parsed = schema.parse({ providers: [], visibility: { openrouter: {} } });
    expect(parsed.visibility.openrouter).toEqual({});
  });

  it("拒绝非法形态:hidden 非布尔、hiddenModels 非字符串数组", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    expect(() =>
      schema.parse({ providers: [], visibility: { a: { hidden: "yes" } } }),
    ).toThrow();
    expect(() =>
      schema.parse({ providers: [], visibility: { a: { hiddenModels: [1, 2] } } }),
    ).toThrow();
  });

  it("既有自定义 provider 条目的字段与行为不受影响(Req 7.5)", () => {
    const schema = createProvidersConfigSchema(RESERVED);
    const parsed = schema.parse({
      providers: [validProvider],
      visibility: { "my-provider": { hidden: true } },
    });
    expect(parsed.providers[0]?.id).toBe("my-provider");
    expect(parsed.providers[0]?.enabled).toBe(true);
    expect(parsed.providers[0]?.models).toEqual([{ id: "model-a", name: "Model A" }]);
  });

  it("表单 IR 里是打了 widget 标记的静态字段(动态数据由前端 renderer 自取)", () => {
    const field = providersFormSchema.fields.find((f) => f.key === "visibility");
    expect(field).toBeDefined();
    expect(field?.kind).toBe("record");
    expect(field?.widget).toBe("providerVisibility");
    // 静态 schema:不得预置任何运行时才知道的选项
    expect(field?.enumOptions).toBeUndefined();
  });
});

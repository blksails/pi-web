import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToFormSchema } from "../../src/config/zod-to-form-schema.js";

describe("zodToFormSchema — 类型映射", () => {
  const schema = z.object({
    name: z.string().describe(JSON.stringify({ label: "名称", order: 1 })),
    apiKey: z.string(),
    count: z.number().optional(),
    enabled: z.boolean().default(true),
    level: z.enum(["a", "b"]).optional(),
    tags: z.array(z.string()).optional(),
    nested: z.object({ inner: z.string() }).optional(),
  });
  const form = zodToFormSchema("demo", schema);
  const field = (k: string) => {
    const f = form.fields.find((x) => x.key === k);
    if (f === undefined) throw new Error(`no field ${k}`);
    return f;
  };

  it("string → string;label 来自元数据", () => {
    expect(field("name").kind).toBe("string");
    expect(field("name").label).toBe("名称");
    expect(field("name").required).toBe(true);
  });

  it("按命名约定识别 secret", () => {
    expect(field("apiKey").kind).toBe("secret");
    expect(field("apiKey").secret).toBe(true);
  });

  it("optional → required:false;default 推断", () => {
    expect(field("count").kind).toBe("number");
    expect(field("count").required).toBe(false);
    expect(field("enabled").kind).toBe("boolean");
    expect(field("enabled").required).toBe(false);
    expect(field("enabled").default).toBe(true);
  });

  it("enum → enumOptions", () => {
    expect(field("level").kind).toBe("enum");
    expect(field("level").enumOptions?.map((o) => o.value)).toEqual(["a", "b"]);
  });

  it("array<string> → stringList;object → 递归 fields", () => {
    expect(field("tags").kind).toBe("stringList");
    expect(field("tags").itemKind).toBe("string");
    expect(field("nested").kind).toBe("object");
    expect(field("nested").fields?.[0]?.key).toBe("inner");
  });

  it("按 order 排序字段", () => {
    expect(form.fields[0]?.key).toBe("name");
  });
});

describe("zodToFormSchema — 顶层 record(auth 形状)", () => {
  const schema = z.record(
    z.object({ apiKey: z.string(), baseURL: z.string().optional() }),
  );
  const form = zodToFormSchema("auth", schema);

  it("产出单个 record 字段,子字段为对象模板", () => {
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0]?.kind).toBe("record");
    const sub = form.fields[0]?.fields ?? [];
    expect(sub.map((f) => f.key).sort()).toEqual(["apiKey", "baseURL"]);
    expect(sub.find((f) => f.key === "apiKey")?.kind).toBe("secret");
  });
});

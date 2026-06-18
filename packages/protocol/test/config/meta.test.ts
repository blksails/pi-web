import { describe, expect, it } from "vitest";
import { parseDescribeMeta, prettifyKey } from "../../src/config/meta.js";

describe("parseDescribeMeta", () => {
  it("解析 JSON 元数据", () => {
    const m = parseDescribeMeta(
      JSON.stringify({ label: "API Key", secret: true, order: 2 }),
    );
    expect(m.label).toBe("API Key");
    expect(m.secret).toBe(true);
    expect(m.order).toBe(2);
  });

  it("普通文本视为 description", () => {
    expect(parseDescribeMeta("一段帮助文本")).toEqual({
      description: "一段帮助文本",
    });
  });

  it("缺省/空 → 空元数据", () => {
    expect(parseDescribeMeta(undefined)).toEqual({});
    expect(parseDescribeMeta("   ")).toEqual({});
  });

  it("看似 JSON 实则非法 → 退化为描述文本", () => {
    const bad = "{not valid json}";
    expect(parseDescribeMeta(bad)).toEqual({ description: bad });
  });
});

describe("prettifyKey", () => {
  it("camelCase / snake_case → 词组", () => {
    expect(prettifyKey("defaultProvider")).toBe("Default Provider");
    expect(prettifyKey("api_key")).toBe("Api key");
    expect(prettifyKey("baseURL")).toBe("Base URL");
  });
});

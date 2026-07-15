import { describe, expect, it } from "vitest";
import {
  authConfigSchema,
  authFormSchema,
  settingsConfigSchema,
  settingsFormSchema,
  CONFIG_FORM_SCHEMAS,
} from "../../src/config/index.js";

describe("auth 域", () => {
  it("接受合法凭证、保留未知字段", () => {
    const parsed = authConfigSchema.parse({
      anthropic: { apiKey: "sk-xxx", extraField: "kept" },
      custom: { apiKey: "k" },
    });
    expect(parsed.anthropic?.apiKey).toBe("sk-xxx");
    expect((parsed.anthropic as Record<string, unknown>)?.extraField).toBe(
      "kept",
    );
  });

  it("拒绝空 apiKey 与非法 baseURL", () => {
    expect(authConfigSchema.safeParse({ x: { apiKey: "" } }).success).toBe(false);
    expect(
      authConfigSchema.safeParse({ x: { apiKey: "k", baseURL: "notaurl" } })
        .success,
    ).toBe(false);
  });

  it("FormSchema 顶层为 record,apiKey 标记 secret", () => {
    expect(authFormSchema.fields[0]?.kind).toBe("record");
    const apiKey = authFormSchema.fields[0]?.fields?.find(
      (f) => f.key === "apiKey",
    );
    expect(apiKey?.secret).toBe(true);
  });
});

describe("settings 域", () => {
  it("theme 默认 system,枚举校验", () => {
    expect(settingsConfigSchema.parse({}).theme).toBe("system");
    expect(settingsConfigSchema.safeParse({ theme: "neon" }).success).toBe(false);
  });

  it("pathDisplay 默认 basename,枚举校验", () => {
    expect(settingsConfigSchema.parse({}).pathDisplay).toBe("basename");
    expect(settingsConfigSchema.safeParse({ pathDisplay: "home" }).success).toBe(
      true,
    );
    expect(
      settingsConfigSchema.safeParse({ pathDisplay: "relative" }).success,
    ).toBe(false);
  });

  it("保留未知字段", () => {
    const parsed = settingsConfigSchema.parse({ futureKey: 1 });
    expect((parsed as Record<string, unknown>).futureKey).toBe(1);
  });

  it("FormSchema 含 model/appearance 分组与思考等级枚举", () => {
    expect(settingsFormSchema.groups?.map((g) => g.id)).toEqual([
      "model",
      "appearance",
    ]);
    const tl = settingsFormSchema.fields.find(
      (f) => f.key === "defaultThinkingLevel",
    );
    expect(tl?.kind).toBe("enum");
    expect(tl?.enumOptions?.length).toBe(5);
  });
});

describe("CONFIG_FORM_SCHEMAS", () => {
  it("含 auth 与 settings", () => {
    expect(CONFIG_FORM_SCHEMAS.auth.domain).toBe("auth");
    expect(CONFIG_FORM_SCHEMAS.settings.domain).toBe("settings");
  });
});

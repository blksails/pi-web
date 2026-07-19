/**
 * 清单 `settings` 段 zod 校验(spec: source-settings-and-slots,任务 1.1,Req 1.1/1.5/13.1/13.2)。
 *
 * 只测**结构**层:合法段解析、非法段(错类型/缺必填)被拒绝、未声明 settings 的既有清单
 * 解析结果零变化(向后兼容回归)。
 */
import { describe, expect, it } from "vitest";
import {
  PiWebManifestSchema,
  PluginSettingsSchema,
  PluginSettingsScopeSchema,
} from "../../src/plugin/index.js";

describe("PluginSettingsScopeSchema", () => {
  it("接受 source / project", () => {
    expect(PluginSettingsScopeSchema.parse("source")).toBe("source");
    expect(PluginSettingsScopeSchema.parse("project")).toBe("project");
  });

  it("拒绝未知作用域", () => {
    expect(PluginSettingsScopeSchema.safeParse("global").success).toBe(false);
  });
});

describe("PluginSettingsSchema", () => {
  it("接受合法段并对 scope 应用缺省值", () => {
    const parsed = PluginSettingsSchema.parse({
      schema: "settings/schema.json",
      title: "CRM 设置",
      icon: "settings",
      widgets: ["crmEntityPicker"],
    });
    expect(parsed.schema).toBe("settings/schema.json");
    expect(parsed.scope).toBe("source");
    expect(parsed.widgets).toEqual(["crmEntityPicker"]);
  });

  it("接受显式 scope:project", () => {
    const parsed = PluginSettingsSchema.parse({
      schema: "settings/schema.json",
      scope: "project",
    });
    expect(parsed.scope).toBe("project");
  });

  it("只含必填 schema 字段即可解析(title/icon/widgets 均可选)", () => {
    const parsed = PluginSettingsSchema.parse({ schema: "settings/schema.json" });
    expect(parsed.title).toBeUndefined();
    expect(parsed.icon).toBeUndefined();
    expect(parsed.widgets).toBeUndefined();
  });

  it("拒绝缺失 schema(必填)", () => {
    expect(PluginSettingsSchema.safeParse({ title: "无 schema" }).success).toBe(false);
  });

  it("拒绝空串 schema", () => {
    expect(PluginSettingsSchema.safeParse({ schema: "" }).success).toBe(false);
  });

  it("拒绝错误类型(schema 非字符串、widgets 非字符串数组、scope 非枚举值)", () => {
    expect(PluginSettingsSchema.safeParse({ schema: 123 }).success).toBe(false);
    expect(
      PluginSettingsSchema.safeParse({ schema: "settings/schema.json", widgets: "crmEntityPicker" })
        .success,
    ).toBe(false);
    expect(
      PluginSettingsSchema.safeParse({ schema: "settings/schema.json", scope: "user" }).success,
    ).toBe(false);
  });
});

describe("PiWebManifestSchema(settings 段扩展后)", () => {
  it("挂载合法 settings 段的完整清单可解析", () => {
    const parsed = PiWebManifestSchema.parse({
      id: "module-settings-agent",
      version: "0.1.0",
      kind: "agent",
      settings: {
        schema: "settings/schema.json",
        title: "模块设置",
        scope: "source",
        widgets: ["crmEntityPicker"],
      },
    });
    expect(parsed.settings?.schema).toBe("settings/schema.json");
    expect(parsed.settings?.scope).toBe("source");
  });

  it("settings 段结构非法时整单拒绝", () => {
    expect(
      PiWebManifestSchema.safeParse({
        id: "x",
        version: "1.0.0",
        settings: { title: "缺 schema" },
      }).success,
    ).toBe(false);
  });

  it("未声明 settings 的既有清单解析结果零变化(向后兼容回归)", () => {
    const legacy = PiWebManifestSchema.parse({ id: "code-review", version: "1.0.0" });
    expect(legacy.settings).toBeUndefined();
    expect(legacy.kind).toBe("plugin");

    const agent = PiWebManifestSchema.parse({ id: "hello", version: "1.0.0", kind: "agent" });
    expect(agent.settings).toBeUndefined();

    const component = PiWebManifestSchema.parse({
      id: "canvas-watermark",
      version: "0.1.0",
      kind: "component",
      component: {
        files: ["components/watermark/watermark.tsx"],
        wiring: { point: "canvasPlugins", export: "watermarkBundle", from: "./components/watermark/watermark" },
      },
    });
    expect(component.settings).toBeUndefined();
  });
});

/**
 * TDD — logging 配置域 schema 契约测试（任务 2.2）
 * RED phase: 在实现前捕获失败
 */
import { describe, expect, it } from "vitest";
import {
  loggingConfigSchema,
  loggingFormSchema,
  LOGGING_GROUPS,
  CONFIG_FORM_SCHEMAS,
} from "../../src/config/index.js";

describe("loggingConfigSchema — 默认值", () => {
  it("enabled 默认 false（日志默认关闭，需在 Settings 开启）", () => {
    const parsed = loggingConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
  });

  it("level 默认 info", () => {
    const parsed = loggingConfigSchema.parse({});
    expect(parsed.level).toBe("info");
  });

  it("panelDefaultLevel 默认 info", () => {
    const parsed = loggingConfigSchema.parse({});
    expect(parsed.panelDefaultLevel).toBe("info");
  });

  it("outputs.console 默认 true（当 outputs 被提供时）", () => {
    const parsed = loggingConfigSchema.parse({ outputs: {} });
    expect(parsed.outputs?.console).toBe(true);
  });

  it("outputs.panelVisible 默认 true（当 outputs 被提供时）", () => {
    const parsed = loggingConfigSchema.parse({ outputs: {} });
    expect(parsed.outputs?.panelVisible).toBe(true);
  });

  it("outputs.panelPosition 默认 bottom（当 outputs 被提供时）", () => {
    const parsed = loggingConfigSchema.parse({ outputs: {} });
    expect(parsed.outputs?.panelPosition).toBe("bottom");
  });
});

describe("loggingConfigSchema — 枚举校验", () => {
  it("非法 level 被拒", () => {
    expect(loggingConfigSchema.safeParse({ level: "verbose" }).success).toBe(false);
    expect(loggingConfigSchema.safeParse({ level: "trace" }).success).toBe(false);
  });

  it("合法 level 枚举值全部接受", () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      expect(loggingConfigSchema.safeParse({ level }).success).toBe(true);
    }
  });

  it("非法 panelDefaultLevel 被拒", () => {
    expect(
      loggingConfigSchema.safeParse({ panelDefaultLevel: "verbose" }).success,
    ).toBe(false);
  });

  it("outputs.panelPosition 接受 bottom/right/drawer", () => {
    for (const pos of ["bottom", "right", "drawer"]) {
      expect(
        loggingConfigSchema.safeParse({ outputs: { panelPosition: pos } }).success,
      ).toBe(true);
    }
  });

  it("outputs.panelPosition 拒绝非法值", () => {
    expect(
      loggingConfigSchema.safeParse({ outputs: { panelPosition: "top" } }).success,
    ).toBe(false);
    expect(
      loggingConfigSchema.safeParse({ outputs: { panelPosition: "float" } }).success,
    ).toBe(false);
  });
});

describe("loggingConfigSchema — namespaces", () => {
  it("接受 record<string, boolean>", () => {
    const parsed = loggingConfigSchema.parse({
      namespaces: { "chat:core": true, "tool:exec": false },
    });
    expect(parsed.namespaces?.["chat:core"]).toBe(true);
    expect(parsed.namespaces?.["tool:exec"]).toBe(false);
  });

  it("namespaces 可省略", () => {
    const parsed = loggingConfigSchema.parse({});
    expect(parsed.namespaces).toBeUndefined();
  });
});

describe("loggingConfigSchema — passthrough", () => {
  it("保留未知字段", () => {
    const parsed = loggingConfigSchema.parse({ futureKey: "future" });
    expect((parsed as Record<string, unknown>).futureKey).toBe("future");
  });
});

describe("loggingFormSchema — 字段检查", () => {
  it("namespaces 字段 widget 为 logNamespaceToggles（6.7 自定义控件标记）", () => {
    const ns = loggingFormSchema.fields.find((f) => f.key === "namespaces");
    expect(ns).toBeDefined();
    expect(ns?.widget).toBe("logNamespaceToggles");
  });

  it("level 字段为 enum 类型", () => {
    const level = loggingFormSchema.fields.find((f) => f.key === "level");
    expect(level?.kind).toBe("enum");
    expect(level?.enumOptions?.map((o) => o.value)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });

  it("panelDefaultLevel 字段为 enum 类型", () => {
    const pdl = loggingFormSchema.fields.find((f) => f.key === "panelDefaultLevel");
    expect(pdl?.kind).toBe("enum");
  });

  it("enabled 字段为 boolean 类型", () => {
    const enabled = loggingFormSchema.fields.find((f) => f.key === "enabled");
    expect(enabled?.kind).toBe("boolean");
  });
});

describe("loggingFormSchema — 分组", () => {
  it("含 general/components/output 三个分组", () => {
    const groupIds = LOGGING_GROUPS.map((g) => g.id);
    expect(groupIds).toContain("general");
    expect(groupIds).toContain("components");
    expect(groupIds).toContain("output");
  });

  it("enabled/level 在 general 分组", () => {
    const enabled = loggingFormSchema.fields.find((f) => f.key === "enabled");
    const level = loggingFormSchema.fields.find((f) => f.key === "level");
    expect(enabled?.group).toBe("general");
    expect(level?.group).toBe("general");
  });

  it("namespaces 在 components 分组", () => {
    const ns = loggingFormSchema.fields.find((f) => f.key === "namespaces");
    expect(ns?.group).toBe("components");
  });

  it("outputs/panelDefaultLevel 在 output 分组", () => {
    const outputs = loggingFormSchema.fields.find((f) => f.key === "outputs");
    const pdl = loggingFormSchema.fields.find((f) => f.key === "panelDefaultLevel");
    expect(outputs?.group).toBe("output");
    expect(pdl?.group).toBe("output");
  });
});

describe("CONFIG_FORM_SCHEMAS", () => {
  it("含 logging 域", () => {
    expect(CONFIG_FORM_SCHEMAS.logging).toBeDefined();
    expect(CONFIG_FORM_SCHEMAS.logging.domain).toBe("logging");
  });

  it("logging 域含 namespaces 字段且标记 widget logNamespaceToggles", () => {
    const ns = CONFIG_FORM_SCHEMAS.logging.fields.find(
      (f) => f.key === "namespaces",
    );
    expect(ns).toBeDefined();
    expect(ns?.widget).toBe("logNamespaceToggles");
  });

  it("outputs 字段含 panelPosition enum（enumOptions 包含 bottom/right/drawer）", () => {
    const outputs = CONFIG_FORM_SCHEMAS.logging.fields.find(
      (f) => f.key === "outputs",
    );
    expect(outputs).toBeDefined();
    expect(outputs?.kind).toBe("object");
    // panelPosition is a nested field inside outputs.fields
    const panelPosition = (outputs?.fields ?? []).find(
      (f) => f.key === "panelPosition",
    );
    expect(panelPosition).toBeDefined();
    expect(panelPosition?.kind).toBe("enum");
    const values = (panelPosition?.enumOptions ?? []).map((o) => o.value);
    expect(values).toContain("bottom");
    expect(values).toContain("right");
    expect(values).toContain("drawer");
  });
});

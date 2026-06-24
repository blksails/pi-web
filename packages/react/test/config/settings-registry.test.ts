import { describe, expect, it } from "vitest";
import { settingsFormSchema, authFormSchema } from "@blksails/pi-web-protocol";
import {
  createSettingsRegistry,
  type SettingsPanelDescriptor,
} from "../../src/config/settings-registry.js";

function panel(
  id: string,
  order: number,
  formSchema = settingsFormSchema,
): SettingsPanelDescriptor {
  return {
    id,
    title: id,
    order,
    formSchema,
    load: async () => ({}),
    save: async () => undefined,
  };
}

describe("settings-registry", () => {
  it("按 order 列举,resolve 命中", () => {
    const r = createSettingsRegistry();
    r.registerPanel(panel("settings", 2));
    r.registerPanel(panel("auth", 1, authFormSchema));
    expect(r.listPanels().map((p) => p.id)).toEqual(["auth", "settings"]);
    expect(r.resolvePanel("auth")?.id).toBe("auth");
    expect(r.resolvePanel("missing")).toBeUndefined();
  });

  it("覆盖语义:同 id 最后写入胜出且不重复列举", () => {
    const r = createSettingsRegistry();
    r.registerPanel(panel("auth", 1));
    r.registerPanel({ ...panel("auth", 1), title: "凭证(新)" });
    expect(r.listPanels()).toHaveLength(1);
    expect(r.resolvePanel("auth")?.title).toBe("凭证(新)");
  });

  it("工厂实例互相隔离", () => {
    const a = createSettingsRegistry();
    const b = createSettingsRegistry();
    a.registerPanel(panel("auth", 1));
    expect(b.listPanels()).toHaveLength(0);
  });
});

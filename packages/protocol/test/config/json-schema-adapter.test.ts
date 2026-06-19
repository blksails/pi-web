import { describe, it, expect } from "vitest";
import { jsonSchemaToFormSchema } from "../../src/config/json-schema-to-form-schema.js";
import type { FieldDescriptor } from "../../src/config/form-schema.js";

/** 近似 @aizigao/pi-proxy-fetch 的 proxy.json schema(含 $ref / oneOf / 嵌套对象数组)。 */
const PROXY_SCHEMA = {
  title: "pi-proxy-fetch Config",
  type: "object",
  required: ["version", "enabled", "profileName", "profileConfig"],
  properties: {
    version: { type: "number", const: 1, description: "Config schema version." },
    enabled: { type: "boolean", description: "Global ON/OFF switch." },
    profileName: { type: "string", default: "auto-switch", examples: ["direct", "system"] },
    profileConfig: {
      type: "array",
      items: { oneOf: [{ $ref: "#/$defs/proxyServer" }, { $ref: "#/$defs/autoSwitch" }] },
    },
  },
  $defs: {
    proxyServer: {
      type: "object",
      title: "Proxy Server",
      required: ["name", "type", "server"],
      properties: {
        name: { type: "string" },
        type: { type: "string", const: "proxy_server" },
        server: { type: "string" },
      },
    },
    autoSwitch: {
      type: "object",
      title: "Auto Switch",
      required: ["name", "type", "switchRules"],
      properties: {
        name: { type: "string" },
        type: { type: "string", const: "autoSwitch" },
        switchRules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              note: { type: "string" },
              profileName: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function byKey(fields: readonly FieldDescriptor[], key: string): FieldDescriptor {
  const f = fields.find((x) => x.key === key);
  if (!f) throw new Error(`field ${key} not found`);
  return f;
}

describe("jsonSchemaToFormSchema", () => {
  const form = jsonSchemaToFormSchema(PROXY_SCHEMA);

  it("顶层 object → 字段 + title/domain", () => {
    expect(form.title).toBe("pi-proxy-fetch Config");
    expect(form.fields.map((f) => f.key)).toEqual([
      "version",
      "enabled",
      "profileName",
      "profileConfig",
    ]);
  });

  it("标量映射:number(const)/boolean/string(+default,examples)", () => {
    expect(byKey(form.fields, "version").kind).toBe("number");
    expect(byKey(form.fields, "version").default).toBe(1);
    expect(byKey(form.fields, "enabled").kind).toBe("boolean");
    const pn = byKey(form.fields, "profileName");
    expect(pn.kind).toBe("string");
    expect(pn.default).toBe("auto-switch");
    expect(pn.placeholder).toBe("direct");
  });

  it("required 标记", () => {
    expect(byKey(form.fields, "version").required).toBe(true);
  });

  it("对象数组 + oneOf → objectList + variants(判别 type),$ref 内联", () => {
    const pc = byKey(form.fields, "profileConfig");
    expect(pc.kind).toBe("objectList");
    expect(pc.variants).toBeDefined();
    expect(pc.variants?.discriminator).toBe("type");
    const cases = pc.variants?.cases ?? [];
    expect(cases.map((c) => c.value).sort()).toEqual(["autoSwitch", "proxy_server"]);
    // 变体字段排除判别键 type;proxy_server 含 name/server。
    const proxyCase = cases.find((c) => c.value === "proxy_server")!;
    expect(proxyCase.fields.map((f) => f.key)).toEqual(["name", "server"]);
  });

  it("嵌套对象数组(autoSwitch.switchRules)→ objectList + itemFields", () => {
    const pc = byKey(form.fields, "profileConfig");
    const autoCase = pc.variants?.cases.find((c) => c.value === "autoSwitch")!;
    const sr = byKey(autoCase.fields, "switchRules");
    expect(sr.kind).toBe("objectList");
    expect((sr.itemFields ?? []).map((f) => f.key)).toEqual(["note", "profileName"]);
  });
});

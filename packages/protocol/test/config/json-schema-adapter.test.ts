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

/** 近似 pi-mcp-adapter 的 mcp.json schema(含动态键 map mcpServers)。 */
const MCP_SCHEMA = {
  title: "pi-mcp-adapter Config",
  type: "object",
  properties: {
    settings: {
      type: "object",
      properties: {
        toolPrefix: { type: "string" },
        idleTimeout: { type: "number" },
      },
    },
    mcpServers: {
      type: "object",
      // 动态键:服务器名 → 配置对象
      additionalProperties: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          debug: { type: "boolean" },
        },
      },
    },
    imports: { type: "array", items: { type: "string" } },
  },
};

function byKeyTop(fields: readonly FieldDescriptor[], key: string): FieldDescriptor {
  const f = fields.find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
}

describe("record 支持(动态键 map)", () => {
  it("additionalProperties 为对象 → record + 以值对象字段为子字段模板", () => {
    const form = jsonSchemaToFormSchema(MCP_SCHEMA);
    const servers = byKeyTop(form.fields, "mcpServers");
    expect(servers.kind).toBe("record");
    expect((servers.fields ?? []).map((f) => f.key)).toEqual(["command", "args", "debug"]);
    // 固定 properties 对象不被误判为 record
    expect(byKeyTop(form.fields, "settings").kind).toBe("object");
    // 标量数组仍为 stringList
    expect(byKeyTop(form.fields, "imports").kind).toBe("stringList");
  });

  it("additionalProperties 为标量 → record + itemKind", () => {
    const form = jsonSchemaToFormSchema({
      type: "object",
      properties: { env: { type: "object", additionalProperties: { type: "string" } } },
    });
    const env = byKeyTop(form.fields, "env");
    expect(env.kind).toBe("record");
    expect(env.itemKind).toBe("string");
    expect(env.fields).toBeUndefined();
  });

  it("patternProperties → record(取首个模式值 schema)", () => {
    const form = jsonSchemaToFormSchema({
      type: "object",
      properties: {
        hosts: {
          type: "object",
          patternProperties: { "^.*$": { type: "object", properties: { port: { type: "number" } } } },
        },
      },
    });
    const hosts = byKeyTop(form.fields, "hosts");
    expect(hosts.kind).toBe("record");
    expect((hosts.fields ?? []).map((f) => f.key)).toEqual(["port"]);
  });

  it("additionalProperties: false / true(布尔) 不触发 record", () => {
    const formFalse = jsonSchemaToFormSchema({
      type: "object",
      properties: { a: { type: "object", additionalProperties: false, properties: { x: { type: "string" } } } },
    });
    expect(byKeyTop(formFalse.fields, "a").kind).toBe("object");
    const formTrue = jsonSchemaToFormSchema({
      type: "object",
      properties: { b: { type: "object", additionalProperties: true } },
    });
    // 无固定字段、additionalProperties 为 true(布尔)→ 退回 object(空)而非 record
    expect(byKeyTop(formTrue.fields, "b").kind).toBe("object");
  });
});

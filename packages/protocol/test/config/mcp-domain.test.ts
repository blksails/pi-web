/**
 * 单元:mcp 配置域 —— 校验 schema 与表单 IR(spec: builtin-mcp-client,任务 1.2;Req 1.1, 2.*, 4.5, 7.2)。
 */
import { describe, it, expect } from "vitest";
import {
  mcpConfigSchema,
  mcpFormSchema,
  MCP_TRANSPORT_TYPES,
} from "../../src/config/domains/mcp.js";
import type { FieldDescriptor } from "../../src/config/form-schema.js";

const stdioServer = {
  name: "files",
  transport: { type: "stdio", command: "npx", args: ["-y", "pkg"], env: {} },
};

describe("mcpConfigSchema — 三传输校验(Req 2.1-2.3, 2.5)", () => {
  it("接受三种标准传输(Req 2.1)", () => {
    for (const type of MCP_TRANSPORT_TYPES) {
      const transport =
        type === "stdio"
          ? { type, command: "npx" }
          : { type, url: "https://example.com/mcp" };
      const parsed = mcpConfigSchema.safeParse({ servers: [{ name: "s", transport }] });
      expect(parsed.success, `transport ${type} should parse`).toBe(true);
    }
  });

  it("stdio 缺启动命令 → 拒绝(Req 2.2, 2.5)", () => {
    const r = mcpConfigSchema.safeParse({ servers: [{ name: "s", transport: { type: "stdio" } }] });
    expect(r.success).toBe(false);
  });

  it("远程传输缺服务端地址 → 拒绝(Req 2.3, 2.5)", () => {
    for (const type of ["sse", "streamable-http"] as const) {
      const r = mcpConfigSchema.safeParse({ servers: [{ name: "s", transport: { type } }] });
      expect(r.success, `${type} without url must fail`).toBe(false);
    }
  });

  it("非法 url → 拒绝(Req 2.5)", () => {
    const r = mcpConfigSchema.safeParse({
      servers: [{ name: "s", transport: { type: "sse", url: "not-a-url" } }],
    });
    expect(r.success).toBe(false);
  });

  it("未知传输类型 → 拒绝(判别联合)", () => {
    const r = mcpConfigSchema.safeParse({
      servers: [{ name: "s", transport: { type: "websocket", url: "wss://x" } }],
    });
    expect(r.success).toBe(false);
  });

  it("重复 server 名 → 拒绝,且 issue 指向重复项(Req 1.1, 2.5)", () => {
    const r = mcpConfigSchema.safeParse({ servers: [stdioServer, { ...stdioServer }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      // 变异判据:删掉 superRefine 的唯一性检查 → 此处转红。
      expect(r.error.issues.some((i) => i.path.join(".") === "servers.1.name")).toBe(true);
    }
  });

  it("名称形状受限(须可安全嵌入工具名,Req 3.4)", () => {
    for (const bad of ["", "has space", "has__sep", "-lead"]) {
      const r = mcpConfigSchema.safeParse({
        servers: [{ name: bad, transport: { type: "stdio", command: "x" } }],
      });
      expect(r.success, `name ${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("enabled 缺省视为启用(Req 1.4 的反面)", () => {
    const r = mcpConfigSchema.parse({ servers: [stdioServer] });
    expect(r.servers[0]?.enabled).toBe(true);
  });

  it("未识别字段不被剥离(passthrough,Req 5.4 的一半)", () => {
    const r = mcpConfigSchema.parse({ servers: [stdioServer], futureKey: { a: 1 } });
    expect((r as Record<string, unknown>)["futureKey"]).toEqual({ a: 1 });
  });
});

describe("mcpFormSchema — 表单 IR(Req 2.4, 4.1, 4.5, 7.2)", () => {
  const serversField = mcpFormSchema.fields.find((f) => f.key === "servers");
  const itemFields = serversField?.itemFields ?? [];
  const transportField = itemFields.find((f) => f.key === "transport");

  it("server 列表用 objectList(Req 4.2)", () => {
    expect(serversField?.kind).toBe("objectList");
    expect(itemFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(["name", "enabled", "transport"]),
    );
  });

  it("启用开关存在(Req 4.5)", () => {
    expect(itemFields.find((f) => f.key === "enabled")?.kind).toBe("boolean");
  });

  it("传输字段用 variants 判别,三分支字段集互不相同(Req 2.4)", () => {
    const variants = transportField?.variants;
    expect(variants?.discriminator).toBe("type");
    const values = variants?.cases.map((c) => c.value) ?? [];
    expect([...values].sort()).toEqual([...MCP_TRANSPORT_TYPES].sort());

    const keysOf = (v: string): string[] =>
      (variants?.cases.find((c) => c.value === v)?.fields ?? []).map((f) => f.key).sort();
    // 变异判据:若三分支共用同一字段集(丢掉按协议切换),stdio 与远程的字段集会相等 → 转红。
    expect(keysOf("stdio")).not.toEqual(keysOf("sse"));
    expect(keysOf("stdio")).toContain("command");
    expect(keysOf("sse")).toContain("url");
    expect(keysOf("streamable-http")).toContain("url");
  });

  it("env / headers 的值一律按 secret 掩码(Req 7.2)", () => {
    const cases = transportField?.variants?.cases ?? [];
    const find = (v: string, key: string): FieldDescriptor | undefined =>
      cases.find((c) => c.value === v)?.fields.find((f) => f.key === key);

    // 变异判据:去掉 itemKind:"secret" → 凭据值不再掩码,此处转红。
    expect(find("stdio", "env")?.itemKind).toBe("secret");
    expect(find("sse", "headers")?.itemKind).toBe("secret");
    expect(find("streamable-http", "headers")?.itemKind).toBe("secret");
  });
});

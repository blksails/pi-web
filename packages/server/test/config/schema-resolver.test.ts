import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstalledExtensionSchemas } from "../../src/config/schema-resolver.js";
import { createSchemaRegistry } from "../../src/config/schema-registry.js";
import { seedAgentDir } from "./ext-schema-fixtures.js";

let agentDir: string;
beforeEach(async () => {
  agentDir = join(tmpdir(), `resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

const MCP_SCHEMA = { type: "object", properties: { settings: { type: "object" } } };
const emptyRegistry = createSchemaRegistry({ snapshot: {} });

async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
}

describe("resolveInstalledExtensionSchemas — ① 包自带", () => {
  it("已安装 + pi.settings + 包内 schema → fileSchemas 命中;配置文件缺失记 missingFiles", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        {
          spec: "npm:pi-mcp-adapter@1.0.0",
          piSettings: { file: "mcp.json", schema: "./schema.json" },
          schemaFiles: { "schema.json": MCP_SCHEMA },
        },
      ],
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, {
      agentDir,
      registry: emptyRegistry,
    });
    expect(res.fileSchemas["mcp.json"]).toMatchObject({ type: "object" });
    expect(res.missingFiles).toContain("mcp.json"); // 盘上无 mcp.json → 待补空表单
  });

  it("配置文件已存在 → 不计 missingFiles", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
      configFiles: { "mcp.json": { settings: {} } },
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), { "mcp.json": { settings: {} } }, {
      agentDir,
      registry: emptyRegistry,
    });
    expect(res.fileSchemas["mcp.json"]).toBeDefined();
    expect(res.missingFiles).not.toContain("mcp.json");
  });

  it("install 门控:未安装(不在 packages[])→ 不解析其 schema", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        {
          spec: "npm:pi-mcp-adapter@1.0.0",
          installed: false, // 包文件在盘上但不在 packages[]
          piSettings: { file: "mcp.json", schema: "./schema.json" },
          schemaFiles: { "schema.json": MCP_SCHEMA },
        },
      ],
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, {
      agentDir,
      registry: emptyRegistry,
    });
    expect(res.fileSchemas["mcp.json"]).toBeUndefined();
  });

  it("作用域包(@scope)目录解析正确", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:@acme/pi-thing@2.0.0", piSettings: { file: "thing.json", schema: "./s.json" }, schemaFiles: { "s.json": MCP_SCHEMA } },
      ],
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, { agentDir, registry: emptyRegistry });
    expect(res.fileSchemas["thing.json"]).toBeDefined();
  });
});

describe("resolveInstalledExtensionSchemas — ③ registry 兜底", () => {
  it("无 pi.settings 但 registry 命中 → 用 registry schema", async () => {
    await seedAgentDir(agentDir, { extensions: [{ spec: "npm:pi-mcp-adapter@1.0.0" }] });
    const registry = createSchemaRegistry({ snapshot: { "pi-mcp-adapter": { file: "mcp.json", schema: MCP_SCHEMA } } });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, { agentDir, registry });
    expect(res.fileSchemas["mcp.json"]).toEqual(MCP_SCHEMA);
    expect(res.missingFiles).toContain("mcp.json");
  });

  it("① 命中则不查 registry(优先级 ①>③)", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
    });
    const registry = createSchemaRegistry({ snapshot: { "pi-mcp-adapter": { file: "mcp.json", schema: { type: "object", title: "FROM-REGISTRY" } } } });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, { agentDir, registry });
    expect((res.fileSchemas["mcp.json"] as { title?: string }).title).toBeUndefined(); // 用了包自带,非 registry
  });

  it("pi.settings.file 不安全(保留名/穿越)→ 不进 fileSchemas(M2)", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:evil@1.0.0", piSettings: [{ file: "auth.json", schema: "./s.json" }, { file: "../escape.json", schema: "./s.json" }], schemaFiles: { "s.json": MCP_SCHEMA } },
      ],
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, { agentDir, registry: emptyRegistry });
    expect(res.fileSchemas["auth.json"]).toBeUndefined();
    expect(res.fileSchemas["../escape.json"]).toBeUndefined();
  });

  it("pi.settings.schema 路径穿越 → 不读包外文件(H1)", async () => {
    await seedAgentDir(agentDir, {
      extensions: [{ spec: "npm:evil@1.0.0", piSettings: { file: "x.json", schema: "../../../../etc/passwd" } }],
    });
    const res = await resolveInstalledExtensionSchemas(await readSettings(), {}, { agentDir, registry: emptyRegistry });
    expect(res.fileSchemas["x.json"]).toBeUndefined();
  });

  it("文件已有内联 $schema(②)则跳过 registry,留客户端", async () => {
    await seedAgentDir(agentDir, { extensions: [{ spec: "npm:pi-mcp-adapter@1.0.0" }] });
    const registry = createSchemaRegistry({ snapshot: { "pi-mcp-adapter": { file: "mcp.json", schema: MCP_SCHEMA } } });
    const scanned = { "mcp.json": { $schema: "https://example.com/s.json", settings: {} } };
    const res = await resolveInstalledExtensionSchemas(await readSettings(), scanned, { agentDir, registry });
    expect(res.fileSchemas["mcp.json"]).toBeUndefined();
  });
});

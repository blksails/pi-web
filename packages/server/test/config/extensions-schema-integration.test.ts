/**
 * 集成:扩展配置端点接入 schema 解析(真实 handler + 临时 agentDir + 假扩展夹具)。
 * 覆盖 ① 包自带 / ③ registry / install 门控 / 空占位 / PUT 新建与非破坏。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createExtensionsConfigRoutes } from "../../src/config/extensions-config-routes.js";
import { createSchemaRegistry } from "../../src/config/schema-registry.js";
import { seedAgentDir } from "./ext-schema-fixtures.js";

let agentDir: string;
beforeEach(async () => {
  agentDir = join(tmpdir(), `ext-schema-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

const MCP_SCHEMA = { type: "object", properties: { settings: { type: "object" } } };

function makeHandler(schemaRegistry = createSchemaRegistry({ snapshot: {} })) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createExtensionsConfigRoutes({ agentDir, defaultCwd: agentDir, schemaRegistry }),
    authResolver: () => ({ anonymous: true }),
  });
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  return t.length > 0 ? (JSON.parse(t) as Record<string, unknown>) : {};
}

describe("GET /config/extensions/global — schema 解析", () => {
  it("① 包自带 + 配置文件缺失 → fileSchemas 命中 + values.files 空占位", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
    });
    const res = await makeHandler()(new Request("http://x/config/extensions/global"));
    const body = await readBody(res);
    const fileSchemas = body["fileSchemas"] as Record<string, unknown>;
    const values = body["values"] as { files?: Record<string, unknown> };
    expect(fileSchemas?.["mcp.json"]).toMatchObject({ type: "object" });
    expect(values.files?.["mcp.json"]).toEqual({}); // 空占位以供新建
  });

  it("install 门控:未安装(不在 packages[])→ 无 fileSchemas", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", installed: false, piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
    });
    const res = await makeHandler()(new Request("http://x/config/extensions/global"));
    const body = await readBody(res);
    expect(body["fileSchemas"]).toBeUndefined();
  });

  it("项目作用域:① 包自带 schema 经全局包树解析(M1)", async () => {
    // 包(含 pi.settings + 包内 schema)装在全局包树;项目 settings.json 列入该包。
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
    });
    await fs.mkdir(join(agentDir, ".pi"), { recursive: true });
    await fs.writeFile(join(agentDir, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-mcp-adapter@1.0.0"] }));
    const res = await makeHandler()(
      new Request(`http://x/config/extensions/project?cwd=${encodeURIComponent(agentDir)}`),
    );
    const body = await readBody(res);
    expect((body["fileSchemas"] as Record<string, unknown>)?.["mcp.json"]).toMatchObject({ type: "object" });
  });

  it("③ registry:无 pi.settings 但 registry 命中 → fileSchemas 来自 registry", async () => {
    await seedAgentDir(agentDir, { extensions: [{ spec: "npm:pi-mcp-adapter@1.0.0" }] });
    const registry = createSchemaRegistry({ snapshot: { "pi-mcp-adapter": { file: "mcp.json", schema: MCP_SCHEMA } } });
    const res = await makeHandler(registry)(new Request("http://x/config/extensions/global"));
    const body = await readBody(res);
    expect((body["fileSchemas"] as Record<string, unknown>)?.["mcp.json"]).toEqual(MCP_SCHEMA);
  });
});

describe("PUT /config/extensions/global — 新建与非破坏", () => {
  it("填写后创建新文件;空未改占位不落盘;保留 settings.json 既有键", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": MCP_SCHEMA } },
      ],
      settingsExtra: { theme: "dark", defaultProvider: "anthropic" },
    });
    const handler = makeHandler();

    // 空占位不落盘
    const putEmpty = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { files: { "mcp.json": {} } } }),
      }),
    );
    expect(putEmpty.status).toBe(200);
    await expect(fs.access(join(agentDir, "mcp.json"))).rejects.toThrow();

    // 填写后创建
    const putFilled = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { files: { "mcp.json": { settings: { toolPrefix: "srv" } } } } }),
      }),
    );
    expect(putFilled.status).toBe(200);
    const written = JSON.parse(await fs.readFile(join(agentDir, "mcp.json"), "utf8")) as Record<string, unknown>;
    expect(written).toEqual({ settings: { toolPrefix: "srv" } });

    // settings.json 既有键非破坏保留
    const settings = JSON.parse(await fs.readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
    expect(settings["theme"]).toBe("dark");
    expect(settings["defaultProvider"]).toBe("anthropic");
    expect(settings["packages"]).toContain("npm:pi-mcp-adapter@1.0.0");
  });
});

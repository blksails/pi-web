/**
 * Node e2e — 扩展 settings schema:经真实 createPiWebHandler + 真实**默认** registry
 * (内置离线快照 schema-registry.data.json,无注入)+ 真实落盘的假扩展包,端到端验证:
 *   ① 包自带 schema、③ 内置 registry(离线)、①>③ 优先级、install 门控、空占位、PUT 新建。
 * 确定性、无网络。区别于集成单测(注入空 registry):此处走生产默认 registry 数据文件。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createExtensionsConfigRoutes } from "../../src/config/extensions-config-routes.js";
import { seedAgentDir } from "./ext-schema-fixtures.js";

let agentDir: string;
beforeEach(async () => {
  agentDir = join(tmpdir(), `extschema-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

const BUNDLED = { title: "BUNDLED", type: "object", properties: { settings: { type: "object" } } };

/** 真实默认 registry(不注入 schemaRegistry → 用内置快照)。 */
function handler() {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createExtensionsConfigRoutes({ agentDir, defaultCwd: agentDir }),
    authResolver: () => ({ anonymous: true }),
  });
}

async function getExt(): Promise<{ values: { files?: Record<string, unknown> }; fileSchemas?: Record<string, unknown> }> {
  const res = await handler()(new Request("http://x/config/extensions/global"));
  return (await res.json()) as never;
}

describe("扩展 settings schema e2e — 真实 handler + 默认 registry", () => {
  it("③ 内置 registry(离线):已装 pi-mcp-adapter 但无 pi.settings → 命中内置快照内联 schema", async () => {
    await seedAgentDir(agentDir, { extensions: [{ spec: "npm:pi-mcp-adapter@1.0.0" }] });
    const body = await getExt();
    expect((body.fileSchemas?.["mcp.json"] as { title?: string })?.title).toBe("pi-mcp-adapter Config");
    expect(body.values.files?.["mcp.json"]).toEqual({}); // 待新建空占位
  });

  it("①>③ 优先级:有 pi.settings 时用包自带,非内置 registry", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": BUNDLED } },
      ],
    });
    const body = await getExt();
    expect((body.fileSchemas?.["mcp.json"] as { title?: string })?.title).toBe("BUNDLED");
  });

  it("install 门控:未列入 packages[] → 无 fileSchemas", async () => {
    await seedAgentDir(agentDir, {
      extensions: [
        { spec: "npm:pi-mcp-adapter@1.0.0", installed: false, piSettings: { file: "mcp.json", schema: "./schema.json" }, schemaFiles: { "schema.json": BUNDLED } },
      ],
    });
    expect((await getExt()).fileSchemas).toBeUndefined();
  });

  it("PUT:填写后落盘新建,空占位不落盘", async () => {
    await seedAgentDir(agentDir, { extensions: [{ spec: "npm:pi-mcp-adapter@1.0.0" }] });
    const h = handler();
    // 空占位 PUT 不落盘
    await h(new Request("http://x/config/extensions/global", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { files: { "mcp.json": {} } } }),
    }));
    await expect(fs.access(join(agentDir, "mcp.json"))).rejects.toThrow();
    // 填写后新建
    const res = await h(new Request("http://x/config/extensions/global", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { files: { "mcp.json": { settings: { toolPrefix: "x" } } } } }),
    }));
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(agentDir, "mcp.json"), "utf8")) as Record<string, unknown>;
    expect(onDisk).toEqual({ settings: { toolPrefix: "x" } });
  });
});

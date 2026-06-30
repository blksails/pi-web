/**
 * 独立「MCP」配置端点(GET·PUT /config/mcp):install 门控 + schema 回传 + 读写 mcp.json。
 * 用真实默认 registry(内置离线快照含 pi-mcp-adapter mcp.json schema)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createMcpConfigRoutes } from "../../src/config/mcp-config-routes.js";
import { createConfigRoutes } from "../../src/config/config-routes.js";

let agentDir: string;
beforeEach(async () => {
  agentDir = join(tmpdir(), `mcp-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

function handler() {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createMcpConfigRoutes({ agentDir }),
    authResolver: () => ({ anonymous: true }),
  });
}
async function writeSettings(s: unknown): Promise<void> {
  await fs.writeFile(join(agentDir, "settings.json"), JSON.stringify(s));
}
async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

describe("GET /config/mcp", () => {
  it("未安装 pi-mcp-adapter → installed:false,无 schema", async () => {
    await writeSettings({ packages: ["npm:pi-sandbox"] });
    const b = await body(await handler()(new Request("http://x/config/mcp")));
    expect(b["installed"]).toBe(false);
    expect(b["fileSchemas"]).toBeUndefined();
  });

  it("已安装 → installed:true + 空 values + 不喂 schema(直接 JSON 编辑)", async () => {
    await writeSettings({ packages: ["npm:pi-mcp-adapter@1.0.0"] });
    const b = await body(await handler()(new Request("http://x/config/mcp")));
    expect(b["installed"]).toBe(true);
    expect(b["fileSchemas"]).toBeUndefined(); // 原始 JSON 编辑,不回传 schema
    expect((b["values"] as { files: Record<string, unknown> }).files["mcp.json"]).toEqual({});
  });

  it("已安装且 mcp.json 存在 → 回填现有内容", async () => {
    await writeSettings({ packages: ["npm:pi-mcp-adapter@1.0.0"] });
    await fs.writeFile(join(agentDir, "mcp.json"), JSON.stringify({ settings: { toolPrefix: "srv" } }));
    const b = await body(await handler()(new Request("http://x/config/mcp")));
    expect((b["values"] as { files: Record<string, unknown> }).files["mcp.json"]).toEqual({ settings: { toolPrefix: "srv" } });
  });
});

describe("路由共存:/config/mcp 不被通用 /config/:domain 抢匹配", () => {
  it("mcp 路由排在通用 config 路由之前 → /config/mcp 命中 mcp handler 而非 DOMAIN_NOT_FOUND", async () => {
    await writeSettings({ packages: ["npm:pi-mcp-adapter@1.0.0"] });
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    // 与 pi-handler 装配同序:mcp 字面量路由在前,通用 :domain 在后。
    const h = createPiWebHandler({
      manager,
      store,
      routes: [
        ...createMcpConfigRoutes({ agentDir }),
        ...createConfigRoutes({ rootDir: agentDir }),
      ],
      authResolver: () => ({ anonymous: true }),
    });
    const b = await body(await h(new Request("http://x/config/mcp")));
    expect(b["installed"]).toBe(true); // 命中 mcp handler
    expect(b["error"]).toBeUndefined(); // 非 DOMAIN_NOT_FOUND
    // 通用域仍可达
    const settings = await h(new Request("http://x/config/settings"));
    expect(settings.status).toBe(200);
  });
});

describe("PUT /config/mcp", () => {
  it("填写后写入 mcp.json;空且原不存在不落盘", async () => {
    await writeSettings({ packages: ["npm:pi-mcp-adapter@1.0.0"] });
    const h = handler();
    const put = (v: unknown) =>
      h(new Request("http://x/config/mcp", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: v }) }));

    const empty = await body(await put({ files: { "mcp.json": {} } }));
    expect(empty["written"]).toBe(false);
    await expect(fs.access(join(agentDir, "mcp.json"))).rejects.toThrow();

    await put({ files: { "mcp.json": { mcpServers: { fs: { command: "npx" } } } } });
    const onDisk = JSON.parse(await fs.readFile(join(agentDir, "mcp.json"), "utf8"));
    expect(onDisk).toEqual({ mcpServers: { fs: { command: "npx" } } });
  });
});

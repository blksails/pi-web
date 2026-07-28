/**
 * MCP 配置端点族(spec: builtin-mcp-client,任务 3.1/3.3)。
 *
 * 覆盖改造后的行为:结构化读写 + secret 三态 + 未识别保留 + 状态/探测端点,
 * 且**不再有「装了 pi-mcp-adapter 才可用」的门控**(Req 5.2)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createMcpConfigRoutes } from "../../src/config/mcp-config-routes.js";
import { McpProbeService } from "../../src/config/mcp-probe.js";

let agentDir: string;
beforeEach(async () => {
  agentDir = join(tmpdir(), `mcp-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

function handler(probeService?: McpProbeService, anonymousAllowed = true) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createMcpConfigRoutes({
      agentDir,
      probeService,
      ...(anonymousAllowed ? {} : { adminPolicy: () => false }),
    }),
    authResolver: () => ({ anonymous: true }),
  });
}
async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text()) as Record<string, unknown>;
}
const get = (h: ReturnType<typeof handler>, path = "/config/mcp") =>
  h(new Request(`http://x${path}`));
const put = (h: ReturnType<typeof handler>, values: unknown) =>
  h(new Request("http://x/config/mcp", { method: "PUT", body: JSON.stringify({ values }) }));

const stdioServer = (name = "files", env: Record<string, unknown> = {}) => ({
  name,
  enabled: true,
  transport: { type: "stdio", command: "npx", args: ["-y", "pkg"], env },
});

async function writeConfig(raw: unknown): Promise<void> {
  await fs.writeFile(join(agentDir, "mcp.json"), JSON.stringify(raw, null, 2));
}
async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(join(agentDir, "mcp.json"), "utf8")) as Record<string, unknown>;
}

describe("GET /config/mcp — 零扩展依赖 + 结构化(Req 4.1, 5.2)", () => {
  it("未安装任何扩展也可用,响应不再含 installed 标志(Req 5.2)", async () => {
    const b = await body(await get(handler()));
    // 变异判据:若恢复 installed 门控,此处会出现 installed 键 → 转红。
    expect(b["installed"]).toBeUndefined();
    expect(b["values"]).toBeDefined();
    expect(b["formSchema"]).toBeDefined();
  });

  it("返回结构化表单 IR(domain=mcp,含 objectList)", async () => {
    const b = await body(await get(handler()));
    const schema = b["formSchema"] as { domain: string; fields: Array<{ kind: string }> };
    expect(schema.domain).toBe("mcp");
    expect(schema.fields[0]?.kind).toBe("objectList");
  });

  it("凭据以掩码回吐,明文绝不回读浏览器(Req 4.3, 7.2)", async () => {
    await writeConfig({ servers: [stdioServer("files", { TOKEN: "sk-real-secret" })] });
    const res = await get(handler());
    const text = await res.clone().text();
    // 变异判据:若去掉掩码直接回吐,明文会出现在响应里 → 转红。
    expect(text).not.toContain("sk-real-secret");
    const b = JSON.parse(text) as Record<string, unknown>;
    const servers = (b["values"] as { servers: Array<{ transport: { env: Record<string, unknown> } }> }).servers;
    expect(servers[0]?.transport.env["TOKEN"]).toMatchObject({ __secret: true, set: true });
  });

  it("读入旧的 mcpServers 对象映射形态(Req 5.3)", async () => {
    await writeConfig({ mcpServers: { files: { command: "npx" } } });
    const b = await body(await get(handler()));
    const servers = (b["values"] as { servers: Array<{ name: string }> }).servers;
    expect(servers.map((s) => s.name)).toEqual(["files"]);
    expect(b["migratedFromObjectMap"]).toBe(true);
  });

  it("未识别条目被报告(已保留、不参与连接,Req 5.4)", async () => {
    await writeConfig({ mcpServers: { weird: { url: "https://a/mcp" } } });
    const b = await body(await get(handler()));
    expect(b["unrecognized"]).toEqual([{ name: "weird", reason: "unknown-transport" }]);
  });
});

describe("PUT /config/mcp — 校验与持久化(Req 1.2, 2.5)", () => {
  it("写入后可原样读回(Req 1.2)", async () => {
    await put(handler(), { servers: [stdioServer()] });
    const disk = await readConfig();
    expect((disk["servers"] as Array<{ name: string }>)[0]?.name).toBe("files");
  });

  it("缺必填字段 → 400 且指明缺失字段(Req 2.5)", async () => {
    const res = await put(handler(), {
      servers: [{ name: "s", enabled: true, transport: { type: "stdio" } }],
    });
    expect(res.status).toBe(400);
    const b = await body(res);
    const issues = (b["error"] as { issues: Array<{ path: string }> }).issues;
    expect(issues.some((i) => i.path.includes("command"))).toBe(true);
  });

  it("重复 server 名 → 400(Req 1.1)", async () => {
    const res = await put(handler(), { servers: [stdioServer("dup"), stdioServer("dup")] });
    expect(res.status).toBe(400);
  });

  it("未识别顶层键与未识别条目在写回后仍在(Req 5.4)", async () => {
    await writeConfig({
      globalShortcut: "cmd+k",
      servers: [{ name: "weird", transport: { type: "websocket", url: "wss://a" } }],
    });
    await put(handler(), { servers: [stdioServer()] });
    const disk = await readConfig();
    // 变异判据:若写回时丢弃保留内容,这两条断言转红。
    expect(disk["globalShortcut"]).toBe("cmd+k");
    expect(disk["servers"]).toContainEqual({
      name: "weird",
      transport: { type: "websocket", url: "wss://a" },
    });
  });
});

describe("PUT /config/mcp — secret 三态(Req 7.3, 7.4)", () => {
  it("keep → 磁盘原值保持不变", async () => {
    await writeConfig({ servers: [stdioServer("files", { TOKEN: "sk-original" })] });
    await put(handler(), {
      servers: [stdioServer("files", { TOKEN: { __secret: true, action: "keep" } })],
    });
    const disk = await readConfig();
    const env = (disk["servers"] as Array<{ transport: { env: Record<string, string> } }>)[0]
      ?.transport.env;
    expect(env?.["TOKEN"]).toBe("sk-original");
  });

  it("clear → 该凭据被移除", async () => {
    await writeConfig({ servers: [stdioServer("files", { TOKEN: "sk-original" })] });
    await put(handler(), {
      servers: [stdioServer("files", { TOKEN: { __secret: true, action: "clear" } })],
    });
    const disk = await readConfig();
    const env = (disk["servers"] as Array<{ transport: { env: Record<string, string> } }>)[0]
      ?.transport.env;
    expect(env).not.toHaveProperty("TOKEN");
  });

  it("set → 采用新明文", async () => {
    await writeConfig({ servers: [stdioServer("files", { TOKEN: "sk-old" })] });
    await put(handler(), {
      servers: [stdioServer("files", { TOKEN: { __secret: true, action: "set", value: "sk-new" } })],
    });
    const disk = await readConfig();
    const env = (disk["servers"] as Array<{ transport: { env: Record<string, string> } }>)[0]
      ?.transport.env;
    expect(env?.["TOKEN"]).toBe("sk-new");
  });
});

describe("状态与探测端点(Req 6.1, 6.4)", () => {
  it("status 只读缓存,从未探测过为 unknown,禁用为 disabled(Req 6.1)", async () => {
    await writeConfig({
      servers: [stdioServer("on"), { ...stdioServer("off"), enabled: false }],
    });
    const b = await body(await get(handler(), "/config/mcp/status"));
    const statuses = b["statuses"] as Array<{ name: string; status: string }>;
    expect(statuses).toEqual([
      { name: "on", status: "unknown" },
      { name: "off", status: "disabled" },
    ]);
  });

  it("probe 触发探测并刷新状态,失败原因可见(Req 6.2, 6.4)", async () => {
    await writeConfig({ servers: [stdioServer("bad")] });
    const probeService = new McpProbeService({
      probeOne: async (s) => ({
        name: s.name,
        status: "failed",
        error: "ECONNREFUSED",
        checkedAt: 1,
      }),
    });
    const h = handler(probeService);
    const b = await body(await h(new Request("http://x/config/mcp/probe", { method: "POST" })));
    const statuses = b["statuses"] as Array<{ name: string; status: string; error?: string }>;
    expect(statuses[0]).toMatchObject({ name: "bad", status: "failed", error: "ECONNREFUSED" });

    // 探测后 status 端点应反映最新结果(缓存已刷新)
    const after = await body(await get(h, "/config/mcp/status"));
    expect((after["statuses"] as Array<{ status: string }>)[0]?.status).toBe("failed");
  });

  it("probe 不探测禁用条目", async () => {
    await writeConfig({ servers: [{ ...stdioServer("off"), enabled: false }] });
    let called = 0;
    const probeService = new McpProbeService({
      probeOne: async (s) => {
        called += 1;
        return { name: s.name, status: "connected" as const };
      },
    });
    await handler(probeService)(new Request("http://x/config/mcp/probe", { method: "POST" }));
    expect(called).toBe(0);
  });
});

describe("鉴权门控", () => {
  it("adminPolicy 拒绝 → 四个端点一致受门控", async () => {
    const h = handler(undefined, false);
    expect((await get(h)).status).toBe(401);
    expect((await put(h, { servers: [] })).status).toBe(401);
    expect((await get(h, "/config/mcp/status")).status).toBe(401);
    const probeRes = await h(new Request("http://x/config/mcp/probe", { method: "POST" }));
    expect(probeRes.status).toBe(401);
  });
});

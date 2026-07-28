/**
 * e2e:内置 MCP 客户端全链路(spec: builtin-mcp-client,任务 5.1)。
 *
 * **无 mock、无 stub**:起一个真实的 stdio MCP server 子进程,走真实传输 → 真实握手 →
 * 真实 `tools/list` → 真实 `tools/call`,再经真实的 tool-adapter 适配为 pi 工具并执行。
 *
 * 覆盖关键用户路径:
 *  - 配置一个本地 server 后,其工具以 `<server>__<tool>` 出现并可被调用、结果回流(Req 3.1/3.3/3.4)
 *  - 工具调用失败转错误结果、会话可继续(Req 3.5)
 *  - 配置不可达条目时不阻塞、其余条目照常可用(Req 1.5)
 *  - 禁用条目零连接(Req 1.4)
 *  - 既有 mcp.json(含旧格式与未识别内容)可被真实读取与规范化(Req 5.3/5.4)
 */
import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@blksails/pi-web-protocol";
import { McpClientManager } from "../../src/mcp/client-manager.js";
import { adaptMcpTool } from "../../src/mcp/tool-adapter.js";
import { runMcpExtension } from "../../src/mcp/mcp-extension.js";
import { loadMcpConfig } from "../../src/mcp/config-loader.js";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "fixtures", "echo-mcp-server.mjs");

const echoServer = (name = "echo", enabled = true): McpServerConfig =>
  ({
    name,
    enabled,
    transport: { type: "stdio", command: process.execPath, args: [SERVER_ENTRY], env: {} },
  }) as McpServerConfig;

const unreachable = (name = "dead"): McpServerConfig =>
  ({
    name,
    enabled: true,
    transport: { type: "streamable-http", url: "http://127.0.0.1:1/mcp", headers: {} },
  }) as McpServerConfig;

const managers: McpClientManager[] = [];
function manager(timeoutMs = 20_000): McpClientManager {
  const m = new McpClientManager({ connectTimeoutMs: timeoutMs });
  managers.push(m);
  return m;
}
afterAll(async () => {
  await Promise.all(managers.map((m) => m.closeAll()));
});

describe("e2e:真实 stdio MCP server 全链路", () => {
  it("连接真实 server 并发现其工具(Req 1.3, 3.1)", async () => {
    const m = manager();
    const [outcome] = await m.connectAll([echoServer()]);
    expect(outcome?.status, outcome?.error).toBe("connected");
    expect(outcome?.tools.map((t) => t.name).sort()).toEqual(["boom", "echo"]);
  }, 30_000);

  it("经适配器真实调用工具,结果回流(Req 3.3, 3.4)", async () => {
    const m = manager();
    const [outcome] = await m.connectAll([echoServer("files")]);
    expect(outcome?.status).toBe("connected");

    const handle = m.handleFor("files", outcome!.tools);
    const echo = outcome!.tools.find((t) => t.name === "echo")!;
    const tool = adaptMcpTool(echo, { serverName: "files", callTool: handle!.callTool });

    // 命名带 server 前缀(Req 3.4)
    expect(tool.name).toBe("files__echo");

    const result = await tool.execute("call-1", { text: "hello" }, undefined, undefined, {} as never);
    const first = result.content[0] as { type: string; text: string };
    expect(first.type).toBe("text");
    expect(first.text).toBe("echo:hello");
  }, 30_000);

  it("真实的工具执行失败 → 错误结果而非抛出,会话可继续(Req 3.5)", async () => {
    const m = manager();
    const [outcome] = await m.connectAll([echoServer("x")]);
    const handle = m.handleFor("x", outcome!.tools);
    const boom = outcome!.tools.find((t) => t.name === "boom")!;
    const tool = adaptMcpTool(boom, { serverName: "x", callTool: handle!.callTool });

    const result = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect((result.details as { isError: boolean }).isError).toBe(true);
  }, 30_000);

  it("不可达条目失败但不阻塞,可用条目照常工作(Req 1.5)", async () => {
    const m = manager(4_000);
    const outcomes = await m.connectAll([unreachable(), echoServer("ok")]);
    const dead = outcomes.find((o) => o.serverName === "dead");
    const ok = outcomes.find((o) => o.serverName === "ok");
    expect(dead?.status).toBe("failed");
    expect(dead?.error).toBeTruthy();
    // 变异判据:若失败向外抛,本用例根本走不到这里 → 转红。
    expect(ok?.status).toBe("connected");
  }, 30_000);

  it("禁用条目零连接(Req 1.4)", async () => {
    const m = manager();
    const [outcome] = await m.connectAll([echoServer("off", false)]);
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.tools).toEqual([]);
  }, 15_000);
});

describe("e2e:扩展编排把真实工具注册进会话(Req 3.1, 5.1)", () => {
  it("runMcpExtension 用真实连接注册带前缀的工具", async () => {
    const m = manager();
    const registeredTools: ToolDefinition[] = [];
    const pi = {
      registerTool: (t: ToolDefinition) => registeredTools.push(t),
    } as unknown as ExtensionAPI;

    const outcomes = new Map<string, Awaited<ReturnType<typeof m.connectAll>>[number]>();
    const names = await runMcpExtension(pi, {
      loadServers: async () => [echoServer("live")],
      connectAll: async (servers) => {
        const out = await m.connectAll(servers);
        for (const o of out) outcomes.set(o.serverName, o);
        return out;
      },
      callToolFor: (serverName) => {
        const o = outcomes.get(serverName);
        return m.handleFor(serverName, o?.tools ?? [])?.callTool;
      },
    });

    expect([...names].sort()).toEqual(["live__boom", "live__echo"]);
    // 真实执行一次已注册的工具,确认注册产物可用
    const echoTool = registeredTools.find((t) => t.name === "live__echo")!;
    const r = await echoTool.execute("c1", { text: "wired" }, undefined, undefined, {} as never);
    expect((r.content[0] as { text: string }).text).toBe("echo:wired");
  }, 30_000);
});

describe("e2e:真实磁盘配置读取(Req 5.3, 5.4)", () => {
  it("读取既有 mcp.json:旧对象映射被规范化,未识别内容被保留", async () => {
    const dir = join(tmpdir(), `mcp-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(
        join(dir, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            legacy: { command: "node", args: ["x.js"] },
            weird: { url: "https://a/mcp" },
          },
          globalShortcut: "cmd+k",
        }),
        "utf8",
      );
      const config = await loadMcpConfig(dir);
      expect(config.servers.map((s) => s.name)).toEqual(["legacy"]);
      expect(config.servers[0]?.transport).toMatchObject({ type: "stdio", command: "node" });
      expect(config.unrecognizedServers[0]).toMatchObject({
        name: "weird",
        reason: "unknown-transport",
      });
      expect(config.extraKeys).toEqual({ globalShortcut: "cmd+k" });
      expect(config.migratedFromObjectMap).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("配置文件缺失 → 空配置,不抛出(不阻塞会话)", async () => {
    const config = await loadMcpConfig(join(tmpdir(), "definitely-not-here-xyz"));
    expect(config.servers).toEqual([]);
  });
});

/**
 * 集成:mcpExtension 编排(spec: builtin-mcp-client,任务 2.4;Req 1.3, 1.5, 3.1, 3.2, 4.4)。
 */
import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { McpServerConfig } from "@blksails/pi-web-protocol";
import { runMcpExtension, createBridgeTools } from "../../src/mcp/mcp-extension.js";
import type { McpConnectOutcome } from "../../src/mcp/client-manager.js";

/** 最小 ExtensionAPI 替身:只收集注册的工具。 */
function fakePi(): { pi: ExtensionAPI; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  const pi = { registerTool: (t: ToolDefinition) => tools.push(t) } as unknown as ExtensionAPI;
  return { pi, tools };
}

const server = (name: string): McpServerConfig =>
  ({ name, enabled: true, transport: { type: "stdio", command: "node" } }) as McpServerConfig;

const connected = (name: string, toolNames: string[]): McpConnectOutcome => ({
  serverName: name,
  status: "connected",
  tools: toolNames.map((n) => ({ name: n, inputSchema: { type: "object" } })),
});

describe("runMcpExtension — 工具注册(Req 3.1, 3.4)", () => {
  it("已连接 server 的工具以带前缀的名称注册", async () => {
    const { pi, tools } = fakePi();
    const names = await runMcpExtension(pi, {
      loadServers: async () => [server("files")],
      connectAll: async () => [connected("files", ["read", "write"])],
      callToolFor: () => async () => ({ content: [] }),
    });
    expect(names).toEqual(["files__read", "files__write"]);
    expect(tools.map((t) => t.name)).toEqual(["files__read", "files__write"]);
  });

  it("不同 server 的同名工具互不冲突(Req 3.4)", async () => {
    const { pi, tools } = fakePi();
    await runMcpExtension(pi, {
      loadServers: async () => [server("a"), server("b")],
      connectAll: async () => [connected("a", ["read"]), connected("b", ["read"])],
      callToolFor: () => async () => ({ content: [] }),
    });
    expect(tools.map((t) => t.name)).toEqual(["a__read", "b__read"]);
  });
});

describe("runMcpExtension — 降级不阻塞会话(Req 1.5)", () => {
  it("连接失败的 server 不注册工具,且不抛出", async () => {
    const { pi, tools } = fakePi();
    const names = await runMcpExtension(pi, {
      loadServers: async () => [server("bad"), server("good")],
      connectAll: async () => [
        { serverName: "bad", status: "failed", tools: [], error: "ECONNREFUSED" },
        connected("good", ["ok"]),
      ],
      callToolFor: () => async () => ({ content: [] }),
    });
    // 变异判据:若失败条目也去注册工具,names 会含 bad__* → 转红。
    expect(names).toEqual(["good__ok"]);
    expect(tools).toHaveLength(1);
  });

  it("配置读取抛错 → 整体降级,不抛出(会话照常启动)", async () => {
    const { pi, tools } = fakePi();
    const names = await runMcpExtension(pi, {
      loadServers: async () => {
        throw new Error("disk exploded");
      },
      connectAll: async () => [],
      callToolFor: () => undefined,
    });
    expect(names).toEqual([]);
    expect(tools).toEqual([]);
  });

  it("连接阶段整体抛错 → 不外溢", async () => {
    const { pi } = fakePi();
    await expect(
      runMcpExtension(pi, {
        loadServers: async () => [server("x")],
        connectAll: async () => {
          throw new Error("boom");
        },
        callToolFor: () => undefined,
      }),
    ).resolves.toEqual([]);
  });

  it("空配置 → 不连接、不注册", async () => {
    const connectAll = vi.fn(async () => []);
    const { pi } = fakePi();
    await runMcpExtension(pi, {
      loadServers: async () => [],
      connectAll,
      callToolFor: () => undefined,
    });
    expect(connectAll).not.toHaveBeenCalled();
  });

  it("单个工具注册失败不影响同 server 其余工具", async () => {
    const tools: ToolDefinition[] = [];
    let calls = 0;
    const pi = {
      registerTool: (t: ToolDefinition) => {
        calls += 1;
        if (calls === 1) throw new Error("duplicate name");
        tools.push(t);
      },
    } as unknown as ExtensionAPI;

    const names = await runMcpExtension(pi, {
      loadServers: async () => [server("s")],
      connectAll: async () => [connected("s", ["bad", "good"])],
      callToolFor: () => async () => ({ content: [] }),
    });
    expect(names).toEqual(["s__good"]);
    expect(tools).toHaveLength(1);
  });
});

describe("createBridgeTools — resources / prompts 可访问(Req 3.2)", () => {
  it("按 server 声明的能力生成对应桥接工具", () => {
    const tools = createBridgeTools("files", {
      listResources: async () => [{ uri: "file:///a" }],
      readResource: async (uri) => ({ uri }),
    });
    expect(tools.map((t) => t.name)).toEqual(["files__list_resources", "files__read_resource"]);
  });

  it("未声明的能力不生成工具", () => {
    expect(createBridgeTools("files", {})).toEqual([]);
    expect(createBridgeTools("p", { listPrompts: async () => [] }).map((t) => t.name)).toEqual([
      "p__list_prompts",
    ]);
  });

  it("桥接工具执行失败转错误结果而非抛出", async () => {
    const [tool] = createBridgeTools("files", {
      listResources: async () => {
        throw new Error("nope");
      },
    });
    const r = await tool!.execute("c1", {}, undefined, undefined, {} as never);
    expect((r.details as { isError: boolean }).isError).toBe(true);
  });
});

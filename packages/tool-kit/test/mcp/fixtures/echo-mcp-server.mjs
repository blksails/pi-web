/**
 * 最小真实 MCP server(stdio 传输),供 builtin-mcp-client 的 e2e 使用。
 *
 * 暴露两个工具:
 *  - `echo`  —— 回显入参文本(验证参数透传与结果回流)
 *  - `boom`  —— 固定抛错(验证工具失败不中断会话)
 *
 * 刻意用 SDK 的高层 `McpServer`,使这份 fixture 尽量贴近真实第三方 MCP server 的形态。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo-server", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echo back the provided text.",
    inputSchema: { text: z.string().describe("text to echo") },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
);

server.registerTool(
  "boom",
  { description: "Always fails.", inputSchema: {} },
  async () => {
    throw new Error("intentional failure");
  },
);

await server.connect(new StdioServerTransport());

/**
 * 单元:TransportFactory(spec: builtin-mcp-client,任务 2.1;Req 2.1-2.3)。
 *
 * 只构造不 start —— stdio 的子进程在 `start()` 才 spawn,故本测试零副作用。
 */
import { describe, it, expect } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createMcpTransport,
  UnsupportedMcpTransportError,
} from "../../src/mcp/transport-factory.js";
import type { McpTransportConfig } from "@blksails/pi-web-protocol";

describe("createMcpTransport — 三种标准传输(Req 2.1)", () => {
  it("stdio → StdioClientTransport(Req 2.2)", () => {
    const t = createMcpTransport({ type: "stdio", command: "node", args: ["x.js"], env: {} });
    expect(t).toBeInstanceOf(StdioClientTransport);
  });

  it("sse → SSEClientTransport(Req 2.3)", () => {
    const t = createMcpTransport({ type: "sse", url: "https://example.com/sse", headers: {} });
    expect(t).toBeInstanceOf(SSEClientTransport);
  });

  it("streamable-http → StreamableHTTPClientTransport(Req 2.3)", () => {
    const t = createMcpTransport({
      type: "streamable-http",
      url: "https://example.com/mcp",
      headers: {},
    });
    expect(t).toBeInstanceOf(StreamableHTTPClientTransport);
  });

  it("远程传输可携带自定义请求头(Req 2.3)", () => {
    expect(() =>
      createMcpTransport({
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer t" },
      }),
    ).not.toThrow();
  });

  it("未知传输类型 → 明确报错,不静默降级、不自动回退", () => {
    const bad = { type: "websocket", url: "wss://x" } as unknown as McpTransportConfig;
    // 变异判据:若加入"未知类型回退到 streamable-http"的兜底,此处不再抛 → 转红。
    expect(() => createMcpTransport(bad)).toThrow(UnsupportedMcpTransportError);
  });

  it("非法 url 在构造期即暴露(不拖到连接期)", () => {
    expect(() =>
      createMcpTransport({ type: "sse", url: "not-a-url", headers: {} }),
    ).toThrow();
  });
});

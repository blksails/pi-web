/**
 * TransportFactory — 按传输类型构造 MCP 客户端传输(spec: builtin-mcp-client,任务 2.1;Req 2.1-2.3)。
 *
 * **本文件是全仓唯一识别 MCP 传输类型的地方**:新增传输类型只改这里 + protocol 侧 schema。
 *
 * 刻意**不实现**官方文档提到的「StreamableHTTP 失败自动回退 SSE」探测:Req 2 要求用户显式
 * 选择协议,自动回退会让「配了 A 却实际走了 B」这种情况对用户不可见(排障时极难定位)。
 * 未知类型一律明确报错,不静默降级。
 *
 * 属 **runtime 层**(含 MCP SDK 值导入),只经 runtime 子入口/专用 entry 加载,不进前端 bundle。
 */
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpTransportConfig } from "@blksails/pi-web-protocol";

/** 未知/不支持的传输类型。调用方应把该条目记为失败并跳过,而非中断整个装配。 */
export class UnsupportedMcpTransportError extends Error {
  readonly code = "unsupported-transport";
  constructor(readonly transportType: string) {
    super(`unsupported MCP transport type: ${transportType}`);
    this.name = "UnsupportedMcpTransportError";
  }
}

/**
 * 自定义请求头经 options 的 `requestInit.headers` 传入(SSE 与 Streamable HTTP 同款字段)。
 * 无自定义头时返回 undefined,让 SDK 走默认路径。
 */
function toTransportOptions(
  headers: Readonly<Record<string, string>> | undefined,
): { readonly requestInit: RequestInit } | undefined {
  if (headers === undefined || Object.keys(headers).length === 0) return undefined;
  return { requestInit: { headers: { ...headers } } };
}

/**
 * 构造一个 MCP 传输。
 *
 * stdio:**合并默认环境**再叠加用户配置的 env —— 只传用户 env 会丢掉 PATH 等基础变量,
 * 导致 `npx`/`node` 之类命令找不到(SDK 的 `getDefaultEnvironment()` 正是为此提供)。
 */
export function createMcpTransport(config: McpTransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: [...(config.args ?? [])],
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      });
    case "sse":
      // SSE 在 MCP SDK 1.29 已标记 deprecated(规范层面正被 Streamable HTTP 取代),但仍需支持:
      // 存量 SSE-only server 只能用它接入(Req 2.1/2.3)。待上游移除时本分支须随之处置。
      return new SSEClientTransport(new URL(config.url), toTransportOptions(config.headers));
    case "streamable-http":
      return new StreamableHTTPClientTransport(new URL(config.url), toTransportOptions(config.headers));
    default: {
      // 判别联合已穷尽;运行期仍可能收到磁盘上的非法值(schema 之外的路径),故显式报错。
      const unknown = config as { readonly type?: unknown };
      throw new UnsupportedMcpTransportError(String(unknown.type));
    }
  }
}

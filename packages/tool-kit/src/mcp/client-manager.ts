/**
 * McpClientManager — MCP 连接的建立、维护与关闭(spec: builtin-mcp-client,任务 2.3;
 * Req 1.3-1.6, 7.1)。
 *
 * 三条不变式:
 *  1. **只连启用条目**(Req 1.4):禁用条目在取集合阶段即被排除,不产生任何连接/进程。
 *  2. **失败不外溢**(Req 1.5):各条目并发建立、各自独立超时;任一失败只记录结果并跳过,
 *     绝不向装配流程抛出 —— 会话必须能正常启动。
 *  3. **凭据不进日志**(Req 7.1):失败原因经脱敏后才返回/记录(环境变量值、请求头值、
 *     URL 里的 user:pass 与查询串凭据)。
 *
 * 属 runtime 层(含 MCP SDK 值导入)。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServerConfig } from "@blksails/pi-web-protocol";
import { createMcpTransport } from "./transport-factory.js";
import type { McpToolCallResult, McpToolDescriptor } from "./tool-adapter.js";

/** 默认单条连接超时:够慢启动的 stdio server 完成握手,又不至于让会话装配久等。 */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 15_000;

const CLIENT_INFO = { name: "pi-web", version: "1.0.0" } as const;

export interface McpConnectOutcome {
  readonly serverName: string;
  readonly status: "connected" | "failed" | "skipped";
  readonly tools: readonly McpToolDescriptor[];
  /** 已脱敏的失败原因;仅 status==="failed" 时有值。 */
  readonly error?: string;
}

/** 已连接 server 的调用句柄,交给 tool-adapter 使用。 */
export interface McpServerHandle {
  readonly serverName: string;
  readonly tools: readonly McpToolDescriptor[];
  readonly callTool: (
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<McpToolCallResult>;
}

export interface McpClientManagerOptions {
  readonly connectTimeoutMs?: number;
}

/**
 * 脱敏:凭据绝不出现在错误信息里(Req 7.1)。
 * 覆盖 URL 内联凭据与常见 token 查询参数;其余潜在敏感值由调用方保证不拼进 message。
 */
export function redactSecrets(input: string): string {
  return input
    // scheme://user:pass@host → scheme://***@host
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***@")
    // ?token=xxx / &api_key=xxx / &access_token=xxx
    .replace(/([?&](?:token|api[_-]?key|access[_-]?token|secret|password)=)[^&\s]+/gi, "$1***")
    // Authorization: Bearer xxx
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1***");
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw);
}

/** 给一个 promise 加独立超时;超时不影响其他条目。 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class McpClientManager {
  private readonly clients = new Map<string, Client>();
  private readonly timeoutMs: number;

  constructor(options: McpClientManagerOptions = {}) {
    this.timeoutMs = options.connectTimeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  }

  /**
   * 并发连接全部启用条目。**绝不抛出** —— 每个条目的结果都体现在返回数组里。
   */
  async connectAll(
    servers: readonly McpServerConfig[],
  ): Promise<readonly McpConnectOutcome[]> {
    return Promise.all(servers.map((s) => this.connectOne(s)));
  }

  private async connectOne(server: McpServerConfig): Promise<McpConnectOutcome> {
    // Req 1.4:禁用条目零连接。
    if (server.enabled === false) {
      return { serverName: server.name, status: "skipped", tools: [] };
    }
    let client: Client | undefined;
    try {
      const transport = createMcpTransport(server.transport);
      client = new Client(CLIENT_INFO, { capabilities: {} });
      await withTimeout(client.connect(transport), this.timeoutMs, `connect ${server.name}`);
      const listed = await withTimeout(
        client.listTools(),
        this.timeoutMs,
        `listTools ${server.name}`,
      );
      const tools: McpToolDescriptor[] = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      this.clients.set(server.name, client);
      return { serverName: server.name, status: "connected", tools };
    } catch (err: unknown) {
      // Req 1.5:失败只记录,不外溢。确保失败连接的资源被释放。
      if (client !== undefined) {
        try {
          await client.close();
        } catch {
          /* 关闭失败无需再上报 */
        }
      }
      return { serverName: server.name, status: "failed", tools: [], error: messageOf(err) };
    }
  }

  /** 取已连接 server 的调用句柄;未连接则 undefined。 */
  handleFor(serverName: string, tools: readonly McpToolDescriptor[]): McpServerHandle | undefined {
    const client = this.clients.get(serverName);
    if (client === undefined) return undefined;
    return {
      serverName,
      tools,
      callTool: async (toolName, args, signal) => {
        const result = await client.callTool(
          { name: toolName, arguments: (args ?? {}) as Record<string, unknown> },
          undefined,
          signal === undefined ? undefined : { signal },
        );
        return result as McpToolCallResult;
      },
    };
  }

  /** 关闭全部连接(stdio 子进程随之回收)。绝不抛出。 */
  async closeAll(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      all.map(async (c) => {
        try {
          await c.close();
        } catch {
          /* 关闭期错误不影响其余 */
        }
      }),
    );
  }
}

/**
 * McpProbeService — 主进程侧的 MCP 连接探测与结果缓存
 * (spec: builtin-mcp-client,任务 3.2;Req 6.1-6.4, 7.1)。
 *
 * **为什么需要它**:设置页没有会话态,拿不到 runner 子进程里的连接状态(与
 * `aigc-models-routes` 撞的是同一堵墙)。故由主进程独立发起**短超时**探测:完成握手即断开,
 * 不注册工具、不驻留连接。
 *
 * **为什么此处再写一遍传输构造**:tool-kit 侧的 `transport-factory` 属 runtime 层,其所在
 * barrel 含 pi SDK 值导入,主进程 import 会把 pi SDK 拉进来(既有教训:主进程引 pi SDK 会让
 * dev 路由在 node:fs 上崩)。两处映射由 protocol 的**判别联合穷尽性检查**保证同步 ——
 * 新增传输类型时,两处的 switch 都会因缺分支而编译失败。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig, McpTransportConfig } from "@blksails/pi-web-protocol";

/** 探测超时:比会话装配期更短 —— 设置页是交互场景,不能让用户干等。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 8_000;

export type McpProbeStatus = "connected" | "failed" | "disabled" | "unknown";

export interface McpProbeResult {
  readonly name: string;
  readonly status: McpProbeStatus;
  /** 已脱敏的失败原因;仅 failed 时有值(Req 6.2)。 */
  readonly error?: string;
  /** 探测完成时间戳(ms);unknown(从未探测)时缺省。 */
  readonly checkedAt?: number;
  /** 连接成功时探到的工具数,便于用户确认接入是否符合预期。 */
  readonly toolCount?: number;
}

/** 与 client-manager 同款脱敏(Req 7.1)。两处均为纯函数,行为一致。 */
export function redactProbeSecrets(input: string): string {
  return input
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***@")
    .replace(/([?&](?:token|api[_-]?key|access[_-]?token|secret|password)=)[^&\s]+/gi, "$1***")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1***");
}

function createProbeTransport(config: McpTransportConfig): Transport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: [...(config.args ?? [])],
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      });
    case "sse":
      return new SSEClientTransport(
        new URL(config.url),
        config.headers !== undefined && Object.keys(config.headers).length > 0
          ? { requestInit: { headers: { ...config.headers } } }
          : undefined,
      );
    case "streamable-http":
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        config.headers !== undefined && Object.keys(config.headers).length > 0
          ? { requestInit: { headers: { ...config.headers } } }
          : undefined,
      );
    default: {
      const unknown = config as { readonly type?: unknown };
      throw new Error(`unsupported MCP transport type: ${String(unknown.type)}`);
    }
  }
}

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

export interface McpProbeServiceOptions {
  readonly timeoutMs?: number;
  /** 注入点:便于在无真实 server 的测试中替换实际连接动作。 */
  readonly probeOne?: (server: McpServerConfig, timeoutMs: number) => Promise<McpProbeResult>;
  /** 注入点:时间源,便于断言 checkedAt。 */
  readonly now?: () => number;
}

/**
 * 探测服务:持有最近一次结果的缓存。
 * `status()` 只读缓存(不触发连接),`probe()` 才真实发起 —— 打开设置页不应自动 spawn 进程。
 */
export class McpProbeService {
  private readonly cache = new Map<string, McpProbeResult>();
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly probeOne: (server: McpServerConfig, timeoutMs: number) => Promise<McpProbeResult>;

  constructor(options: McpProbeServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.probeOne = options.probeOne ?? ((s, ms) => this.defaultProbeOne(s, ms));
  }

  private async defaultProbeOne(
    server: McpServerConfig,
    timeoutMs: number,
  ): Promise<McpProbeResult> {
    let client: Client | undefined;
    try {
      const transport = createProbeTransport(server.transport);
      client = new Client({ name: "pi-web-probe", version: "1.0.0" }, { capabilities: {} });
      await withTimeout(client.connect(transport), timeoutMs, `probe ${server.name}`);
      const listed = await withTimeout(client.listTools(), timeoutMs, `probe ${server.name}`);
      return {
        name: server.name,
        status: "connected",
        checkedAt: this.now(),
        toolCount: listed.tools?.length ?? 0,
      };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      return {
        name: server.name,
        status: "failed",
        error: redactProbeSecrets(raw),
        checkedAt: this.now(),
      };
    } finally {
      // 探测不驻留连接:无论成败都断开(stdio 子进程随之回收)。
      if (client !== undefined) {
        try {
          await client.close();
        } catch {
          /* 关闭失败不影响探测结论 */
        }
      }
    }
  }

  /** 只读缓存(Req 6.1):从未探测过的条目为 unknown,禁用条目直接是 disabled。 */
  status(servers: readonly McpServerConfig[]): readonly McpProbeResult[] {
    return servers.map((s) => {
      if (s.enabled === false) return { name: s.name, status: "disabled" as const };
      return this.cache.get(s.name) ?? { name: s.name, status: "unknown" as const };
    });
  }

  /**
   * 真实探测并刷新缓存(Req 6.4)。可只探测指定条目。
   * 禁用条目不探测。绝不抛出。
   */
  async probe(
    servers: readonly McpServerConfig[],
    only?: string,
  ): Promise<readonly McpProbeResult[]> {
    const targets = servers.filter(
      (s) => s.enabled !== false && (only === undefined || s.name === only),
    );
    const results = await Promise.all(
      targets.map(async (s) => {
        try {
          return await this.probeOne(s, this.timeoutMs);
        } catch (err: unknown) {
          const raw = err instanceof Error ? err.message : String(err);
          return {
            name: s.name,
            status: "failed" as const,
            error: redactProbeSecrets(raw),
            checkedAt: this.now(),
          };
        }
      }),
    );
    for (const r of results) this.cache.set(r.name, r);
    return this.status(servers);
  }

  /** 配置变更后清理已不存在条目的陈旧缓存。 */
  retain(names: readonly string[]): void {
    const keep = new Set(names);
    for (const key of [...this.cache.keys()]) {
      if (!keep.has(key)) this.cache.delete(key);
    }
  }
}

/**
 * 内置 MCP 客户端扩展(default export 供 pi 按 forcedExtensionPaths 强制注入每个会话)。
 *
 * spec: builtin-mcp-client,任务 2.4;Req 1.3, 1.5, 3.1, 3.2, 4.4, 5.1。
 *
 * 装配期一次性完成:读配置 → 取启用条目 → 并发连接 → 适配并注册工具。
 * `ExtensionFactory` 允许返回 Promise(SDK 明确支持异步初始化),故连接可 await 完成后再注册,
 * 无需变通。
 *
 * 设计要点:
 * - **永不阻塞会话**(Req 1.5):全流程 try/catch 吞错;单个 server 失败只损失其自身能力。
 * - **配置在装配期读取**(Req 4.4):改动在下次新建会话生效,与 aigcExtension 一致。
 * - **resources / prompts 经桥接工具暴露**(Req 3.2):pi 侧无独立的资源/提示词载体,故把
 *   MCP 的 resources/prompts 能力包装成工具,使 agent 能够列出与读取 —— 这是"在会话中可被
 *   访问"的可行形态。
 * - 核心编排抽成 {@link runMcpExtension} 并注入依赖,便于在无真实 server 下集成测试。
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@blksails/pi-web-logger";
import { MCP_TOOL_NAME_SEPARATOR, type McpServerConfig } from "@blksails/pi-web-protocol";
import { McpClientManager, type McpConnectOutcome } from "./client-manager.js";
import { adaptMcpTool } from "./tool-adapter.js";
import { loadMcpConfig } from "./config-loader.js";

const log = createLogger({ namespace: "toolkit:mcp" });

/** 注入式依赖,使编排可在无真实 server / 无磁盘配置下单测。 */
export interface McpExtensionDeps {
  /** 取本次装配要连接的 server 列表。 */
  readonly loadServers: () => Promise<readonly McpServerConfig[]>;
  /** 建立连接并返回逐条结果(绝不抛出)。 */
  readonly connectAll: (
    servers: readonly McpServerConfig[],
  ) => Promise<readonly McpConnectOutcome[]>;
  /** 取某个已连接 server 的工具调用入口;未连接返回 undefined。 */
  readonly callToolFor: (
    serverName: string,
  ) => ((toolName: string, args: unknown, signal?: AbortSignal) => Promise<unknown>) | undefined;
  /** 额外的桥接工具(resources / prompts);无则返回空数组。 */
  readonly bridgeToolsFor?: (outcome: McpConnectOutcome) => readonly ToolDefinition[];
}

/**
 * 编排主体:注册全部可用的 MCP 工具,返回实际注册的工具名(便于测试与日志)。
 * **绝不抛出**。
 */
export async function runMcpExtension(
  pi: ExtensionAPI,
  deps: McpExtensionDeps,
): Promise<readonly string[]> {
  const registered: string[] = [];
  try {
    const servers = await deps.loadServers();
    if (servers.length === 0) return registered;

    const outcomes = await deps.connectAll(servers);

    for (const outcome of outcomes) {
      if (outcome.status !== "connected") {
        if (outcome.status === "failed") {
          log.warn("mcp server connect failed", {
            server: outcome.serverName,
            error: outcome.error,
          });
        }
        continue;
      }
      const callTool = deps.callToolFor(outcome.serverName);
      if (callTool === undefined) continue;

      for (const tool of outcome.tools) {
        try {
          const definition = adaptMcpTool(tool, {
            serverName: outcome.serverName,
            callTool: async (name, args, signal) =>
              (await callTool(name, args, signal)) as never,
          });
          pi.registerTool(definition);
          registered.push(definition.name);
        } catch (err: unknown) {
          // 单个工具注册失败不影响同 server 其余工具。
          log.warn("mcp tool register failed", {
            server: outcome.serverName,
            tool: tool.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      for (const bridge of deps.bridgeToolsFor?.(outcome) ?? []) {
        try {
          pi.registerTool(bridge);
          registered.push(bridge.name);
        } catch {
          /* 桥接工具失败不影响主工具 */
        }
      }
    }
    log.info("mcp extension ready", { registered: registered.length });
  } catch (err: unknown) {
    // Req 1.5:MCP 整体失败也不得阻塞会话。
    log.warn("mcp extension init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return registered;
}

/**
 * 把一个已连接 server 的 resources / prompts 能力包装为桥接工具(Req 3.2)。
 * 传入的 `call` 是通用的 MCP 请求入口。
 */
export function createBridgeTools(
  serverName: string,
  capabilities: {
    readonly listResources?: () => Promise<unknown>;
    readonly readResource?: (uri: string) => Promise<unknown>;
    readonly listPrompts?: () => Promise<unknown>;
    readonly getPrompt?: (name: string) => Promise<unknown>;
  },
): readonly ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const mk = (
    suffix: string,
    description: string,
    parameters: Record<string, unknown>,
    run: (params: Record<string, unknown>) => Promise<unknown>,
  ): ToolDefinition =>
    ({
      name: `${serverName}${MCP_TOOL_NAME_SEPARATOR}${suffix}`,
      label: `${serverName}: ${suffix}`,
      description,
      parameters,
      async execute(_id: string, params: unknown) {
        try {
          const out = await run((params ?? {}) as Record<string, unknown>);
          return {
            content: [{ type: "text", text: JSON.stringify(out) }],
            details: { isError: false as const },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: message }],
            details: { isError: true as const, error: message },
          };
        }
      },
    }) as unknown as ToolDefinition;

  if (capabilities.listResources !== undefined) {
    tools.push(
      mk(
        "list_resources",
        `List resources exposed by MCP server "${serverName}".`,
        { type: "object", properties: {}, additionalProperties: false },
        async () => capabilities.listResources?.(),
      ),
    );
  }
  if (capabilities.readResource !== undefined) {
    tools.push(
      mk(
        "read_resource",
        `Read a resource from MCP server "${serverName}" by URI.`,
        {
          type: "object",
          properties: { uri: { type: "string" } },
          required: ["uri"],
        },
        async (p) => capabilities.readResource?.(String(p["uri"] ?? "")),
      ),
    );
  }
  if (capabilities.listPrompts !== undefined) {
    tools.push(
      mk(
        "list_prompts",
        `List prompts exposed by MCP server "${serverName}".`,
        { type: "object", properties: {}, additionalProperties: false },
        async () => capabilities.listPrompts?.(),
      ),
    );
  }
  if (capabilities.getPrompt !== undefined) {
    tools.push(
      mk(
        "get_prompt",
        `Get a prompt from MCP server "${serverName}" by name.`,
        {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        async (p) => capabilities.getPrompt?.(String(p["name"] ?? "")),
      ),
    );
  }
  return tools;
}

/** default export:注入真实依赖(读磁盘配置 + 真实连接)。 */
export default async function mcpExtension(pi: ExtensionAPI): Promise<void> {
  const manager = new McpClientManager();
  const outcomeTools = new Map<string, McpConnectOutcome>();

  await runMcpExtension(pi, {
    loadServers: async () => {
      const config = await loadMcpConfig();
      if (config.unrecognizedServers.length > 0) {
        log.warn("mcp config has unrecognized entries (preserved, not connected)", {
          count: config.unrecognizedServers.length,
        });
      }
      return config.servers;
    },
    connectAll: async (servers) => {
      const outcomes = await manager.connectAll(servers);
      for (const o of outcomes) outcomeTools.set(o.serverName, o);
      return outcomes;
    },
    callToolFor: (serverName) => {
      const outcome = outcomeTools.get(serverName);
      const handle = manager.handleFor(serverName, outcome?.tools ?? []);
      if (handle === undefined) return undefined;
      return handle.callTool;
    },
  });
}

/**
 * McpToolAdapter — 把 MCP server 声明的 tool 适配为 pi `ToolDefinition`
 * (spec: builtin-mcp-client,任务 2.2;Req 3.1, 3.3, 3.4, 3.5)。
 *
 * 三条设计要点:
 *  1. **schema 透传**:pi 的 `parameters` 是 TypeBox `TSchema`,而 TypeBox schema 本质即标准
 *     JSON Schema —— MCP 的 `inputSchema` 可直接作为参数 schema 使用,无须重建编译器。
 *     缺失或结构非法时**兜底为宽松 object schema**,使单个坏工具不毒化同 server 其余工具。
 *  2. **命名**:注册名 `<serverName>__<toolName>`(Req 3.4),使不同 server 的同名工具可区分。
 *  3. **永不抛出**:调用异常、传输错误、server 返回 isError,一律转为**错误结果**回流会话,
 *     使一次工具失败不中断会话(Req 3.5)。
 *
 * 本模块**不持有连接**(client 由 McpClientManager 注入),故适配过程零 I/O、可纯单测。
 * 属 runtime 层(含 pi SDK 类型导入)。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MCP_TOOL_NAME_SEPARATOR } from "@blksails/pi-web-protocol";

/**
 * 工具参数 schema 的类型。**从 `ToolDefinition` 提取**而非直接 import `typebox` ——
 * typebox 是 pi SDK 的传递依赖,不是 tool-kit 的直接依赖,直接 import 会引入未声明依赖。
 */
type ParameterSchema = ToolDefinition["parameters"];

/** MCP `tools/list` 中的单个工具描述(只取适配所需字段)。 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/** MCP `tools/call` 的结果(只取适配所需字段)。 */
export interface McpToolCallResult {
  readonly content?: readonly unknown[];
  readonly isError?: boolean;
}

export interface McpToolAdapterDeps {
  readonly serverName: string;
  /** 由 McpClientManager 注入的实际调用入口。 */
  readonly callTool: (
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<McpToolCallResult>;
}

/** pi 侧可回流给模型的内容项。 */
type PiContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/**
 * 宽松兜底 schema:接受任意对象。用于 MCP 未提供 inputSchema 或其结构非法的场合 ——
 * 宁可让模型自由传参并由 server 侧校验,也不要让整个 server 的工具注册失败。
 */
const PERMISSIVE_SCHEMA = { type: "object", additionalProperties: true } as unknown as ParameterSchema;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 取工具参数 schema。仅当其为 `type:"object"` 的对象时透传,否则兜底。
 * (MCP 规范要求 inputSchema 是 object 类型的 JSON Schema;不符即视为非法。)
 */
export function resolveParameterSchema(inputSchema: unknown): ParameterSchema {
  if (!isPlainObject(inputSchema)) return PERMISSIVE_SCHEMA;
  if (inputSchema["type"] !== "object") return PERMISSIVE_SCHEMA;
  return inputSchema as unknown as ParameterSchema;
}

/** 组合注册名。分隔符与 server 名形状约束共同保证该名可反解析(见 protocol 侧 name 规则)。 */
export function composeToolName(serverName: string, toolName: string): string {
  return `${serverName}${MCP_TOOL_NAME_SEPARATOR}${toolName}`;
}

/** 把 MCP 的 content 项映射为 pi 侧内容;无法直接表达的类型降级为文本描述,不丢信息。 */
function mapContent(items: readonly unknown[] | undefined): PiContent[] {
  if (items === undefined || items.length === 0) return [];
  const out: PiContent[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const type = item["type"];
    if (type === "text" && typeof item["text"] === "string") {
      out.push({ type: "text", text: item["text"] });
      continue;
    }
    if (type === "image" && typeof item["data"] === "string" && typeof item["mimeType"] === "string") {
      out.push({ type: "image", data: item["data"], mimeType: item["mimeType"] });
      continue;
    }
    // resource / audio / 未来新增类型:pi 侧无对应载体,降级为文本以保留信息可见性。
    out.push({ type: "text", text: JSON.stringify(item) });
  }
  return out;
}

function errorResult(message: string): {
  content: PiContent[];
  details: { isError: true; error: string };
} {
  return { content: [{ type: "text", text: message }], details: { isError: true, error: message } };
}

/**
 * 适配一个 MCP 工具为可注册的 pi ToolDefinition。
 * 纯函数:不发起任何网络或进程调用。
 */
export function adaptMcpTool(
  tool: McpToolDescriptor,
  deps: McpToolAdapterDeps,
): ToolDefinition {
  const registeredName = composeToolName(deps.serverName, tool.name);
  const description =
    tool.description !== undefined && tool.description.length > 0
      ? tool.description
      : `MCP tool "${tool.name}" from server "${deps.serverName}".`;

  return {
    name: registeredName,
    label: `${deps.serverName}: ${tool.name}`,
    description,
    parameters: resolveParameterSchema(tool.inputSchema),
    async execute(_toolCallId: string, params: unknown, signal: AbortSignal | undefined) {
      try {
        const result = await deps.callTool(tool.name, params, signal);
        const content = mapContent(result.content);
        if (result.isError === true) {
          const text = content.find((c) => c.type === "text");
          return errorResult(
            text !== undefined && text.type === "text"
              ? text.text
              : `MCP tool ${registeredName} reported an error.`,
          );
        }
        return {
          content,
          details: { isError: false as const },
        };
      } catch (err: unknown) {
        // Req 3.5:调用失败转错误结果,绝不抛出 —— 会话须可继续。
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`MCP tool ${registeredName} failed: ${message}`);
      }
    },
  } as unknown as ToolDefinition;
}

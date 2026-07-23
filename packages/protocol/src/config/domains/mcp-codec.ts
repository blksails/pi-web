/**
 * McpConfigCodec — `mcp.json` 的规范化与合并写回(spec: builtin-mcp-client,任务 1.3)。
 *
 * 纯函数、无 I/O,前端安全:主进程(配置端点)与 runner 子进程(装配期读配置)共享同一份
 * 规范化语义,避免两侧对同一份文件产生不同理解。
 *
 * 承担 Req 5.3 / 5.4:
 *  - **兼容既有形态**:除权威的 `servers` 数组外,同时接受 MCP 生态通用的 `mcpServers`
 *    对象映射(键即 server 名)。
 *  - **不擅自丢弃**:顶层未识别键原样保留;传输类型无法识别的条目**整条原样保留**并标记,
 *    不参与连接。
 *  - **不擅自猜测**:旧格式条目若只有 `url` 而没有可辨识的传输类型,**不**替用户在
 *    SSE 与 Streamable HTTP 之间二选一(二者无法从 url 区分,猜错会导致连不上却看似已配置),
 *    而是标为未识别,交由用户在配置面显式选择。仅 `command` 可无歧义地推断为 stdio。
 */
import {
  MCP_TRANSPORT_TYPES,
  type McpServerConfig,
  type McpTransportType,
} from "./mcp.js";

/** 无法识别的 server 条目:原样保留,不参与连接(Req 5.4)。 */
export interface UnrecognizedMcpServer {
  /** 能取到名称时给出(便于配置面提示);取不到则 undefined。 */
  readonly name?: string;
  /** 未能识别的原因,用于配置面提示。 */
  readonly reason: "unknown-transport" | "malformed";
  /** 原始内容,逐字保留。 */
  readonly raw: unknown;
}

export interface NormalizedMcpConfig {
  /** 可识别、可参与连接的条目。 */
  readonly servers: readonly McpServerConfig[];
  /** 无法识别但已保留的条目(Req 5.4)。 */
  readonly unrecognizedServers: readonly UnrecognizedMcpServer[];
  /** 除 servers / mcpServers 外的顶层键,原样保留(Req 5.4)。 */
  readonly extraKeys: Readonly<Record<string, unknown>>;
  /** 读入时是否来自旧的 `mcpServers` 对象映射形态(供配置面提示已迁移)。 */
  readonly migratedFromObjectMap: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTransportType(v: unknown): v is McpTransportType {
  return typeof v === "string" && (MCP_TRANSPORT_TYPES as readonly string[]).includes(v);
}

/**
 * 从一个条目里解出传输配置。
 * 优先取显式 `transport`;否则仅在**无歧义**时从扁平字段推断(见文件头说明)。
 * 返回 undefined 表示无法识别 —— 调用方须保留原始内容。
 */
function resolveTransport(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const explicit = entry["transport"];
  if (isPlainObject(explicit)) {
    return isTransportType(explicit["type"]) ? explicit : undefined;
  }
  // 扁平旧格式:command 可无歧义推断为 stdio。
  if (typeof entry["command"] === "string" && entry["command"].length > 0) {
    const transport: Record<string, unknown> = { type: "stdio", command: entry["command"] };
    if (Array.isArray(entry["args"])) transport["args"] = entry["args"];
    if (isPlainObject(entry["env"])) transport["env"] = entry["env"];
    return transport;
  }
  // 只有 url:SSE 与 Streamable HTTP 无法区分 —— 除非条目自带可辨识的 type,否则不猜。
  if (typeof entry["url"] === "string" && entry["url"].length > 0) {
    if (isTransportType(entry["type"])) {
      const transport: Record<string, unknown> = { type: entry["type"], url: entry["url"] };
      if (isPlainObject(entry["headers"])) transport["headers"] = entry["headers"];
      return transport;
    }
    return undefined;
  }
  return undefined;
}

/** 把一个条目规范化;无法识别时返回 undefined(调用方保留原样)。 */
function normalizeEntry(
  raw: unknown,
  fallbackName?: string,
): { readonly server: McpServerConfig } | { readonly unrecognized: UnrecognizedMcpServer } {
  if (!isPlainObject(raw)) {
    return { unrecognized: { name: fallbackName, reason: "malformed", raw } };
  }
  const name = typeof raw["name"] === "string" && raw["name"].length > 0 ? raw["name"] : fallbackName;
  if (name === undefined || name.length === 0) {
    return { unrecognized: { reason: "malformed", raw } };
  }
  const transport = resolveTransport(raw);
  if (transport === undefined) {
    return { unrecognized: { name, reason: "unknown-transport", raw } };
  }
  // enabled 缺省视为启用。除已知键外的条目级字段一并保留(passthrough 语义)。
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "name" || k === "enabled" || k === "transport") continue;
    // 扁平旧格式已被吸收进 transport 的字段不再重复保留。
    if (k === "command" || k === "args" || k === "env" || k === "url" || k === "headers" || k === "type") {
      continue;
    }
    rest[k] = v;
  }
  const server = {
    ...rest,
    name,
    enabled: typeof raw["enabled"] === "boolean" ? raw["enabled"] : true,
    transport,
  } as unknown as McpServerConfig;
  return { server };
}

/**
 * 规范化任意来源的 mcp.json 内容。绝不抛出 —— 损坏内容降级为空配置,
 * 使配置面与会话装配都不因坏文件而失败(与 Req 1.5 的降级方向一致)。
 */
export function normalizeMcpConfig(raw: unknown): NormalizedMcpConfig {
  if (!isPlainObject(raw)) {
    return { servers: [], unrecognizedServers: [], extraKeys: {}, migratedFromObjectMap: false };
  }

  const servers: McpServerConfig[] = [];
  const unrecognized: UnrecognizedMcpServer[] = [];
  let migrated = false;

  const list = raw["servers"];
  const objectMap = raw["mcpServers"];

  if (Array.isArray(list)) {
    for (const item of list) {
      const r = normalizeEntry(item);
      if ("server" in r) servers.push(r.server);
      else unrecognized.push(r.unrecognized);
    }
  } else if (isPlainObject(objectMap)) {
    // 旧形态:键即 server 名。
    migrated = true;
    for (const [key, value] of Object.entries(objectMap)) {
      const r = normalizeEntry(value, key);
      if ("server" in r) servers.push(r.server);
      else unrecognized.push(r.unrecognized);
    }
  }

  const extraKeys: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "servers" || k === "mcpServers") continue;
    extraKeys[k] = v;
  }

  return {
    servers,
    unrecognizedServers: unrecognized,
    extraKeys,
    migratedFromObjectMap: migrated,
  };
}

/**
 * 生成写回磁盘的对象:以 `servers` 数组为权威形态,并把未识别内容与未识别顶层键
 * 一并带回,确保**保存动作永不丢失用户既有内容**(Req 5.4)。
 *
 * 迁移语义:读入若来自 `mcpServers` 对象映射,写回后统一为 `servers` 数组,旧键不再保留
 * (其内容已完整迁移进 servers / unrecognizedServers,不构成丢失)。
 */
export function buildMcpConfigForWrite(
  nextServers: readonly McpServerConfig[],
  preserved: Pick<NormalizedMcpConfig, "unrecognizedServers" | "extraKeys">,
): Record<string, unknown> {
  const kept = preserved.unrecognizedServers.map((u) => u.raw);
  return {
    ...preserved.extraKeys,
    servers: [...nextServers, ...kept],
  };
}

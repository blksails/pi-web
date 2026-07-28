/**
 * MCP 配置的 secret 掩码与三态合并(spec: builtin-mcp-client,任务 3.1;Req 4.3, 7.2-7.4)。
 *
 * **为什么不复用 `./secret-merge.ts`**:通用实现只认两种形态 —— 扁平 object(顶层 secret 字段
 * + record 子字段)与单 record 域;而 MCP 配置是 `objectList` + `variants` 的**深层嵌套**
 * (`servers[].transport.{env,headers}`),通用遍历器到不了那一层。扩展通用实现会越出本 spec
 * 的边界(且影响所有既有域),故此处**复用 secret 三态的协议语义与类型**,只自建针对该已知
 * 结构的遍历器。
 *
 * 掩码位置:每个 server 的 `transport.env`(stdio)与 `transport.headers`(远程)的**全部值**
 * —— 与表单 IR 的 `itemKind:"secret"` 一一对应。
 */
import {
  isSecretWrite,
  type SecretMask,
  type SecretWrite,
} from "@blksails/pi-web-protocol";

/** transport 下承载凭据的 record 字段名。 */
const SECRET_RECORD_KEYS = ["env", "headers"] as const;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function maskOf(value: unknown): SecretMask {
  const set = typeof value === "string" && value.length > 0;
  return { __secret: true, set };
}

/**
 * 读路径:把凭据值替换为掩码,**明文绝不回读浏览器**(Req 4.3, 7.2)。
 * 其余字段原样保留。
 */
export function maskMcpSecrets(config: unknown): unknown {
  if (!isPlainObject(config)) return config;
  const servers = config["servers"];
  if (!Array.isArray(servers)) return config;

  return {
    ...config,
    servers: servers.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      const transport = entry["transport"];
      if (!isPlainObject(transport)) return entry;

      const nextTransport: Json = { ...transport };
      for (const key of SECRET_RECORD_KEYS) {
        const record = transport[key];
        if (!isPlainObject(record)) continue;
        const masked: Json = {};
        for (const [k, v] of Object.entries(record)) masked[k] = maskOf(v);
        nextTransport[key] = masked;
      }
      return { ...entry, transport: nextTransport };
    }),
  };
}

/** 按 server 名建立磁盘侧索引,供 `keep` 取回原值。 */
function indexByName(servers: unknown): Map<string, Json> {
  const map = new Map<string, Json>();
  if (!Array.isArray(servers)) return map;
  for (const entry of servers) {
    if (isPlainObject(entry) && typeof entry["name"] === "string") map.set(entry["name"], entry);
  }
  return map;
}

function diskRecordFor(diskEntry: Json | undefined, key: string): Json {
  const transport = diskEntry?.["transport"];
  if (!isPlainObject(transport)) return {};
  const record = transport[key];
  return isPlainObject(record) ? record : {};
}

/**
 * 写路径:解析 secret 三态(Req 7.3, 7.4)。
 * - `keep`  → 取磁盘原值(原值不存在则该键被丢弃,等价于未设置)
 * - `clear` → 移除该键
 * - `set`   → 采用新明文
 * 非 SecretWrite 的普通字符串按明文直存(允许用户直接粘贴值)。
 */
export function mergeMcpSecrets(incoming: unknown, disk: unknown): unknown {
  if (!isPlainObject(incoming)) return incoming;
  const servers = incoming["servers"];
  if (!Array.isArray(servers)) return incoming;

  const diskIndex = indexByName(isPlainObject(disk) ? disk["servers"] : undefined);

  return {
    ...incoming,
    servers: servers.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      const transport = entry["transport"];
      if (!isPlainObject(transport)) return entry;

      const diskEntry =
        typeof entry["name"] === "string" ? diskIndex.get(entry["name"]) : undefined;
      const nextTransport: Json = { ...transport };

      for (const key of SECRET_RECORD_KEYS) {
        const record = transport[key];
        if (!isPlainObject(record)) continue;
        const previous = diskRecordFor(diskEntry, key);
        const resolved: Json = {};

        for (const [k, v] of Object.entries(record)) {
          if (!isSecretWrite(v)) {
            resolved[k] = v;
            continue;
          }
          const action = (v as SecretWrite).action;
          if (action === "clear") continue;
          if (action === "keep") {
            const prior = previous[k];
            if (prior !== undefined) resolved[k] = prior;
            continue;
          }
          resolved[k] = (v as { readonly value: string }).value;
        }
        nextTransport[key] = resolved;
      }
      return { ...entry, transport: nextTransport };
    }),
  };
}

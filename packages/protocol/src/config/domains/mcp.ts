/**
 * 配置域 — mcp(内置 MCP 客户端,spec: builtin-mcp-client)。
 *
 * 落 `<agentDir>/mcp.json`,由内置 `mcpExtension` 在**会话装配期**读取(改动下次新建会话生效)。
 *
 * ⚠ 本域**不进** `ConfigDomainId` 联合、不走通用 `/config/:domain` —— 宿主契约 v1 §5.3 已冻结
 * capability id `config.mcp`(对应独立工厂 `createMcpConfigRoutes`),并入通用域会使该 id 失去
 * 内容,属破坏性变更(两端须重新表态)。故保留独立端点,仅把其内部实现升级为结构化。
 *
 * 两侧手写、职责分离(与既有分工一致:zod 管服务端校验,FormSchema 管前端渲染):
 *  - {@link mcpConfigSchema} —— 服务端 PUT 校验。用 `discriminatedUnion` 表达传输判别联合。
 *  - {@link mcpFormSchema}   —— 前端渲染 IR。用 `variants` 表达"按传输切换字段集"。
 * 之所以不经 `zodToFormSchema` 自动生成:该适配器不支持 `ZodDiscriminatedUnion`,生成不出
 * `variants`(见 spec design)。两侧的传输分支必须同步演进。
 *
 * `.passthrough()` 是 Req 5.4 的一半实现:未识别字段在校验阶段不被剥离;另一半(未识别顶层键
 * 与未识别传输类型条目的保留)由 `McpConfigCodec` 在读写合并时承担。
 */
import { z } from "zod";
import type { FieldDescriptor, FormSchema } from "../form-schema.js";

/** 三种标准 MCP 传输(Req 2.1);判别键为 `type`。 */
export const MCP_TRANSPORT_TYPES = ["stdio", "sse", "streamable-http"] as const;
export type McpTransportType = (typeof MCP_TRANSPORT_TYPES)[number];

/**
 * server 名称形状:非空且限定为可安全嵌入工具名的字符集。
 *
 * 工具注册名为 `<serverName>__<toolName>`(Req 3.4),故名称:
 *  - 不得含空白或分隔符以外的符号;
 *  - **不得含连续下划线 `__`** —— 否则工具名无法反解析回 (server, tool),且
 *    `a__b` + 工具 `c` 会与 server `a` + 工具 `b__c` 撞名。允许单个下划线(如 `my_server`)。
 */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9](?:_(?!_)|[A-Za-z0-9-])*$/;

/** 工具注册名的 server/tool 分隔符。 */
export const MCP_TOOL_NAME_SEPARATOR = "__";

// ── 服务端校验 schema ─────────────────────────────────────────────────────────

const stdioTransportSchema = z
  .object({
    type: z.literal("stdio"),
    /** Req 2.2:stdio 要求启动命令。 */
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    /** 值一律按 secret 处理(Req 7.2)。 */
    env: z.record(z.string()).default({}),
  })
  .passthrough();

const sseTransportSchema = z
  .object({
    type: z.literal("sse"),
    /** Req 2.3:远程传输要求服务端地址。 */
    url: z.string().url(),
    headers: z.record(z.string()).default({}),
  })
  .passthrough();

const streamableHttpTransportSchema = z
  .object({
    type: z.literal("streamable-http"),
    url: z.string().url(),
    headers: z.record(z.string()).default({}),
  })
  .passthrough();

export const mcpTransportSchema = z.discriminatedUnion("type", [
  stdioTransportSchema,
  sseTransportSchema,
  streamableHttpTransportSchema,
]);

export const mcpServerSchema = z
  .object({
    name: z.string().min(1).regex(MCP_SERVER_NAME_PATTERN),
    /** 缺省视为启用(Req 1.4 的反面)。 */
    enabled: z.boolean().default(true),
    transport: mcpTransportSchema,
  })
  .passthrough();

/**
 * MCP 配置根 schema。名称唯一性(Req 1.1)在此以 refinement 表达 —— 单条 issue 指向重复项,
 * 使 PUT 400 能明确指出问题字段(Req 2.5)。
 */
export const mcpConfigSchema = z
  .object({
    servers: z.array(mcpServerSchema).default([]),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.servers.forEach((server, index) => {
      const name = server.name;
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["servers", index, "name"],
          message: `duplicate server name: ${name}`,
        });
        return;
      }
      seen.add(name);
    });
  });

export type McpTransportConfig = z.infer<typeof mcpTransportSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

// ── 前端渲染 IR ───────────────────────────────────────────────────────────────

/** 远程传输(SSE / Streamable HTTP)共用字段:地址 + 自定义请求头(值掩码)。 */
const remoteTransportFields: readonly FieldDescriptor[] = [
  {
    key: "url",
    kind: "string",
    label: "服务端地址",
    description: "MCP server 的 HTTP(S) 端点。",
    placeholder: "https://example.com/mcp",
    required: true,
  },
  {
    key: "headers",
    kind: "record",
    // record 标量值的元素类型 —— 使自定义请求头的值一律掩码(Req 7.2)。
    itemKind: "secret",
    label: "自定义请求头",
    description: "常用于携带鉴权令牌;值以掩码保存与显示,不会回读明文。",
    required: false,
  },
];

const transportVariantCases = [
  {
    value: "stdio",
    label: "本地进程 (stdio)",
    fields: [
      {
        key: "command",
        kind: "string",
        label: "启动命令",
        description: "⚠ 该命令将在本机执行。",
        placeholder: "npx",
        required: true,
      },
      {
        key: "args",
        kind: "stringList",
        itemKind: "string",
        label: "启动参数",
        required: false,
      },
      {
        key: "env",
        kind: "record",
        itemKind: "secret",
        label: "环境变量",
        description: "值以掩码保存与显示,不会回读明文。",
        required: false,
      },
    ] as readonly FieldDescriptor[],
  },
  {
    value: "sse",
    label: "SSE",
    fields: remoteTransportFields,
  },
  {
    value: "streamable-http",
    label: "Streamable HTTP",
    fields: remoteTransportFields,
  },
] as const;

/**
 * MCP 配置表单 IR。
 *
 * 全程复用**现有**表单能力,不扩展 IR:
 *  - `objectList`  —— 多个 server 条目(Req 1.1/4.2)
 *  - `variants`    —— 按传输类型切换字段集(Req 2.4)
 *  - `itemKind:"secret"` —— env / headers 的值一律掩码(Req 7.2)
 */
export const mcpFormSchema: FormSchema = {
  domain: "mcp",
  title: "MCP",
  fields: [
    {
      key: "servers",
      kind: "objectList",
      label: "MCP 服务器",
      description:
        "连接外部 MCP server,把其工具注入 agent 会话。改动在下次新建会话生效。",
      required: false,
      itemFields: [
        {
          key: "name",
          kind: "string",
          label: "名称",
          description: "会话内唯一;作为工具名前缀(如 files__read_file)。",
          placeholder: "filesystem",
          required: true,
        },
        {
          key: "enabled",
          kind: "boolean",
          label: "启用",
          description: "关闭后不建立连接,其工具不进入会话。",
          required: false,
          default: true,
        },
        {
          key: "transport",
          kind: "object",
          label: "连接方式",
          required: true,
          variants: {
            discriminator: "type",
            cases: transportVariantCases.map((c) => ({
              value: c.value,
              label: c.label,
              fields: c.fields,
            })),
          },
        },
      ],
    },
  ],
};

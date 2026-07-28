# Research Log — builtin-mcp-client

> Discovery 类型:**Integration-focused(复杂集成)** —— 既有系统扩展 + 外部协议 + 跨进程能力注入。
> 采集日期:2026-07-24。事实源一律为仓内代码与 `node_modules` d.ts(不凭记忆)。

## 1. 现状勘定

| 项 | 实况 | 位置 |
|---|---|---|
| MCP 现有支持 | **非内置**,依赖外部扩展 `pi-mcp-adapter` | `packages/server/src/config/mcp-config-routes.ts:15` |
| 配置形态 | 裸 JSON 文本编辑(不喂 schema,前端 configFiles 控件回退) | 同上 `:70` |
| 可见性门控 | 仅当 `settings.json packages[]` 含 adapter 时 `installed:true` | 同上 `:47-51` |
| 落盘 | `<agentDir>/mcp.json` | 同上 `:16,55` |
| 前端面板 | 单 `configFiles` 字段 + 异步探测 `installed` 决定是否登记 | `lib/settings/register-panels.ts:203-239` |

## 2. 外部依赖验证

| 依赖 | 版本 | 结论 |
|---|---|---|
| pi SDK `@earendil-works/pi-coding-agent` | **0.80.3** | **不自带 MCP**(全仓 d.ts 无 `modelcontextprotocol` 命中)→ 客户端须自建 |
| `@modelcontextprotocol/sdk` | **1.29.0**,`node >=18` | 项目未安装,需新增。官方提供 `Client` + 三传输类 |

三传输官方类名(已核实):`StdioClientTransport`(spawn 本地进程)、`SSEClientTransport`(SSE-only 回退)、`StreamableHTTPClientTransport`(远程 HTTP)。官方推荐「先 StreamableHTTP、失败回退 SSE」的探测模式;本设计因 Req 2 要求**用户显式选协议**,不采用自动回退(避免行为不可预期)。

## 3. 关键接缝(决定架构形态)

### 3.1 工具注入接缝
`ExtensionAPI.registerTool<TParams extends TSchema>(tool: ToolDefinition)`(pi SDK `dist/core/extensions/types.d.ts:855`)。

`ToolDefinition.parameters: TParams`,而 `TSchema` 来自 **TypeBox**(`types.d.ts:13`)。TypeBox schema 本质即标准 JSON Schema —— **MCP tool 的 `inputSchema`(JSON Schema)可低成本适配**,无须重建 schema 编译器。这是本设计成立的关键前提。

`execute(toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult<TDetails>>`。

### 3.2 内置 extension 的注入范式(★ 决定 MCP 客户端跑在哪个进程)
工具只能在 **extension factory 内**注册,而 extension 在 **runner 子进程**加载 → **MCP 客户端必须运行在 runner 子进程**,不能在主 server 进程。

pi-web 强制注入内置 extension 的既有链路(auto-title / ext-tools 范例):
```
tool-kit 导出 xxxEntryPath()          @blksails/pi-web-tool-kit/auto-title-entry
  → 主进程按开关注入 spawn env        lib/app/pi-handler.ts:542-543,747
  → runner 读 env 加入 extensions     packages/server/src/runner/option-mapper.ts:252-253
  → AgentDefinition.extensions        runner/agent-definition.ts:145(append-only,可挂 factory)
```

`AgentDefinition.extensions?: Array<string | ExtensionFactory>` —— append-only,与 agent 自身声明的 extensions 并存。

### 3.3 ⚠️ 已知陷阱:spawn env 须改三处
集成设计 §7.1 记录的既有缺陷:`PI_WEB_SANDBOX_ENTRY`/`_EXT_TOOLS_ENTRY`/`_AUTO_TITLE_ENTRY` **只在 real 分支下发**,e2b 分支不下发,且 e2b 另有 `envPassthrough` 白名单硬门。**新增 spawn env 漏改任一处 → 该传输下静默失效**。本特性的 `PI_WEB_MCP_ENTRY` 必须三处齐改并有守卫。

### 3.4 配置层接缝
| 改动点 | 位置 |
|---|---|
| ① `ConfigDomainId` 字面量联合 + `CONFIG_FORM_SCHEMAS` | `packages/protocol/src/config/index.ts:33,36` |
| ② server 侧 `DOMAIN_SCHEMAS`(zod) | `packages/server/src/config/config-routes.ts:31` |
| ③ 前端面板登记 | `lib/settings/register-panels.ts` |

## 4. ★ 表单 IR 表达力核验(决定「零新增能力」)

`FormSchema` 现有能力**恰好覆盖** MCP 配置形态,无需扩展表单 IR:

| MCP 配置需要 | FormSchema 既有能力 | 位置 |
|---|---|---|
| server 列表(多条目) | `FieldKind: "objectList"` + `itemFields` | `form-schema.ts:19,72` |
| 按传输协议切换字段集(Req 2.4) | **`FieldVariants`**:`discriminator` + `cases[]` | `form-schema.ts:38-47,74` |
| `env`/`headers` 的值一律掩码(Req 7.2) | **`itemKind: "secret"`**(record 标量值元素类型) | `form-schema.ts:76` |
| 单个凭据字段掩码 | `kind:"secret"` / `secret:true` | `form-schema.ts:11,80` |
| 改后即时生效 | `liveReload` | `form-schema.ts:87` |

secret 三态(`keep`/`clear`/`set`)与掩码/合并已实现:`packages/protocol/src/config/secret.ts:19-21`、`server/src/config/secret-merge.ts`。

## 5. 架构决策(synthesis)

| # | 决策 | 理由 |
|---|---|---|
| D1 | MCP 客户端运行在 **runner 子进程** | 工具注册只在 extension factory 内可用(§3.2) |
| D2 | 以**内置 `ExtensionFactory`** 实现,照 auto-title 范式经 `PI_WEB_MCP_ENTRY` 注入 | 复用既有强制注入链路,满足 Req 5.1「零扩展依赖」 |
| D3 | **adopt** `@modelcontextprotocol/sdk@1.29.0`,不自建协议栈 | 自建 JSON-RPC/三传输/能力协商成本高且易错;官方 SDK 覆盖三传输 |
| D4 | MCP `inputSchema` **直接透传**为 TypeBox `TSchema`,非法/缺失时兜底为宽松 object | TypeBox schema 即 JSON Schema(§3.1);兜底避免单个坏工具毒化整个 server |
| D5 | 工具名前缀 `<serverName>__<toolName>` 解决同名冲突(Req 3.4) | 保持对 LLM 与用户都可区分且稳定 |
| D6 | **保留 `config.mcp` 独立路由与冻结的 capability id**,只改其内部实现 | 见 §6 契约约束 —— 并入 `/config/:domain` 会破坏已冻结契约 |
| D7 | 连接状态经 **status/probe 端点**暴露给设置页(主进程侧探测) | 设置页无会话态(与 `aigc-models-routes` 同一约束),无法读 runner 内连接态 |
| D8 | 读写 `mcp.json` **保留未识别字段**(passthrough) | Req 5.4 明确要求不擅自丢弃 |

### 5.1 build-vs-adopt
- **adopt**:MCP 协议栈(官方 SDK)、表单 IR(既有 FormSchema,零扩展)、secret 三态(既有)、extension 注入链路(既有)。
- **build**:仅「MCP↔pi 工具适配层」与「配置 schema + 探测服务」——真正的新增面很薄。

## 6. ★ 跨 spec 约束:宿主契约 v1

`docs/pi-web-host-contract-v1.md` §5.3 **已冻结** capability id `config.mcp`(对应 `createMcpConfigRoutes`),且 §5.2.4 规定「id 一经发布不得改名」。

→ 若把 MCP 并入标准 `/config/:domain`,`config.mcp` 的 factory 将失去内容,**两端(pi-clouds/desktop)须重新表态**,属破坏性变更。
→ **本设计采取 D6**:保留独立路由与 id,内部升级为结构化 schema + 复用 secret 三态。契约零破坏。

另需保持 **M3 已修的 Router 顺序**:`config.mcp` 必须排在 `config.domains` **之前**,否则 `/config/:domain` 会抢 `GET /config/mcp`(M3 曾因此产生真实缺陷)。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| spawn env 三处漏改致 e2b 下静默失效(§3.3) | 三处齐改 + 专门守卫用例断言 e2b 分支 env 与白名单 |
| stdio 传输 spawn 子进程,配置面探测成本高 | 探测带短超时 + 结果缓存,不在打开页面时自动全量探测 |
| 坏 `inputSchema` 导致工具注册失败 | D4 兜底宽松 schema,单工具失败不影响同 server 其余工具 |
| MCP server 连接阻塞会话启动 | 连接异步化 + 超时,失败降级(Req 1.5) |
| 契约 `config.mcp` 顺序被后续改动破坏 | 沿用 M3 的顺序守卫用例 |

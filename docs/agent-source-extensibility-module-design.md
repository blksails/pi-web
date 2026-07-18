# AgentSource 扩展模块(Source Module)统一设计

> ⚠️ **依赖升格(2026-07-04)**:本篇 §6 的 Agent Routes(M1)经
> [Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md) C6 裁决,
> 从可选扩展接缝升格为**框架数据面前置依赖**,并追加只读法/溢出法/ETag 协议三条契约约束。

> 状态:pre-spec 设计稿(2026-07-04)。目标是把现有五个扩展面收口为**一个扩展模块标准**,
> 并新增两个接缝:**Agent Routes(HTTP 路由扩展)** 与 **UI Settings(设置面板扩展)**。
> 落地前应走 kiro 流程分拆为 spec。
> 系列第二篇:[Artifact 扩展面与组件族设计](./artifact-extensibility-design.md)
> (面 4 的 Artifact 子面深化:三种制品来源、宿主/iframe 两套 React 组件族、工具制品协议)。
> 系列第三篇:[Canvas 扩展机制设计(CanvasKit)](./canvas-extension-mechanism-design.md)
> (以 Canvas 为可扩展宿主:工具/动作/图层/检查器插件化 + 能力清单 agent 权威下发)。

> ---
> ⚠️ **实况更正(2026-07-19 · 扩展性真机验证 Phase A 取证)**:本篇 §3 总表 / §6 / §7 里面⑥⑦标注「🆕本设计」的 API 名**均为 pre-spec 虚构,落地时已改,勿照抄本篇字面**:
> - **面⑥ Agent Routes 已落地,但换名为 `agent-declared-routes`**(已合 main,`@blksails/pi-web-server` 含之)。真实 API:声明用 `AgentDefinition.routes`(**非** `defineRoutes`);runner 装配桥 `agent-routes-wiring`(**非** `ext_http_request` 帧);built-in HTTP 端点 **`GET /sessions/:id/agent-routes` + `GET|POST /sessions/:id/agent-routes/:name`**(**非** `/sessions/:id/routes/*`,见 `create-handler.ts` 注册);门控 env **`PI_WEB_AGENT_ROUTES_DISABLED`(=`"1"` 关,默认开)**;body 上限 `PI_WEB_AGENT_ROUTE_BODY_LIMIT`(默认 1 MiB);超时 `PI_WEB_AGENT_ROUTE_TIMEOUT_MS`。本篇的 `defineRoutes`/`ext_http_request`/`ExtRouteContext`/`ROUTES_NOT_DECLARED` 等标识符**均不存在于代码**。
> - **面⑦ UI Settings(per-source 设置面板)尚未落地**:`AgentContext.settings`、`registerSourceSettingsPanel`、`ext_settings_changed`、`useSourceSettings`、`settingsWidgets`、`/api/config/source/:sourceId` **pi-web + pi-clouds 两仓皆零命中**。要做须先立 spec。现存的只有通用 config-domain 的 `registerSettingsPanel`(服务内建 auth/aigc/vision 等域,**非** per-source 扩展面)。
> ---

---

## 1. 目标与非目标

### 目标

1. **一个 agent source = 一个扩展模块**:行为、资源、UI、路由、设置由**同一份清单**(`pi-web.json` 演进)声明,同一目录约定承载,同一信任管线门控。
2. 新增 **Agent Routes**:agent source 可声明 HTTP 路由,在**runner 子进程**内执行(会话作用域),经既有 RPC 通道转发——不在主进程执行任意 source 代码。
3. 新增 **UI Settings**:agent source 可声明设置 schema,宿主设置外壳(`<SettingsShell>`)零改动动态长出该 source 的面板;值持久化到 per-source 配置文件,runner 装配期消费。
4. 全部新接缝**沿用既有安全模型**:trust 门控(项目资源)、签名/SRI(浏览器代码)、管理员门控(安装)、进程隔离(source 行为代码只进 runner 子进程)。

### 非目标

- 不改 pi RPC 协议的封闭 union(`response`/`event`/`extension_ui_request`);新通道走 state-bridge 同款「自定义 stdout/stdin 行」接缝。
- 不支持 source 代码进主进程执行(v1);主进程只消费**声明式清单**。
- 不做 sessionless 常驻服务路由(v2 展望,见 §10)。

---

## 2. 统一模型:四个运行时、一份清单

一个扩展模块的代码分布在**四个运行时**,这是不可合并的物理事实——统一的对象是**清单与目录约定**,不是入口文件:

```
┌─────────────────────────────────────────────────────────────────┐
│                        pi-web.json(脊柱)                     │
│      单一事实来源:声明各运行时入口 + 能力 + 两层契约锚点            │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┘
       │              │              │              │
┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐┌──────▼──────────┐
│ runner 子进程││   主进程     ││   浏览器     ││   声明式(零代码) │
│ index.ts    ││ (仅读清单,   ││ .pi/web/    ││ settings/schema │
│ routes/     ││  不执行源码) ││ web.config  ││ manifest.config │
│ .pi/ 资源   ││ 转发/托管/   ││ 五层 + 新增  ││ (Tier5/设置面板) │
│             ││ 验签/门控    ││ settings 控件││                 │
└─────────────┘└─────────────┘└─────────────┘└─────────────────┘
```

**安全不变量**(模型 A 的延伸):

| 运行时 | 能执行 source 代码? | 门控 |
|---|---|---|
| runner 子进程 | ✅(行为主体) | trust(项目资源)/ 白名单安装 |
| 主进程 | ❌ 永不 | 只解析清单 + 转发字节(SRI/验签托管) |
| 浏览器 | ✅(webext) | SRI + Ed25519 签名 + CSS scoping + import map 单例 |
| 声明式 | —(纯数据) | zod schema 校验,非法降级 diagnostics |

---

## 3. 扩展面总表(七面)

| # | 扩展面 | 载体 | 运行时 | 现状 |
|---|---|---|---|---|
| 1 | Agent 行为 | `index.ts`(AgentDefinition) | runner | ✅ 已有 |
| 2 | pi 资源 | `.pi/{extensions,skills,agents,commands,settings.json}` | runner | ✅ 已有 |
| 3 | 运行时交互通道 | `ctx.ui.*` / `emitUi` / state 桥 / 附件 / ui-rpc | runner↔浏览器 | ✅ 已有 |
| 4 | Web UI 五层 | `.pi/web/web.config.tsx` + dist | 浏览器 | ✅ 已有 |
| 5 | 包形态 | `pi-web.json`(pi 层 + web 层 + bindings) | 主进程(声明) | ✅ 已有 |
| 6 | **Agent Routes** | `routes/index.ts`(defineRoutes) | **runner**(RPC 转发) | 🆕 本设计 |
| 7 | **UI Settings** | `settings/schema.json` + webext settings 控件 | 声明式 + 浏览器 | 🆕 本设计 |

---

## 4. 目录结构(完整约定)

```
<agent-source>/                        # 一个扩展模块 = 一个目录/git 仓库/npm 包
├── pi-web.json                     # 脊柱清单(§5);缺失时逐面回退既有目录探测
├── index.ts                           # 面1:AgentDefinition(defineAgent / 工厂)
├── routes/                            # 面6:HTTP 路由(runner 进程执行)
│   └── index.ts                       #   defineRoutes({...}) 默认导出
├── settings/                          # 面7:设置面板
│   ├── schema.json                    #   FormSchema 兼容的静态 schema(主体)
│   └── defaults.json                  #   可选:默认值种子
├── .pi/
│   ├── extensions/                    # 面2:项目级 pi 扩展(trust 门控)
│   ├── skills/<name>/SKILL.md
│   ├── agents/<name>.md
│   ├── commands/
│   ├── settings.json                  # 项目级 pi settings(逐键覆盖全局)
│   └── web/                           # 面4:WebExtension
│       ├── web.config.tsx             #   五层 + settingsWidgets(新 capability)
│       ├── styles.css
│       ├── artifact.html              #   Tier4 可选
│       └── dist/                      #   pi-web build 产物(mjs + manifest + SRI)
├── extensions/ skills/                # 面5:被安装为包时的包根资源(DefaultPackageManager 约定)
│                                      #   .pi/extensions/x.ts 薄转发到包根,消除双份
├── AGENTS.md                          # context 文件(不受 trust 门控)
└── README.md
```

**回退规则**(向后兼容,与 `resolvePiPlugin` 现行为一致):无 `pi-web.json` 时,
`routes/index.ts` 存在即启用路由面、`settings/schema.json` 存在即启用设置面(与
`proxy.json 铁证` 同款「文件存在即门控」哲学);字段非法/文件缺失降级 `diagnostics`,不
使整模块失败。

---

## 5. 清单演进(`pi-web.json`)

在既有统一插件包标准上追加两段,保持纯声明、可 zod 校验:

```jsonc
{
  "id": "acme-crm",
  "version": "1.2.0",

  // ── 既有 ──────────────────────────────────────────────
  "pi":  { "extensions": ["extensions/crm.ts"], "skills": ["skills/crm-report"] },
  "web": { "dist": ".pi/web/dist", "commands": ["crm"] },
  "bindings": { "tools": ["crm_query"] },       // 工具名 = pi 层与 web 层咬合锚点

  // ── 新增:面6 Agent Routes ────────────────────────────
  "routes": {
    "entry": "routes/index.ts",                 // runner 进程内载入(jiti,同 index.ts 车道)
    "scope": "session",                         // v1 仅 session;v2 预留 "source"
    "timeoutMs": 10000                          // 单请求上限(默认 10s,封顶 30s)
  },

  // ── 新增:面7 UI Settings ─────────────────────────────
  "settings": {
    "schema": "settings/schema.json",           // FormSchema 兼容(见 §7)
    "title": "CRM 助手",                        // 设置面板菜单项标题
    "icon": "briefcase",                        // lucide 图标名
    "scope": "source",                          // 存储作用域:source | project
    "widgets": ["crmEntityPicker"]              // 依赖的动态控件(须由本模块 webext 提供)
  }
}
```

校验 schema 放 `packages/protocol/src/plugin/`(与 web-ext config 同层),
`resolvePiPlugin` 扩展产出 `PluginDescriptor.routes / .settings` 两个新切片。

---

## 6. 新接缝 A:Agent Routes(HTTP 路由扩展)

### 6.1 关键决策:在哪个进程执行?

**决策:runner 子进程执行,主进程转发。** 理由:

1. 主进程执行 source 代码 = 给任意 agent source 完整宿主权限(RCE),且与
   「pi SDK 须 webpack external」的 dev 约束冲突;
2. 路由处理器天然需要 agent 侧上下文(state KV、附件、工具、会话内存),这些的权威
   本来就在 runner 进程(AAS 范式的根本约束);
3. 转发通道现成:与 state-bridge 完全同构的「自定义 JSONL 行」接缝,pi 协议零改动。

### 6.2 架构与协议帧

```
浏览器 / 外部调用方
  │  POST /api/sessions/:id/routes/report/summary
  ▼
主进程 builtin 路由 "ALL /sessions/:id/routes/*"     ← 挂在既有 sessions 段,
  │  ① 会话存在性 + isBusy 检查                         复用 Next catch-all,
  │  ② 请求体大小上限(默认 1MB)+ 白名单 header 提取      避开「新顶层段静默 404」坑
  │  ③ 经 session 的 RPC 通道写 stdin 一行:
  │     {"type":"ext_http_request","id":"r1","method":"POST",
  │      "path":"/report/summary","query":{...},"headers":{...},"body":{...}}
  ▼
runner 子进程(第二 stdin reader,与 state 桥共用分发器)
  │  ④ 按 path 匹配 defineRoutes 表 → 执行 handler(ctx)
  │  ⑤ fs.writeSync(1) 直写 fd1 回一行:                ← 必须直写:runRpcMode
  │     {"type":"ext_http_response","id":"r1",             takeOverStdout 会劫持
  │      "status":200,"body":{...}}                        process.stdout.write
  ▼
主进程 handleRawLine 侧路:按 id 配对 pending 请求 → 回 HTTP 响应
```

**约束(v1)**:

| 约束 | 值 | 理由 |
|---|---|---|
| 载荷 | JSON in / JSON out | JSONL 单行帧;二进制走附件系统(`att_<id>` 引用) |
| 流式 | 不支持 | 避免与 prompt 流、空闲控制流抢通道 |
| 超时 | 清单 `timeoutMs`,默认 10s | 挂起的 handler 不能拖死 RPC 通道 |
| busy 语义 | busy 时仍可转发(读操作),handler 自行判断 | stdin 帧不经 LLM 回合 |
| 并发 | 按会话 FIFO + id 配对(允许并发在途,上限 8) | 与 ui-rpc correlationId 同款 |
| 鉴权 | 继承宿主会话鉴权;路由处理器**不可**自行放宽 | 主进程是唯一门 |

### 6.3 作者侧范例代码

```ts
// routes/index.ts —— 在 runner 子进程内执行
import { defineRoutes } from "@blksails/pi-web-agent-kit";

export default defineRoutes({
  // GET /api/sessions/:id/routes/health
  "GET /health": async () => ({ status: 200, body: { ok: true } }),

  // POST /api/sessions/:id/routes/report/summary
  "POST /report/summary": async (req, ctx) => {
    // req: { method, path, params, query, headers(白名单), body }
    // ctx: agent 侧权威上下文
    const range = (req.body as { range?: string }).range ?? "7d";
    const cached = ctx.state.get<string>("report:last");   // state 桥同款 KV(只读)
    const atts = await ctx.attachments.listBySession();     // 附件门面(只读)
    const summary = await buildSummary(range, atts);
    // 注:routes 是只读数据面(SAR R-0a/C6-1)——写状态须走控制面命令,此处不落任何写。
    return { status: 200, body: summary };
  },

  // 路径参数
  "GET /entity/:entityId": async (req) => {
    return { status: 200, body: { id: req.params.entityId } };
  },
});
```

`agent-kit` 新增类型(纯类型 + 恒等函数,保持零运行时依赖):

```ts
// packages/agent-kit/src/routes.ts
export interface ExtRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>; // 白名单子集
  readonly body: unknown;
}
export interface ExtRouteResponse {
  readonly status: number;
  readonly body?: unknown;                 // JSON 可序列化
  readonly headers?: Record<string, string>;
}
export interface ExtRouteContext {
  readonly sessionId: string;
  readonly cwd: string;
  readonly settings: Readonly<Record<string, unknown>>; // 面7 的已解析值(§7.5)
  /** 只读:数据面不得写状态(SAR 契约 R-0a/C6-1,架构审查 P0 修复);变更走控制面命令。 */
  readonly state: { get<T>(k: string): T | undefined };
  readonly attachments: { listBySession(): Promise<ReadonlyArray<{ id: string; mime: string }>> };
}
export type ExtRouteHandler = (req: ExtRouteRequest, ctx: ExtRouteContext)
  => ExtRouteResponse | Promise<ExtRouteResponse>;
export type ExtRoutesMap = Readonly<Record<`${string} /${string}`, ExtRouteHandler>>;
export function defineRoutes(routes: ExtRoutesMap): ExtRoutesMap { return routes; }
```

### 6.4 宿主侧接线要点

- runner 装配期(`startRunner`,与 slash_completions/state 桥同窗口):清单有 `routes.entry`
  → jiti 载入 → 注册进 stdin 分发器;载入失败降级 diagnostics + 该面 501。
- 主进程:builtin 路由挂 `sessions` 段(**不新开顶层段**);未声明路由的 source 一律 404
  `ROUTES_NOT_DECLARED`,超时 504 `ROUTE_TIMEOUT`。
- **项目级 trust 同样适用**:`routes/index.ts` 属 source 代码,CLI 模式无此面
  (仅 custom 模式;CLI 模式回 501),未 trust 的项目 source 不载入路由表。
- 集成测试**必须**用真实子进程(stub 抓不到 takeOverStdout 劫持类回归,state 桥教训)。

---

## 7. 新接缝 B:UI Settings(设置面板扩展)

### 7.1 关键决策:静态 schema 服务端下发 + 动态控件走 widget

沿用两条已定型规则:

1. **「静态 schema + widget 动态」**:schema 是纯数据(声明式),由服务端解析下发——这与
   「前端不读后端注入 formSchema」不冲突:那条规则禁的是*动态选项*走 schema 下发;
   `ConfigFilesField` 透传 `fileSchemas` 已是服务端下发结构的先例。动态选项(如实体
   下拉)必须走 **widget 键 + 数据端点 + 自定义 renderer**。
2. **「外壳预制恒在,面板按 schema 现生成」**(ext-settings-ui 定稿):`<SettingsShell>`
   零改动;source 面板是运行时登记的,门控 = 清单/文件存在(`registerMcpPanelIfInstalled`
   同款范式)。

### 7.2 数据流

```
settings/schema.json(模块内,纯声明)
  │ 服务端 resolvePiPlugin 解析 → 校验(FormSchema zod)→ 缓存
  ▼
GET /api/config/source/:sourceId          ← 通用端点(挂既有 config 段)
  → { schema, values, version }              schema=已校验 FormSchema,values=当前值
PUT /api/config/source/:sourceId
  → 服务端按 schema 校验 → 写 <agentDir>/sources/<sourceKey>/settings.json
  ▼
前端 registerSourceSettingsPanel(sourceId)   ← source 激活时动态登记(幂等,按 id 覆盖)
  → SettingsShell 长出「CRM 助手」菜单项 → 通用 schema 表单渲染
  → schema 里 widget:"crmEntityPicker" → per-source 控件注册表命中 webext 提供的 renderer
  ▼
消费(双通道):
  a) 装配期:runner assemble 读 settings.json → 注入 AgentContext.settings
     (aigc-tool-settings 持久文件先例;改值下次会话/reload 生效)
  b) 运行期(可选):PUT 成功后主进程经 stdin 推 {"type":"ext_settings_changed",...}
     → 已声明 liveReload 的键实时生效(state 桥同款)
```

`sourceKey` = source 标识的稳定散列(与 attachment store 的 per-source 目录同法),
避免路径注入;`scope:"project"` 时改写 `<cwd>/.pi/source-settings.json`(trust 门控)。

### 7.3 schema 范例

```jsonc
// settings/schema.json —— FormSchema 兼容(packages/protocol 的既有 IR)
{
  "domain": "source:acme-crm",
  "title": "CRM 助手",
  "fields": [
    { "key": "apiBase",   "kind": "string",  "label": "CRM API 地址", "required": true },
    { "key": "apiKey",    "kind": "secret",  "label": "API Key" },          // 掩码 + SecretWrite
    { "key": "syncDaily", "kind": "boolean", "label": "每日自动同步", "default": true },
    { "key": "defaultEntity", "kind": "string", "label": "默认实体",
      "widget": "crmEntityPicker",                                          // 动态控件(§7.4)
      "description": "选项来自 GET /api/sessions/:id/routes/entity(本模块自己的路由面)" },
    { "key": "reportSections", "kind": "record", "label": "报表分区" }
  ],
  "liveReload": ["syncDaily"]        // 这些键改动经 ext_settings_changed 实时下发
}
```

注意闭环:**动态控件的数据端点可以就是本模块的 Agent Routes**——面6 与面7 互为供给,
这正是收口成一个模块的价值。

### 7.4 webext 提供动态控件(新 capability)

```tsx
// .pi/web/web.config.tsx(节选)
import { defineWebExtension, type UiRpcClient } from "@blksails/pi-web-kit";
import { CrmEntityPicker } from "./crm-entity-picker.js";

export default defineWebExtension({
  manifestId: "acme-crm",
  capabilities: ["slots", "renderers", "settingsWidgets"],   // 🆕 settingsWidgets
  settingsWidgets: {
    // 键与 schema.json 的 widget 值对齐;宿主以 per-source 命名空间注册,
    // 卸载/切源即回收,不污染全局 field-registry
    crmEntityPicker: CrmEntityPicker,
  },
  renderers: { tools: { crm_query: CrmResultCard } },
});
```

宿主侧:`registerFieldRendererByKey` 之上加一层 **scoped registry**
(`registerSourceFieldRenderer(sourceId, key, comp)`),查找顺序 per-source → 全局;
webext 未加载/验签失败时该字段降级为只读 JSON 编辑(不 fail 整面板)。

### 7.5 agent 侧消费范例

```ts
// index.ts —— 装配期读取(工厂形态)
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentContext } from "@blksails/pi-web-agent-kit";

export default async function (ctx: AgentContext) {
  const cfg = ctx.settings as { apiBase?: string; apiKey?: string; syncDaily?: boolean };
  return defineAgent({
    systemPrompt: `You are the ACME CRM assistant. API: ${cfg.apiBase ?? "unset"}`,
    customTools: cfg.apiBase !== undefined ? [buildCrmQueryTool(cfg)] : [],
  });
}
```

`AgentContext.settings` 由 runner 装配期从 `<agentDir>/sources/<sourceKey>/settings.json`
读出注入(无文件 = `{}`);secret 字段在服务端解掩码后仅经 spawn env/stdin 传给子进程,
不落浏览器。

---

## 8. 完整示例模块:`examples/module-crm-agent`

一个贯穿全部七面的可跑范例(验收 fixture,类比 `webext-slots-agent` 的角色):

```
examples/module-crm-agent/
├── pi-web.json            # §5 全字段
├── index.ts                  # 工厂形态,消费 ctx.settings,注册 crm_query 工具
├── routes/index.ts           # /health + /entity(供设置控件取选项)+ /report/summary
├── settings/schema.json      # §7.3(含 secret + widget + liveReload)
├── .pi/
│   ├── skills/crm-report/SKILL.md
│   └── web/
│       ├── web.config.tsx    # panelRight 面板 + crm_query 富卡 + crmEntityPicker 控件
│       └── dist/
├── AGENTS.md
└── README.md                 # 逐面验收步骤(照 examples README 风格)
```

**验收闭环**(e2e 脚本骨架):

1. 选源 → 设置里出现「CRM 助手」面板(面7 门控生效);
2. 面板里 `crmEntityPicker` 下拉有选项(面7 widget → 面6 路由 → runner,全链路);
3. 保存 apiBase → 新会话的 systemPrompt 含该值(装配期消费);
4. `curl POST /api/sessions/:id/routes/report/summary` 返回 200(面6 独立可用);
5. LLM 调 `crm_query` → webext 富卡渲染(面5 bindings 锚点);
6. 未 trust / 验签失败时:路由 501、控件降级只读、面板仍可存取(降级矩阵)。

---

## 9. 安全与降级矩阵

| 面 | 信任要求 | 失败/缺失时行为 |
|---|---|---|
| routes | custom 模式 + trust(项目)| 501 `ROUTES_NOT_DECLARED` / 载入失败进 diagnostics |
| routes 单请求 | — | 超时 504;handler 抛错 500(消息脱敏,细节进 runner 日志) |
| settings schema | 清单/文件存在 | 无面板(不是错误);schema 非法 → diagnostics + 无面板 |
| settings 值 | 服务端按 schema 校验 | 400;secret 永不回读明文(掩码 + SecretWrite) |
| settingsWidgets | webext 全套(SRI+签名) | 字段降级只读 JSON 编辑 |
| 全部新面 | 安装车道时:白名单 + 管理员 + `--ignore-scripts` + 审计 | 既有治理管线,无新豁免 |

## 10. 分期路线

- **M1(routes 最小闭环)**:协议帧对 + runner 分发器 + builtin 转发路由 + defineRoutes +
  真实子进程集成测试。零协议包改动(帧走 raw-line 侧路),零前端改动。
- **M2(settings 主体)**:清单 settings 段 + 通用端点 + 动态面板登记 + 装配期注入
  `AgentContext.settings`。复用 FormSchema/校验器/面板注册表,新增 protocol 的清单 schema。
- **M3(咬合与动态)**:settingsWidgets capability + scoped field registry +
  `ext_settings_changed` 实时下发 + `examples/module-crm-agent` 全链路 e2e。
- **v2 展望**:source 作用域常驻路由(独立 service runner)、路由流式响应(需专用通道)、
  设置面板分组/多 Tab(global/project 双写,沿 sandbox 面板先例)。

## 11. 与现有代码的映射(改动落点)

| 落点 | 改动 |
|---|---|
| `packages/protocol/src/plugin/` | 🆕 清单 routes/settings 段 zod schema |
| `packages/agent-kit/src/routes.ts` | 🆕 defineRoutes + 类型(零运行时依赖) |
| `packages/server/src/runner/` | stdin 分发器挂路由表;装配期注入 `ctx.settings` |
| `packages/server/src/http/routes/` | 🆕 builtin `sessions/:id/routes/*` 转发路由 |
| `packages/server/src/plugin/resolve` | `PluginDescriptor` 加 routes/settings 切片 |
| `packages/server/src/config/` | 🆕 `/config/source/:sourceId` 端点(读写 + schema 下发) |
| `packages/react` | `useSourceSettings` / 动态面板登记 API |
| `packages/ui` | scoped field registry;通用 schema 表单已有,复用 |
| `packages/web-kit` | `settingsWidgets` capability(描述符 + 构建校验) |
| `lib/app/pi-handler.ts` | 装配注入(⚠️ 改后须重启 dev,handler 单例) |

已知坑对照(全部有既有先例可抄):stdout 直写 `fs.writeSync(1)`(state 桥)、
新端点不开顶层段(agent-sources 404 坑)、真实子进程集成测试(stub 盲区)、
`NEXT_PUBLIC_*` 构建期注入、改注入路由后重启 dev。

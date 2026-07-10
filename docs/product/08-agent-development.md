# 08 · 自定义 Agent 开发指南

本章说明如何从零编写一个可被 pi-web runner 载入的自定义 agent，覆盖入口契约、工具定义、模型继承、会话共享状态（`getSessionState`）、静态 slash 补全、声明式 HTTP routes、examples 目录索引和开发期热重载。

> **边学边跑**：本章每个关键概念都配有一个可运行示例，散落在仓库 `examples/` 下。推荐学习路径（从易到难）：`minimal-agent` → `hello-agent` → `builtin-tools-agent` → `state-bridge-agent` → `agent-routes-demo` → `server-driven-ui-agent`。各示例定位与跑法总索引见 [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md)，章末「示例索引（学习路径）」小节也有速查表。

---

## 核心概念

pi-web 的 agent 以**一个 TypeScript/JavaScript 文件**（`index.ts`）为载体，其 `default export` 必须是以下三种形态之一：

| 形态 | 说明 |
|------|------|
| (a) `AgentDefinition` 对象 | 最常见；`defineAgent({...})` 直接返回 |
| (b) `(ctx: AgentContext) => AgentDefinition \| Promise<AgentDefinition>` 工厂 | 需要读取运行时环境时使用 |
| (c) 带 `RUNTIME_FACTORY_BRAND` 标记的 `CreateAgentSessionRuntimeFactory` | 高级用法，绕过归一化层，自建运行时 |

Runner bootstrap（`packages/server/runner-bootstrap.mjs`）通过 jiti 载入 `index.ts`，经 `loadAgentDefinition`（`packages/server/src/runner/agent-loader.ts`）归一化为统一的运行时工厂，再调用 `createAgentSessionRuntime` 构建会话，最后进入 `runRpcMode` 持续处理 RPC 调用。

---

## `@blksails/pi-web-agent-kit`

包路径：`packages/agent-kit/src/index.ts`

`@blksails/pi-web-agent-kit` 是**零运行时强依赖**的轻量辅助包：

- **`defineAgent(def)`** — 恒等函数，仅用于编译期类型推断，运行时原样返回入参。不用此包写出的等价 `AgentDefinition` 对象同样能被 runner 载入。
- **`defineMinimalAgent(overrides?)`** — 在 `minimalAgentPreset`（`noTools: "all"` + 空 skills + `allowExtensions: []`）之上浅合并作者覆盖，一行得到零能力基线。
- **`emitUi(onUpdate, spec)`** — 在工具 `execute` 内发出 `UiSpec`，触发 server-driven UI 渲染（对应实践见 `examples/server-driven-ui-agent`）。
- 类型导出：`AgentDefinition`、`AgentContext`、`AgentModel`、`ToolDefinition`、`AgentRouteDecl`、`AgentRouteRequest`、`AttachmentToolContext` 等（均为纯类型，无值依赖）。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
```

---

## `AgentDefinition` 字段速查

来源：`packages/agent-kit/src/types.ts:110`

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | `AgentModel \| undefined` | 省略 → 继承 `~/.pi/agent/settings.json` 的 `defaultProvider/defaultModel` |
| `thinkingLevel` | `ThinkingLevel \| undefined` | 推理力度 |
| `systemPrompt` | `string \| (() => string) \| undefined` | 系统提示；可为惰性 thunk |
| `customTools` | `ToolDefinition[]` | 自定义工具列表 |
| `tools` | `string[]` | 内置/扩展工具名许可名单 |
| `excludeTools` | `string[]` | 工具排除名单（在 `tools` 之后应用） |
| `noTools` | `"all" \| "builtin"` | `"builtin"` 关闭内置工具集（保留 custom/extension）；`"all"` 全关 |
| `extensions` | `Array<string \| ExtensionFactory>` | 追加加载的扩展（路径或工厂） |
| `allowExtensions` | `string[] \| undefined` | 系统扩展许可名单；`[]` = 关闭所有磁盘发现的系统扩展 |
| `skills` | `SkillsOverride \| undefined` | 覆盖 hook，接收已发现的 skill 集并返回过滤后的集合 |
| `promptTemplates` | `PromptsOverride \| undefined` | 覆盖 hook |
| `contextFiles` | `AgentsFilesOverride \| undefined` | 覆盖 AGENTS.md/CLAUDE.md 发现结果 |
| `scopedModels` | `Array<{model, thinkingLevel?}>` | 运行时可切换的模型列表 |
| `slashCompletions` | `SlashCompletionDecl[] \| undefined` | 静态 slash 伪命令补全候选；选中仅填输入框、不执行（详见「静态 slash 补全」小节） |
| `routes` | `AgentRouteDecl[] \| undefined` | 声明式 HTTP routes；每条随会话挂载为 `GET·POST /api/sessions/:id/agent-routes/:name`（详见「声明式 HTTP routes」小节） |

> 三种工具姿态各有一个可跑示例对照：`noTools: "all"`（零能力基线）见 `examples/minimal-agent`；`noTools: "builtin"`（仅留自定义工具）见 `examples/hello-agent`；用 `tools` allowlist 显式启用 pi 内置文件系统/shell 工具集见 `examples/builtin-tools-agent`。

---

## 完整可运行范例

### hello-agent（推荐入门参考）

来源：`examples/hello-agent/index.ts`（同时是集成 / e2e 的目标 agent）

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

// 自定义工具：echo
const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: params.text }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的 defaultProvider/defaultModel
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  noTools: "builtin",          // 关闭内置工具集，仅保留 echo
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }), // 清空系统 skills
});
```

**关键要点：**

1. `defineTool` 来自 `@earendil-works/pi-coding-agent`，`Type` 来自 `@earendil-works/pi-ai`，runner 会通过 jiti alias 自动解析这两个包，无需在 agent 目录安装依赖。
2. `model` 字段省略时 runner 从 `~/.pi/agent/settings.json` 读取 `defaultProvider` 与 `defaultModel`，凭据从 `~/.pi/agent/auth.json` 解析，开箱即用于任意 pi 账号。
3. 如需固定模型，添加 `model: { provider: "anthropic", modelId: "claude-opus-4-5" }`，但对应 provider 必须有有效凭据。

### 最小基线（defineMinimalAgent）

来源：`examples/minimal-agent/index.ts`

```ts
import { defineMinimalAgent } from "@blksails/pi-web-agent-kit";

export default defineMinimalAgent({
  // model 省略 → 继承配置
  systemPrompt: "You are minimal-agent, a zero-capability pi-web baseline example.",
  // noTools: "all" + 空 skills + allowExtensions: [] 由 preset 提供，无需重复声明
});
```

### 工厂形态（shape b）

当 agent 需要读取运行时环境（如 `cwd`、`env`）时，使用工厂函数：

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentContext } from "@blksails/pi-web-agent-kit";

export default async function (ctx: AgentContext) {
  const apiKey = ctx.env["MY_API_KEY"];
  return defineAgent({
    systemPrompt: `Working directory: ${ctx.cwd}`,
    customTools: apiKey ? [buildMyTool(apiKey)] : [],
  });
}
```

`AgentContext` 提供：
- `ctx.cwd` — runner 的有效工作目录
- `ctx.agentDir` — 全局 agent 配置目录（通常 `~/.pi/agent`）
- `ctx.env` — 进程环境快照

---

## 会话共享状态：`getSessionState()`（作者面）

来源：`packages/tool-kit/src/session-state.ts:61`

agent 工具需要在**人机之间共读写一份会话级状态**（例如一个计数器、一个当前选中项）时，用 `getSessionState()`。它是「状态注入桥（state-injection-bridge）」的作者侧接入点：权威 KV 存在 runner **子进程**里，由 pi-web 的 `wireStateBridge` 自建并挂到约定的 globalThis seam；工具内读写零跨进程、立即生效，写入会经下行 `control:"state"` 帧实时镜像到 UI（在 LLM context 之外，不进对话历史）。

**授权与可用性语义**（务必按此使用）：

- `getSessionState()` **只在 agent 工具 `execute` 内调用**才有意义——此时代码跑在 runner 子进程里，seam 已被 `wireStateBridge` 装配。
- seam 不可用时（不是子进程 / 桥未装配 / 前端环境）返回 `available: false` 的降级视图：`get` 返回 `undefined`、`set`/`delete` 为 no-op，**绝不抛错**。因此工具应先判 `available` 再决定行为，而非假设状态一定可写。
- 纯 globalThis 读取，无 pi SDK / Node 依赖，前端安全（浏览器侧恒降级）。

`SessionStateAccess` 接口（`session-state.ts:18`）：`available` / `get<T>(key)` / `set(key, value)` / `delete(key)` / `snapshot()`。

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { getSessionState } from "@blksails/pi-web-tool-kit";

// increment：读 count → +1 → 写回 → 返回新值；写入实时镜像到 UI
const increment = defineTool({
  name: "increment",
  label: "Increment State",
  description: "Bump a shared counter and return the new value.",
  parameters: Type.Object({
    key: Type.Optional(Type.String({ description: "状态 key（默认 'count'）。" })),
  }),
  async execute(_id, params) {
    const state = getSessionState();
    if (!state.available) {
      return { content: [{ type: "text", text: "Shared state unavailable." }], details: { ok: false } };
    }
    const key = params.key ?? "count";
    const next = (typeof state.get<number>(key) === "number" ? state.get<number>(key)! : 0) + 1;
    state.set(key, next);
    return { content: [{ type: "text", text: `${key} = ${next}` }], details: { ok: true, key, value: next } };
  },
});
```

> `getSessionState` 从 `@blksails/pi-web-tool-kit` 主入口导出（纯 globalThis 读取，前端安全，无 pi SDK 值依赖）。canonical 双端范例见 `examples/state-bridge-agent`：AI 侧 `increment`/`read_state` 工具 + 人侧 `.pi/web` 用 `useExtensionState("count")` 渲染并写回，两端读写同一份实时状态。该范例的工具刻意内联 seam 读取（不 import tool-kit）以保持 hermetic，与上面用 `getSessionState()` 的等价写法可任选其一。
>
> 状态注入桥的整体架构（子进程权威、`control:"state"` 下行镜像、`rev` 单调号）见 [04 · Surface 权威表面栈](04-surface-stack.md)；人侧写回端点 `POST /api/sessions/:id/state` 见 [24 · HTTP API 参考](24-http-api-reference.md)。

---

## 静态 slash 补全（`slashCompletions`）

来源：字段类型 `packages/agent-kit/src/types.ts:162`；协议 schema `packages/protocol/src/transport/slash-completion.ts:16`

agent 可声明一组**静态 slash 伪命令补全候选**，让用户在输入框敲 `/` 时看到本 agent 专属的提示。关键语义：这些候选**只是补全项，选中后仅把 `insertText` 填入输入框、并不执行任何命令**——填入的文本作为一条普通消息发送，由 LLM 按系统提示解读。它不同于 `pi.registerCommand` 注册的可执行命令。

`SlashCompletionDecl`（纯数据，前端安全）：

- `name` — 命令名（无前导 `/`），如 `"img-gen"`。
- `description?` — 补全浮层的副文本。
- `insertText?` — 选中后填入输入框的文本；缺省由消费方按 `"/" + name + " "` 推导。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt:
    "When the user sends '/img-gen <描述>', treat it as a request to generate an image.",
  slashCompletions: [
    { name: "img-gen", description: "用提示词生成图像", insertText: "/img-gen " },
    { name: "img-edit", description: "编辑最近上传的图像", insertText: "/img-edit " },
  ],
});
```

**端到端链路**（声明 → 装配期帧 → 命令面板）：

1. 声明在 `AgentDefinition.slashCompletions`（纯数据，无函数、无 pi SDK 导入）。
2. runner 装配期（`runRpcMode` 之前）由子进程经 stdout 推出一次性 `slash_completions` 帧（与 `ui_rpc_response` 同性质的 pi-web 自建 JSONL 帧）；server 按会话缓存。
3. 前端 `/` 补全把这些候选并入命令面板；用户选中 → 仅填输入框 → 作为普通消息发送。

> 真实数据范例：`aigcSlashCompletions`（`packages/tool-kit/src/aigc/slash-completions.ts:12`）就是 AIGC 扩展声明的 `/img-gen`、`/img-edit` 两个候选，`examples/aigc-agent` 经 `import { aigcSlashCompletions }` 挂载。之所以能「选中即填入而非执行」，是因为真实图像工具是 `image_generation` / `image_edit`（LLM 调用），slash 候选只是把请求措辞塞进输入框交给模型。

---

## 声明式 HTTP routes（`AgentDefinition.routes`）

来源：`packages/agent-kit/src/types.ts:85`（`AgentRouteDecl`）、`:57`（`AgentRouteRequest`）

agent 可以在定义中声明具名 HTTP routes：会话创建后，每条 route 自动成为该会话命名空间下的端点 `GET·POST /api/sessions/:id/agent-routes/:name`，外部系统（curl / webhook / 第三方服务）无需订阅 SSE 流即可同步调用 agent 能力——**声明即生效，零宿主侧配置**。不声明 `routes` 的 agent 完全不受此特性影响。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentRouteRequest } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  routes: [
    {
      name: "gallery-stats",        // 必填：小写字母/数字/连字符，定义内唯一
      // methods 缺省 → ["GET"]（主用例是只读查询）；可声明 ["GET", "POST"]
      description: "画廊统计",       // 可选：出现在 route 清单端点的投影里
      handler: async (req: AgentRouteRequest) => {
        // req: { name, method: "GET" | "POST", query: Record<string, string>, body?: unknown }
        return { ok: true, echo: req.query };  // 返回值须 JSON 可序列化 → 即 HTTP 响应体
      },
    },
  ],
});
```

**handler 契约**（`AgentRouteHandler`，`packages/agent-kit/src/types.ts:77`）：

- 入参 `AgentRouteRequest`：`name`（被调 route 名）、`method`（`"GET" | "POST"`）、`query`（拍平为单值字符串的查询参数）、`body`（POST 携带的已解析 JSON，可缺省；GET 调用恒无 body）。
- 返回值（可 async）**必须 JSON 可序列化**，原样成为 HTTP 响应体；handler 抛错 → 调用方收到 502。
- handler **只在 agent 子进程内执行**，函数本体从不跨进程；主进程只拿到 `name` / `methods` / `description` 纯数据投影（底层是装配期声明帧 + 专用请求/结果帧，骑既有 stdin/stdout JSONL 通道）。

**装配期校验**（由装配层执行，违规 → 会话创建失败）：

- `name` 非空，仅小写字母/数字/连字符（`^[a-z0-9][a-z0-9-]*$`），同一定义内唯一。
- `methods` 仅允许 `"GET"` / `"POST"`；缺省为 `["GET"]`。

**调用语义**（关键几条，完整错误码表 / 超时·体积上限 env / curl 请求样例见 [24 · HTTP API 参考](24-http-api-reference.md)）：

- 调用**不触发 LLM 推理、不进对话历史、不产生任何 UI 变化**；会话推理进行中（busy）照常受理。
- handler 只能经声明绑定被调用——未声明的名字 → 404；端点复用既有会话鉴权门（401/403 / 会话 404）。
- 运维可整体关断、并调节转发超时与 POST 体积上限（`PI_WEB_AGENT_ROUTES_DISABLED` / `PI_WEB_AGENT_ROUTE_TIMEOUT_MS` / `PI_WEB_AGENT_ROUTE_BODY_LIMIT`，默认值与行为在 24 章列全）。

### 声明式路由的文件组织

routes 增多后全塞 `index.ts` 会臃肿。约定：

- **1 个路由**：内联在 `index.ts` 即可，不必过度拆分。
- **≥2 个路由，或 handler 变复杂**：抽到 `routes/` 子目录。
  - **一路由一文件**：`routes/<route-name>.ts`，文件名 **=== 路由 `name`（kebab-case）=== URL 段**，`/agent-routes/ping` 一眼对到 `routes/ping.ts`。
  - 每个路由文件 **co-locate** handler + 它的 `AgentRouteDecl`：handler 单独 `export`（便于单测），decl 导出（命名 `<camelName>Route`）给 barrel 汇总。
  - `routes/index.ts` 作 **barrel**，按稳定顺序汇成 `AgentRouteDecl[]`。
  - `index.ts` 只 `import { routes } from "./routes/index.js"` 传给 `defineAgent`，不放 handler 逻辑。
  - agent 源经 jiti 加载（NodeNext），相对导入带 `.js` 后缀。

canonical 多路由范例：`examples/agent-routes-demo`（`ping` / `echo` / `whoami` 三路由）。

```
examples/agent-routes-demo/
├── index.ts               # defineAgent；import { routes } from "./routes/index.js"，无 handler 逻辑
├── routes/
│   ├── index.ts           # barrel：export const routes = [pingRoute, echoRoute, whoamiRoute]
│   ├── ping.ts            # pingHandler + pingRoute
│   ├── echo.ts            # echoHandler + echoRoute（GET·POST）
│   └── whoami.ts          # whoamiHandler + whoamiRoute
├── package.json
└── README.md
```

```ts
// routes/ping.ts —— 一路由一文件，handler + decl co-locate
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

export function pingHandler(): unknown {
  return { pong: true };
}

export const pingRoute: AgentRouteDecl = {
  name: "ping",                          // === 文件名 === URL 段
  description: "探活：返回 { pong: true }",
  handler: pingHandler,
};

// routes/index.ts —— barrel
import { pingRoute } from "./ping.js";
import { echoRoute } from "./echo.js";
import { whoamiRoute } from "./whoami.js";
export const routes: AgentRouteDecl[] = [pingRoute, echoRoute, whoamiRoute];

// index.ts —— 只汇总
import { routes } from "./routes/index.js";
export default defineAgent({ /* … */ routes });
```

**试一下**：以本目录为 agent source 启动会话后（`pi-web ./examples/agent-routes-demo`），拿到会话 id，直接 HTTP 调用（无需订阅 SSE）：

```bash
# 探活
curl http://127.0.0.1:3000/api/sessions/<id>/agent-routes/ping
# → {"pong":true}

# 回显 query
curl "http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo?foo=bar"
# → {"method":"GET","query":{"foo":"bar"},"body":null}

# 回显 POST body
curl -X POST http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo \
  -H 'content-type: application/json' -d '{"hello":"world"}'
# → {"method":"POST","query":{},"body":{"hello":"world"}}
```

收益：`index.ts` 只讲「这个 agent 是什么」；每条路由的逻辑/文档/类型集中在同名文件、可独立单测；URL ↔ 文件一一对应。

---

## Surface 权威表面：一句指路

如果 agent 要维护一份**领域权威状态**（如 Canvas 的画布/画廊），并让前端以「命令上行 + 状态快照下行」的 CQRS 单写者方式消费，作者侧接入点是 `createSurface`（`packages/tool-kit/src/surface/create-surface.ts`，以 `ExtensionFactory` 形态装载）。它与本章的 `getSessionState`（无结构的会话 KV）不同：surface 是按 domain 建的权威投影 + 结构化命令转发（不过 LLM）。完整概念、`createSurface`/`useSurface`/`wireSurfaceBridge` API 与 Canvas 端到端实例见 [04 · Surface 权威表面栈](04-surface-stack.md)；作者面范例 `examples/surface-demo-agent`。

---

## examples/ 目录索引

仓库路径：`examples/`（总索引与各示例跑法见 [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md)）

| 子目录 | 一句话说明 |
|--------|-----------|
| `hello-agent` | 最小完整范例：自定义 `echo` 工具 + 系统提示，关闭内置工具集 |
| `minimal-agent` | 零能力基线：`defineMinimalAgent` preset，noTools/skills/extensions 全关 |
| `builtin-tools-agent` | 启用 pi 内置工具集（与 hello-agent 的 `noTools: "builtin"` 相反的姿态） |
| `state-bridge-agent` | 会话共享状态双端范例：AI 侧 `increment`/`read_state` 工具 + 人侧 `.pi/web` 写回同一份实时状态 |
| `agent-routes-demo` | 声明式 HTTP routes 多路由范例：`routes/` 子目录一路由一文件（`ping`/`echo`/`whoami`），可直接 curl |
| `aigc-agent` | 装配 `extensions: [aigcExtension, visionExtension]`（`image_generation` / `image_edit` / `image_vision`），演示 AIGC + 视觉 + 附件接缝 |
| `vision-agent` | 视觉识别专题：`image_vision` 工具 + `/img_vision` 命令 |
| `attachment-tool-agent` | 演示 attachment-tool-bridge：自定义图像工具经 `AttachmentToolContext` 将产物落 attachment store |
| `file-session-agent` | 配合文件存储会话演示的最小 agent（session 存储是运行时配置，不在 AgentDefinition 中） |
| `pi-probe-agent` | 探针 agent，用于验证 `.pi/` 项目级资源（extensions/skills）被正确发现和加载 |
| `surface-demo-agent` | Surface 权威表面作者面范例（`createSurface`，详见 04 章） |
| `server-driven-ui-agent` | 在工具 `execute` 内调用 `emitUi(onUpdate, spec)` 发出 `UiSpec`，前端零配置渲染 |
| `system-status-agent` | 组合 server-driven UI + ambient 状态/通知，一个工具同时演示两条链路 |
| `ui-demo-agent` | 演示 extension UI 全部交互 surface（`ctx.ui.*`：状态推送、ambient 通知等） |
| `webext-*`（一组） | `.pi/web` WebExtension Tier 1–5 各层示例（背景/区域插槽/渲染器/贡献点/artifact/声明式/运行时代码），详见 [12 · Web UI 扩展](12-web-ui-extension.md) |

### 学习路径（从易到难）

下表把上面「自定义 agent 开发」涉及的核心概念串成一条由浅入深的实践路线，逐个对应一个可跑示例。建议按顺序跑通：

| 顺序 | 示例 | 你将学到的概念 | 对应本章小节 |
|------|------|---------------|-------------|
| 1 | `examples/minimal-agent` | `defineMinimalAgent` preset / `noTools: "all"` 零能力基线 | 核心概念、最小基线 |
| 2 | `examples/hello-agent` | 自定义 `defineTool` + `systemPrompt`，`noTools: "builtin"`（e2e 目标） | hello-agent 范例 |
| 3 | `examples/builtin-tools-agent` | 用 `tools` allowlist 启用 pi 内置文件系统/shell 工具集 | `noTools` / `tools` 字段 |
| 4 | `examples/state-bridge-agent` | `getSessionState()` 读写会话共享状态（人机共驾） | 会话共享状态 |
| 5 | `examples/agent-routes-demo` | `routes` 声明式 HTTP 端点 + `routes/` 文件组织 | 声明式 HTTP routes |
| 6 | `examples/server-driven-ui-agent` | `emitUi(onUpdate, spec)` 发 `data-pi-ui`，前端零配置渲染 | `emitUi` |

> 上表是「自定义 agent 开发」主线的推荐顺序；`aigc-agent`、`vision-agent`、`attachment-tool-agent`、`surface-demo-agent` 与 `webext-*` 系列属于专题方向，分别详见 [11 · AIGC 与视觉工具](11-aigc-and-vision-tools.md)、[09 · 附件系统](09-attachment-system.md)、[04 · Surface 权威表面栈](04-surface-stack.md) 与 [12 · Web UI 扩展](12-web-ui-extension.md)。完整清单与各自跑法见 [`examples/README.md`](https://github.com/blksails/pi-web/blob/main/examples/README.md)。

---

## 开发期热重载

**背景**：runner 是 per-session 常驻子进程，经 jiti 在进程内只 import 一次 agent 入口。修改 `packages/tool-kit/src` 后，已存在会话的 runner 仍跑旧代码，需开新会话才生效。

**启用方式**：

```bash
# 开发模式下开启热重载
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

或通过 CLI 的 `--watch` 标志（任何环境均可，不受 `NODE_ENV` 门控）。注意二者监视目标不同：`PI_RUNNER_HOT_RELOAD=1` 默认监视 `packages/tool-kit/src`（适合改工具源码），而 `--watch <source>` 注入 `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>`，监视的是你传入的 agent source 目录（适合改 agent 自身的 `index.ts`；git 来源无本地目录会跳过监视）：

```bash
pi-web --watch /path/to/my-agent
```

**机制**（来源：`packages/server/src/rpc-channel/hot-reload.ts:24`、`bin/pi-web.mjs:138`）：

1. `isHotReloadEnabled()` 检查 `PI_WEB_WATCH=1`（`--watch` 注入）或 `NODE_ENV !== production && PI_RUNNER_HOT_RELOAD=1`。
2. 启用后，`registerForHotReload(target)` 监视目录：默认 `packages/tool-kit/src`，可经 `PI_RUNNER_HOT_RELOAD_PATHS` 覆盖（`--watch` 即以此把目标改为 agent source 目录）；防抖 200 ms，仅响应 `.ts/.tsx/.js/.mjs/.cjs/.json` 变更。
3. 源码变更时对所有已注册的 `PiRpcProcess` 调用 `requestRestart()`，runner 在**空闲时**（无待决命令）重启子进程。
4. 新进程全新 jiti 实例重读源码；会话 id 经 `spawnSpec` 复用，新 runner 从持久化 jsonl **续上对话**，无需用户重新开始会话。

**自定义监视目录**：

```bash
PI_RUNNER_HOT_RELOAD=1 \
PI_RUNNER_HOT_RELOAD_PATHS=/abs/path/to/my-tools,/abs/path/to/another-dir \
pnpm dev
```

`PI_RUNNER_HOT_RELOAD_PATHS` 接受逗号分隔的绝对路径列表，覆盖默认的 `packages/tool-kit/src`。

---

## Bootstrap 流程

```
pi-web 后端进程
  └─ spawn node runner-bootstrap.mjs
       --agent <entry>  --cwd <work>  [--agent-dir <dir>]  [--session-id <id>]
         │
         ├─ createJiti(here)              # jiti 根锚定在 @blksails/pi-web-server 包目录
         ├─ jiti.import("src/runner/runner.ts")
         └─ runner.ts: main(argv)
              ├─ parseRunnerArgs(argv)    # 解析 --agent / --cwd / --agent-dir 等
              ├─ loadAgentDefinition(agent, ctx, trust)
              │    ├─ jiti.import(agentPath)  # 载入 index.ts（形态 a/b/c）
              │    └─ buildRuntimeFactory(def) # 归一化为统一运行时工厂
              ├─ createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})
              ├─ wireAttachmentBridge(runtime)  # attachment-tool-bridge 装配
              ├─ wireStateBridge(runtime)       # 会话共享状态桥装配（getSessionState seam）
              ├─ wireSurfaceBridge(runtime)     # Surface 权威表面桥装配（见 04 章）
              └─ runRpcMode(runtime)       # 进入 RPC 循环，永不返回
```

关键源文件：

- `packages/server/runner-bootstrap.mjs` — 启动器，纯 ESM，无需 jiti 启动自身
- `packages/server/src/runner/runner.ts` — `main()` / `startRunner()` / `parseRunnerArgs()`
- `packages/server/src/runner/agent-loader.ts` — `loadAgentDefinition()`，三种形态归一化
- `packages/server/src/runner/option-mapper.ts` — `buildRuntimeFactory()`，`AgentDefinition` → SDK 调用

---

## 开发步骤

从空目录到跑通一个自定义 agent，端到端如下。每步都给出预期结果，便于独立验证。若想直接照着可跑的最小工程起步，先看 `examples/minimal-agent`（零能力基线）或 `examples/hello-agent`（带一个自定义工具）。

1. **创建 agent 目录**，在其中新建 `index.ts`：

   ```bash
   mkdir -p /path/to/my-agent
   ```

2. **声明 `AgentDefinition`**，至少提供 `systemPrompt`：

   ```ts
   // /path/to/my-agent/index.ts
   import { defineAgent } from "@blksails/pi-web-agent-kit";
   export default defineAgent({
     systemPrompt: "You are my custom agent.",
   });
   ```

   省略 `model` 时继承 `~/.pi/agent/settings.json` 的默认 provider/model，凭据由 `~/.pi/agent/auth.json` 解析——只要本机已登录 pi，无需额外配置。

3. **启动 pi-web 指向该目录**，最简方式是 CLI（`PI_WEB_AUTOSTART=1` 会直接进会话、跳过选源页）：

   ```bash
   pi-web /path/to/my-agent
   ```

   **预期结果**：终端打印就绪日志后自动打开浏览器，进入对话页；输入一句话能收到模型回复。也可在 pi-web 界面的选源页手动指向该目录。

4. **添加自定义工具**：使用 `defineTool`（`@earendil-works/pi-coding-agent`）+ `Type`（`@earendil-works/pi-ai`），加入 `customTools` 数组（写法见上文 hello-agent 范例）。
   **验证**：重开会话后向 agent 提需要该工具的问题，工具气泡出现即生效。
5. **调整工具开关**：
   - `noTools: "builtin"` — 关闭内置工具，只保留 `customTools` 和 `.pi/extensions` 工具。
   - `noTools: "all"` — 全关，等价于 `minimalAgentPreset` 的工具姿态。
   - 省略 `noTools` — 保持默认内置工具集。
6. **（可选）声明扩展面**：需要 HTTP 端点用 `routes`（见「声明式 HTTP routes」），需要 `/` 补全提示用 `slashCompletions`，需要人机共享状态在工具内用 `getSessionState()`。
7. **开启热重载**（修改 tool-kit 源码时）：设置 `PI_RUNNER_HOT_RELOAD=1`；改 agent 自身 `index.ts` 则用 `pi-web --watch /path/to/my-agent`。改动会在 runner 空闲时自动重启并续上会话，无需手动开新会话。

**常见报错对策**：

| 现象 | 多半原因 | 对策 |
|------|---------|------|
| `module has no default export` | `index.ts` 没有 `export default` 或导出了仅命名导出 | 确认默认导出是 `AgentDefinition` 对象 / 工厂 / 带 brand 的工厂 |
| 模型调用 401 / 鉴权失败 | 显式 `model` 指定的 provider 无有效凭据 | 删掉 `model` 改用默认，或补好该 provider 的 auth，详见 [23 · 故障排查 §2.1](23-troubleshooting-faq.md) |
| 改了代码不生效 | runner 是常驻子进程、只 import 一次 | 开热重载（见步骤 7）或手动开新会话 |
| `getSessionState().available === false` | 在子进程/桥装配之外调用，或在前端调用 | 只在工具 `execute` 内调用；前端读状态用 `useExtensionState` |

更多排查见 [23 · 故障排查 FAQ](23-troubleshooting-faq.md)。

---

## 相关链接

- [02 · 核心概念](02-core-concepts.md) — AgentDefinition、runner、会话模型
- [03 · 架构](03-architecture.md) — runner 子进程隔离与 RPC 通道
- [04 · Surface 权威表面栈](04-surface-stack.md) — `createSurface` / `getSessionState` 状态桥的整体架构与 Canvas 实例
- [10 · 扩展与 Skills](10-extensions-and-skills.md) — `extensions` / `allowExtensions` / `skills` 字段详解
- [11 · AIGC 与视觉工具](11-aigc-and-vision-tools.md) — `aigcExtension` / `visionExtension` 与 aigc-agent 接入范式
- [12 · Web UI 扩展（WebExtension）](12-web-ui-extension.md) — `.pi/web` Tier 1–5 UI 扩展体系
- [09 · 附件系统](09-attachment-system.md) — `AttachmentToolContext` 与 attachment-tool-bridge
- [18 · CLI](18-cli.md) — `pi-web --watch` 与命令行参数
- [24 · HTTP API 参考](24-http-api-reference.md) — agent-routes 调用面、错误码/env、`POST /sessions/:id/state` 写回端点
- [23 · 故障排查 FAQ](23-troubleshooting-faq.md) — agent 载入失败、provider 鉴权、热重载不生效等对策

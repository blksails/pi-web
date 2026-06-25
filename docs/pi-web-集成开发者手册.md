# pi-web 集成方开发者技术手册

> 面向用 pi-web 搭聊天产品 / 集成后端 / 写 agent source 扩展的开发者。
> 技术细节提炼自 `.kiro/specs/` 全部 37 个 spec 的 `design.md`；凡 design 未写明处标注「(design 未明确)」。
> 配套导览索引见 [`specs-guide.md`](./specs-guide.md)。
> 生成日期：2026-06-24

---

## 目录

1. [概述与架构](#1-概述与架构)
2. [核心契约（protocol）](#2-核心契约protocol)
3. [后端集成](#3-后端集成)
4. [写一个 agent source](#4-写一个-agent-source)
5. [会话持久化与恢复](#5-会话持久化与恢复)
6. [前端集成（React / UI）](#6-前端集成react--ui)
7. [四维可定制契约](#7-四维可定制契约)
8. [WebExtension 扩展开发（5 Tier）](#8-webextension-扩展开发5-tier)
9. [扩展管理与环境 UI](#9-扩展管理与环境-ui)
10. [配置 UI / Schema 表单](#10-配置-ui--schema-表单)
11. [触发符补全框架](#11-触发符补全框架)
12. [附件系统](#12-附件系统)
13. [AIGC 工具](#13-aigc-工具)
14. [附录 A：环境变量总表](#附录-a环境变量总表)
15. [附录 B：HTTP 路由总表](#附录-bhttp-路由总表)
16. [附录 C：data-* 钩子总表](#附录-cdata-钩子总表)

---

## 1. 概述与架构

pi-web 是一套把 pi coding agent 包装成可嵌入 Web 聊天产品的全栈框架。它以 **零依赖同构协议包**为契约根，自底向上分层装配，每层只向下依赖、对上提供稳定接口。

### 1.1 分层架构与依赖流向

```
契约根         @blksails/pi-web-protocol(唯一类型源) · PiRpcChannel(传输无关 RPC)
   ↓
后端引擎       agent-source-resolver → agent-runner → session-engine(SessionManager/PiSession)
              ├ session-store-adapters(可插拔事件存储) / session-persistence-url-resume
              └ http-api(createPiWebHandler:REST + SSE 对外面)
   ↓
整站装配       app-shell(Next.js 应用,catch-all 路由 + globalThis 单例 handler)
   ↓
React 层       @blksails/pi-web-react(headless:transport/hooks/client)
              → @blksails/pi-web-ui(有样式组件 + 渲染器注册表 + 四维定制)
   ↓
交互富化       工具卡 / 命令面板 / 错误显示 / 用量条 / server-driven UI / 空态
   ↘
扩展体系       WebExtension(5 Tier UI 控制层) · 扩展管理 · 环境 UI · 内联交互
   ↘
横切能力       配置 UI · 补全框架 · 附件系统 · AIGC 工具 · agent 预设
```

### 1.2 npm 包清单

| 包 | 职责 | 集成方是否直接用 |
|---|---|---|
| `@blksails/pi-web-protocol` | 唯一契约根：zod schema + 推导类型，零运行时依赖、同构 | 间接（`import type`） |
| `@blksails/pi-web-server` | 后端引擎：会话、RPC、http-api、store、补全、附件 | 是（后端挂载） |
| `@blksails/pi-web-react` | headless React 层：transport + hooks + REST 客户端 | 是（前端） |
| `@blksails/pi-web-ui` | 有样式组件：`<PiChat>`、注册表、定制契约 | 是（前端） |
| `@blksails/pi-web-ui/tailwind-preset` | `piWebPreset`，一行接入主题 | 是 |
| `@blksails/pi-web-agent-kit` | 写 agent 的类型/数据声明包（零运行时依赖） | 是（agent 作者） |
| `@blksails/pi-web-kit` | 写 `.pi/web` WebExtension 的作者 SDK + `pi-web` 构建 CLI | 是（扩展作者） |
| `@blksails/pi-web-tool-kit` | AIGC 工具引擎（声明层主入口 + `/runtime` node 入口） | 是（工具作者） |

> 注：后端模块路径在不同 spec 间混用早期的 `lib/pi/...` 与后期的 `packages/server/src/...`，发布包名以 `@blksails/pi-web-server` 为准。

### 1.3 三条集成路径速览

- **最小集成**：`createPiWebHandler({manager, store})` 挂后端 catch-all 路由 → 前端 `usePiSession` → `<PiChat session controls extensionUI />`。
- **富版**：前端换 `<PiChat showControls>` / 富元件（附件、模型选择器、命令面板、用量条）。
- **自定义/扩展**：写 agent source（`@blksails/pi-web-agent-kit`）+ `.pi/web` WebExtension（`@blksails/pi-web-kit`，5 Tier）定制宿主 UI。

### 1.4 运行时硬约束

- **必须 Node 长驻进程**（≥ 22.19）：会话靠子进程 + SSE 长连接 + `globalThis` 单例 handler 跨请求驻留。**Edge / Serverless 会失效**。
- **反向代理需关缓冲、禁压缩**：响应已带 `X-Accel-Buffering: no`、`Cache-Control: no-cache`。
- **凭据纪律**：provider key / `SpawnSpec.env` 只透传，不日志、不入错误体、不回显前端。

---

## 2. 核心契约（protocol）

`@blksails/pi-web-protocol` 是全项目唯一契约根：以 **zod schema 为单一事实来源**，静态类型全部 `z.infer` 推导，下游一律 `import type`、不重定义。所有 DTO / SSE 帧 / Agent 事件 / `SpawnSpec` 形状只在此包。

### 2.1 三组关键 schema

- **pi 原生派生（`rpc/`）**：`AgentEventSchema`（以 `type` 判别的可辨识联合，覆盖 `agent_start`/`agent_end`/`turn_end`/`message_update`（text/thinking start·delta·end）/`tool_execution_start|update|end`/`compaction_*`/`auto_retry_*`/`queue_update`/`extension_ui_request`）、`RpcCommandSchema`、`RpcResponseSchema`、`Model`、`AgentMessage`。对齐 `pi 0.79.x`。
- **pi-web 自定义传输层（`transport/`）**：`SseFrameSchema`（顶层以 `kind` 判别 `uiMessageChunk` | `control`，携 `protocolVersion`）、`UiMessageChunkSchema`、`DataPartSchema`（`data-pi-queue`/`data-pi-compaction`/`data-pi-auto-retry`/`data-pi-ui`）、`RestDtoSchema` 系列、`SpawnSpecSchema`。
- **`SpawnSpec`** = `{ cmd, args, cwd, env }`（四字段全必填），resolver 产出、rpc-channel 消费。**与 REST 入参 `CreateSessionRequest { source, cwd?, model?, env? }` 是不同契约，不可混用**。

### 2.2 协议版本协商

`protocolVersion`（SemVer 常量）承载于每个 SSE 帧与 REST 响应头/体，用于前后端握手。不兼容时 `@blksails/pi-web-react` 抛 `PiProtocolVersionError`。下游在信任边界（RPC 入站、SSE 出站、REST 入参）用 `safeParse` 校验，失败返回 `{success:false, error.issues[].path}` 定位字段。

### 2.3 两个易混的 store 接口

| 接口 | 职责 | 归属 spec | 位置 |
|---|---|---|---|
| `SessionStore` | 进程内**活跃 PiSession 注册表**（create/get/delete/list） | session-engine | `lib/pi/session/` |
| `SessionEntryStore` | **会话事件持久化**（append-only 事件树，fs/sqlite/pg） | session-store-adapters | `packages/server/src/session-store/` |

**集成时勿混淆**：前者管内存中活跃会话，后者管落盘历史。

**关键文件**：`packages/protocol/src/{index,version}.ts`、`rpc/*.ts`、`transport/*.ts`。

---

## 3. 后端集成

### 3.1 单一挂载点：createPiWebHandler

```typescript
function createPiWebHandler(opts: PiWebHandlerOptions): PiWebHandler;  // = (req: Request) => Promise<Response>
interface PiWebHandlerOptions {
  manager: SessionManager;       // 必填
  store: SessionStore;           // 必填
  authResolver?: (req) => Promise<AuthContext | {reject:401}>;   // 默认放行
  authorizeSession?: (input) => Promise<boolean>;                // 默认放行
  routes?: { method; path; handler: RouteHandler }[];            // 外部路由注入（内置端点优先，不可遮蔽）
  sse?: { heartbeatMs?; basePath? };                             // basePath 如 "/api"
}
```

返回标准 Web Fetch handler，框架无关。完整 REST + SSE 路由见[附录 B](#附录-bhttp-路由总表)。

**双连接模型**：命令端点（POST）只触发命令、立即返回 ack；所有增量走已建立的 `GET /sessions/:id/stream` SSE 长连接。两者是独立连接。

**错误码映射**（`error-map.ts`）：`SessionStoppedError`→409、`SessionNotFoundError`→404、`MissingInputError`→400、停机期新建→503、版本不兼容→426/400、未预期→500（不泄露凭据）。SSE 断线重连用 `Last-Event-ID` 定位续推。

### 3.2 宿主挂载示例

- **Next.js**：`app/api/[...path]/route.ts` 导出 `GET/POST/DELETE = handler`，`runtime="nodejs"`、`dynamic="force-dynamic"`。
- **Hono**：`app.all('*', c => handler(c.req.raw))`。
- **Express**：经 Web-Fetch adapter。

app-shell 的做法：`lib/app/pi-handler.ts` 的 `getHandler()` 组装依赖 + `loadConfig()`，构造一次 handler 并挂 `globalThis` 具名键，跨请求/热重载驻留（catch-all 路由薄转发，含 SSE body 原样回传）。

### 3.3 会话引擎（session-engine）

```typescript
interface SessionManager {
  createSession(input: CreateSessionInput): { sessionId; session: PiSession };  // {resolved, channel, idleMs?}
  shutdown(): Promise<void>;
}
interface PiSession {
  readonly id; mode; trust; status;                  // active | stopping | stopped
  subscribe(onFrame, onEnd?): SubscribeHandle;       // 多订阅者按到达序同步广播
  prompt/steer/followUp/abort/setModel/cycleModel/getAvailableModels/
    setThinkingLevel/getState/getMessages/getSessionStats/getCommands(...): Promise<RpcResponse>;
  respondExtensionUI(id, response): void; stop(reason?): Promise<void>;  // stop 幂等
}
```

**核心数据流**：`createSession` → `new PiSession` 订阅通道 `onEvent` → 每个 `AgentEvent` 经**纯函数** `translateEvent(event, ctx)` 翻译为 AI SDK v5 UIMessage 帧（`SseFrame`）→ 内部 EventEmitter 按序广播给所有订阅者。

**事件→帧映射要点**：`agent_start`→`start`+`start-step`；text/thinking → text/reasoning 帧；`tool_execution_start`→`tool-input-available`，`_update`→`tool-output-available`（`preliminary=true`，累积 `partialResult`），`_end`→`tool-output-available`（result/isError）；`turn_end`→`finish-step`；`agent_end`→`finish`；`extension_ui_request`→`control: extension-ui` **旁路帧**（非 UIMessage，前端单独处理并经 `respondExtensionUI` 回写）。

**生命周期**：`active→stopping→stopped`，三触发路径（显式 stop / idle 超时 / 子进程 crash）汇入统一清理，幂等。

**主扩展点**：`SessionStore` 接口外置（可换 Redis/Durable Object）；`PiRpcChannel` / `ResolvedSource` 构造期注入。

### 3.4 RPC 通道（rpc-channel）

后端与 agent 子进程间唯一双向 JSONL 通道。端口 `PiRpcChannel`（`send`/`onLine`/`close`/`health`）+ 本地实现 `PiRpcProcess`（构造接 `SpawnSpec`，含 18 个对齐命令方法）。stdout 经 `JsonlLineReader` 严格成帧（按 `\n` 切、剥 `\r`、跨 chunk 缓冲、**禁用 readline**），按 `response`/`event`/`extension_ui_request` 三类分发。命令以唯一 id 区分、并发互不阻塞；close/exit/crash 统一拒绝全部待决 Promise。

**transport 接缝**：`PiRpcChannel` 接口不泄漏 `ChildProcess` 概念，可注入 mock 做命令层单测，或实现 e2b/ssh/websocket 远程传输。

### 3.5 agent 源解析（agent-source-resolver）

把入参 `source`（本地目录 / git 三形态）解析为 `ResolvedSource = { mode, spawnSpec, cwd, trust }`，**不 spawn、不载入用户代码**。

```typescript
interface ResolveOptions {
  cwd?; agentDir?;                                   // agentDir → spawnSpec.env.PI_CODING_AGENT_DIR
  trustPolicy?: (source) => TrustDecision;           // 默认 "ask"
  sourceResolver?: SourceResolverPlugin;             // 扩展源类型
  runnerEntry?; piCliEntry?;                          // spawnSpec 目标（调用方注入）
}
type AgentMode = "custom" | "cli";
```

**管道**：`identify → fetch → probe → decide → trust → assemble`。入口探测 `package.json#pi-web.entry` > `index.ts > .js > .mjs`，有入口→`custom`，无→`cli`。git 源克隆缓存到 `~/.pi-web/agents/git/<host>/<path>@<ref>`。

> **ER-1 陷阱**：cli 分支**不得**带 `--cwd`（pi CLI 无此选项会崩溃致会话 404），工作目录改由 `spawnSpec.cwd` 设。

**扩展点**：`sourceResolver`（自定义源类型）、`trustPolicy`（信任策略钩子）、`runnerEntry`/`piCliEntry`（入口注入）。

---

## 4. 写一个 agent source

### 4.1 agent-kit：唯一作者 import 面

```typescript
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({
  model?, thinkingLevel?, tools?, excludeTools?, noTools?,
  customTools?, systemPrompt?, extensions?, skills?,
  promptTemplates?, contextFiles?, scopedModels?,
  allowExtensions?,                      // 见 §4.3
});
```

`defineAgent` 是恒等函数（仅类型推导）。`AgentContext = { cwd, agentDir?, env }` 在 `(ctx) => 定义` 工厂形态下注入。

### 4.2 runner 装配机制

runner 子进程入口：`node --import jiti/register lib/pi/runner.ts --agent <path> --cwd <work> [--agent-dir <dir>]`。runner 用 jiti import 用户 `index` 的 default export，支持**三形态**（定义对象 / `(ctx)=>定义` 工厂 / `CreateAgentSessionRuntimeFactory` 透传，鸭子类型识别）→ 装配为运行时 → `runRpcMode(runtime)` 暴露与 `pi --mode rpc` 逐字节一致的端点。**用户代码只在子进程内执行，后端进程不跑用户代码。**

`AgentDefinition` 字段映射到 pi 的 `resourceLoaderOptions`（systemPrompt→systemPromptOverride、extensions→additionalExtensionPaths/extensionFactories 等）与 `createAgentSessionFromServices`。

### 4.3 minimal 预设与扩展白名单（agent-minimal-preset）

```typescript
import { defineMinimalAgent } from "@blksails/pi-web-agent-kit";
export default defineMinimalAgent();                          // 无工具/无 skills/无系统扩展 基线
export default defineMinimalAgent({ model, systemPrompt, customTools });  // 叠加自定义（关闭语义保留）
export default defineMinimalAgent({ allowExtensions: ["foo"] });          // 仅重开命名扩展
```

`allowExtensions?: string[]`：缺省=加载全部；`[]`→`noExtensions:true`（被关扩展代码**根本不执行**，最安全）；非空→`extensionsOverride`（先全部加载再按名过滤，**会让被关扩展执行一次**，需强隔离用 `[]`）。`mapResourceLoaderOptions` 是落地点。

### 4.4 系统资源开关（system-resource-toggle-fix）

「设置→扩展→系统资源」两开关经 runner flag 透传：`--no-skills`（`loadSystemSkills:false`）、`--no-extensions`（`loadSystemExtensions:false`，沙箱强制注入仍保留）。`RunnerArgs` 加 `noSkills?`/`noExtensions?`，链路 `parseRunnerArgs → startRunner → loadAgentDefinition → buildRuntimeFactory → mapResourceLoaderOptions`。

> ER-2 教训：示例 agent 勿硬编码 model provider（用户 `auth.json` 无对应凭据会卡 "Generating…"），应继承 `settings.json` 默认。

---

## 5. 会话持久化与恢复

### 5.1 可插拔事件存储（session-store-adapters）

```typescript
interface SessionEntryStore {
  create(header): Promise<string>; append(id, entry): Promise<void>; appendBatch(id, entries): Promise<void>;
  read(id): AsyncIterable<SessionEntry>; readHeader(id): Promise<SessionHeader>;
  list(cwd): Promise<SessionMeta[]>; listAll(): Promise<SessionMeta[]>; delete(id): Promise<void>;
}
```

内置三 adapter：`FsSessionEntryStore`（默认 `~/.pi/agent/sessions`，盘上布局复刻 pi 的 `--<cwd编码>--/<时间戳>_<uuidv7>.jsonl` 以互通）、`SqliteSessionEntryStore`（注入 `node:sqlite DatabaseSync`）、`PostgresSessionEntryStore`（注入 pg Pool）。

**持久化结构** = 1 header + N entry（`parentId` 自引用构成树，同父多子=分叉）。`append` 幂等键 `(sessionId, id)`。

**扩展点**：实现 8 个方法即可换后端，复用导出的 codec 纯函数；可写**装饰器**（`constructor(private inner: SessionEntryStore)`）叠加加密/缓存/遥测。无 factory/registry，adapter 由调用方直接 `new`。测试用 `runStoreContract(makeStore)` 跨 adapter 一致性。

### 5.2 URL 冷恢复（session-persistence-url-resume）

- `POST /sessions` 请求体增 `resumeId`（存在→恢复，缺失→新建）。冷恢复刻意走此端点绕过 `/sessions/:id` 内存未命中 404。
- 前端路由 `/session/:id`，新建成功后 `history.replaceState` 同步 URL（非导航）。
- 主进程 `sessionId` 为权威 id，经 `--session-id` 下传两种 agent 模式做 open-or-create-by-id。创建元数据经一次性 `appendCustomEntry("piweb.session", {source,cwd,model})` 落盘（仅 custom 模式）。
- 前端 `GET /sessions/:id/messages` → `agentMessagesToUiMessages(msgs)`（纯函数）→ `useChat({messages})` 回放。

> **陷阱**：恢复时 `source` 取 `header.cwd`（绝对路径），不用 `piweb.session.source`（相对路径，基准 cwd 已丢）。
> **限制**：真实 agent 模式下 sqlite/postgres 续聊不保证（pi 运行时只从文件读历史，sqlite 仅镜像）。

---

## 6. 前端集成（React / UI）

### 6.1 headless 层（@blksails/pi-web-react）

把 http-api 的 REST + SSE 封装为一个 AI SDK v5 `ChatTransport` + REST 客户端 + 三个 hooks：

- `PiTransport`（`implements ChatTransport<UIMessage>`）：传给 `useChat({ transport })`。
- `createPiClient(baseUrl, fetch?)` → 全部 REST 方法。
- `usePiSession(opts)` → `{ sessionId, status, transport, error, close() }`（`status`: idle/connecting/open/reconnecting/closed/ended）。
- `usePiControls(opts)` → `setModel/setThinking/abort/steer/followUp` + `stats`/`commands`/`state`。
- `useExtensionUI(opts)` → `{ queue, current, respond(id, response), error }`。
- 富版数据 hooks：`useModels`（按 provider 分组懒加载）、`useAttachments`（仅 `image/*` 入列 + 上传状态）、`useBranches`（fork 分支）、`useSuggestions`（建议项，支持 merge）。

**单订阅 SSE 分流**：每会话一个 `/stream` 订阅，`parseSse` 切帧后按 `kind` 分流——`uiMessageChunk` → 喂 `useChat` 的消息流；`control` 帧（extension-ui/queue/stats/error）旁路到 `ControlStore`（`useSyncExternalStore`）。**控制/扩展 UI 绝不写入消息流。**

### 6.2 组件层（@blksails/pi-web-ui）

```typescript
<PiChat session={usePiSessionResult} controls? extensionUI? slots? showControls? registry? />
type PiChatSlots = { header?; footer?; sidebar?; background?; empty?; messageActions?: (m: UIMessage) => ReactNode };
```

`<PiChat>` 从 `usePiSession` 取 `transport` 喂 `useChat`，把 `messages[].parts` 交给 **`PartRenderer` 分派器**：`text`→`Response`；`reasoning`→`<PiReasoning>`；`tool`→`resolveToolRenderer(name) ?? PiToolPart`；`data-pi-*`→`resolveDataPartRenderer(type) ?? 默认`。

**富元件**（`@blksails/pi-web-ui/elements/*`）：conversation（自动滚动/分支/折叠）、prompt-input（附件/模型选择器/语音/联网开关/状态化发送）、attachments、model-selector、suggestions 等。**不新增 npm 运行时依赖**（模型选择器用自定义轻量 popover）；能力缺失（`/models`、`/fork*` 404）→ 对应 hook `available=false`，UI 优雅降级。

### 6.3 渲染扩展注册表

三类注册表，同构的 register/resolve/默认/覆盖语义（最后注册胜出）：

| 注册函数 | 作用粒度 | 适用 |
|---|---|---|
| `registerToolRenderer(toolName, Component)` | 工具卡整卡 | 自定义工具展示 |
| `registerDataPartRenderer(type, Component)` | `data-pi-*` part | 自定义数据部件 |
| `registerUiComponent(name, component)` | server-driven `data-pi-ui` 内置组件 | 扩展白名单组件集 |

宿主在挂载前调模块级注册函数；`createRendererRegistry()` 工厂供测试隔离。

### 6.4 交互富化能力一览

| spec | 能力 | 关键契约 |
|---|---|---|
| tool-call-ui-redesign | 工具卡复合化（`ToolHeader`/`ToolContent`/`ToolInput`/`ToolOutput`） | `ComponentOverrides.ToolPart` 整卡替换；三级回退 registry > override > 默认；`data-pi-tool-phase ∈ {start,update,end,error}`。ToolInput 用**同步 JSON 高亮**（`highlightJson`），勿用 `Response`/streamdown |
| slash-command-palette | "/" 命令浮层接线 | `PromptInput.suppressEnterSubmit`、`PiCommandPalette.onCaptureChange`；`value.startsWith("/")` 渲染，浮层 `z-40` |
| stream-error-surfacing | 流式错误可见化 | `<ChatError message>`（destructive + `role="alert"`）；服务端 `translate-event` 透传真实 `errorMessage`；abort 不进 error 态 |
| session-usage-panel | 会话用量条 | `showSessionStats?`（默认 true）；`<PiSessionStats>` + `data-pi-session-stats-region`；用量靠 `getStats()` REST（服务端不发 SSE stats 帧） |
| new-by-agent-source | 同源一键新建 | app 层 key-remount（`key=${source}#${nonce}`），丢 resumeId、bump nonce |
| web-ui-custom-rendering | server-driven UI | 见 §6.5 |
| webext-empty-state-config | Tier5 声明式空态 | `EmptyConfigSchema { title?, subtitle?, starters?, mergeCommands? }`；`PiChat.suggestionsMerge` |

### 6.5 server-driven UI（web-ui-custom-rendering）

agent 作者从后端单一 `data-pi-ui` part 声明富 UI，前端零配置渲染，对不可信输入保持安全。

```typescript
type UiSpec =
  | { kind:"builtin", component, props?, title? }     // 白名单组件：metric/keyValue/table/alert/progress/card/codeBlock
  | { kind:"sandbox", root: UiNode, title? };          // 不可信 JSON 节点树
```

**数据流**：agent 工具内 `emitUi(onUpdate, spec)` → pi `tool_execution_update` → server `extractToolDetailsUiSpec` 产 `data-pi-ui` 帧 → `PiUiPart`（渲染前 `UiSpecSchema.safeParse` 二次校验）→ builtin 走注册表，sandbox 走 `SandboxRenderer`。

**安全（信任模型「1+2 组合」）**：内置白名单组件（可信）+ 沙箱声明式（不可信）。沙箱保证：无代码执行（仅 `switch` 映射，无 eval）、无 HTML 注入（零 `dangerouslySetInnerHTML`）、无事件逃逸（只读）、CSS 仅 `UiStyle` 令牌枚举、协议白名单（`link.href` 仅 http/https/mailto，`image.src` 仅 http/https/data:image）、深度限制 `MAX_DEPTH=12`。

---

## 7. 四维可定制契约

pi-chat-customization 为 `PiChat` 提供**不改源码**即可定制的四维契约：**主题 / slots / components / layout+icons**，优先级 **slots(整块) > components(细粒度) > 默认**（`resolveComponent(override, Default)`，`null`=移除，`undefined`=回退默认）。

```typescript
<PiChat theme slots components icons layout toolbarOrder ... />
```

- **主题**：`ThemeProvider`（`mode: "light"|"dark"|"system"`）+ `useTheme()`；全部经 shadcn CSS 变量，无硬编码颜色。`system` 读 `matchMedia` 运行时更新。
- **slots**：header/footer/sidebar + 新增整块 `background`/`empty`。
- **components**（`ComponentOverrides`）：按位覆盖 `SubmitButton`/`Attachments|null`/`ModelSelector|null`/`Message`(按 role)/`MessageActions`/`Markdown`/`Reasoning`/`EmptyState`/`ToolPart` 等，`null` 表示移除。
- **layout**：`LayoutPreset = "centered"|"wide"|"full"|"split"`（`split`→`hasAside:true` 让位区由 slots/children 承接）。
- **icons**：`IconsProvider` + `useIcon(slot, fallback)`，`IconSlot` 枚举 send/stop/retry/attach/model/copy/… 等。
- **Tailwind**：`@blksails/pi-web-ui/tailwind-preset` 导出 `piWebPreset`（`presets:[piWebPreset]` 一行接入）。

---

## 8. WebExtension 扩展开发（5 Tier）

agent-web-extension 为每个 agent source 提供「UI 控制层」：source 在 `.pi/web` 下声明并预构建一个 WebExtension（ESM bundle + manifest），宿主在该 source 会话激活时经 **import map + 动态 `import()`** 懒加载。内核（document/session/transport/安全边界）永远归宿主。

### 8.1 WebExtension 描述符与 manifest

```typescript
import { defineWebExtension } from "@blksails/pi-web-kit";
export default defineWebExtension({
  manifestId: string,
  slots?: Partial<Record<SlotKey, SlotContribution>>,      // Tier 1
  renderers?: RendererContributions,                       // Tier 2（dataParts / tools）
  contributions?: ContributionPoints,                      // Tier 3
  config?: { theme?: ThemeTokens; layout?: LayoutPreset; empty?: EmptyConfig },  // Tier 5
  artifact?: ArtifactDeclaration,                          // Tier 4
});
```

manifest（由 `pi-web build` 产出）含 `id`、`targetApiVersion`（兼容的 web-kit 主版本）、`entry`（声明式可省）、`css?`、`integrity`（SRI sha384）、`signature?`、`capabilities?`。

### 8.2 ★ 5 Tier 模型

| Tier | 名称 | 能力 | 字段 | 编写要点 |
|---|---|---|---|---|
| **1** | 区域插槽 Slots | 把内容填入宿主预留的 **18 个具名插槽**，只填位不接管布局 | `slots` | 只能追加/装饰，**不得改 PromptInput 提交语义**；未声明用默认 |
| **2** | 渲染器注册表 | 注册 per-session、按 extId 命名空间的渲染器，渲染 `data-*` / `tool-*` part | `renderers`（`dataParts`/`tools`） | 仅 tool/dataPart 级，**不可**覆盖 message 级或 `Markdown`/`Reasoning`；会话结束清空 |
| **3** | 贡献点 + UI↔agent RPC | slash/mention/autocomplete/inlineComplete/command/custom + keybindings | `contributions` | 经 `use-ui-rpc` 双向通道；高频 inlineComplete 须防抖+取消；控制流仅 `hasContributions && !isBusy` 时开 |
| **4** | Artifact iframe | LLM 输出/高危内容强制入 sandbox iframe，独立 origin、无同源凭证、postMessage 中转 | `artifact` | iframe `sandbox="allow-scripts"`（**不含** `allow-same-origin`）；需 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 才挂载 |
| **5** | 纯声明配置 | 零代码：theme token + layout preset + empty 空态；**无 entry bundle** | `config` | manifest 可省 `entry`；网络请求不应见 `web-extension.mjs` |

**SlotKey 全集（18）**：`background / headerLeft / headerCenter / headerRight / sidebarLeft / panelRight / empty / footer / promptInput / accessoryAboveEditor / accessoryBelowEditor / accessoryInlineLeft / accessoryInlineRight / toolbar / notifications / statusBar / artifactSurface / dialogLayer`。

### 8.3 Tier 3 — UI↔agent RPC 契约

```typescript
interface UiRpcRequest { correlationId; point: "slash"|"mention"|"autocomplete"|"inlineComplete"|"command"|"custom";
                         action: "list"|"resolve"|"execute"|"complete"; payload; protocolVersion; }
interface UiRpcResponse { correlationId; ok; result?; error?; }
```

上行 `POST /sessions/:id/ui-rpc`（body=`UiRpcRequest`）→ `CommandAck`；下行 `control` 帧 `{ control:"ui-rpc", response }`，客户端按 `correlationId` 解析（超时客户端控制）。扩展经宿主注入的 `UiRpcClient.request(...)` 发请求，不直接持有 fetch/transport。

### 8.4 Tier 4 — Artifact postMessage 契约

```typescript
type ArtifactMessage =
  | { kind:"ready", manifestId }
  | { kind:"resize", height }
  | { kind:"rpc", request: UiRpcRequest }    // 经宿主中转回 agent
  | { kind:"event", name, data };
```

宿主校验 `event.origin` 与结构，丢弃不符消息。

> **门控**：未设 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` → `ArtifactSurface` 不挂载，是「正确门控非 bug」。

### 8.5 装配与构建纪律

**装配流**：选定 source 建会话 → `extension-gate` 校验 SRI/签名∈白名单/`targetApiVersion`（失败回退默认 UI 并记审计）→ `extension-loader` 注入 import map（react/web-kit/设计系统 → 宿主单例 URL）→ `import(entryUrl)` 得描述符 → `apply-extension` 并入 per-session registry/slots/contributions，以 error boundary 隔离扩展渲染错误。

**`pi-web build`（`@blksails/pi-web-kit` CLI）纪律**：`externals-guard`（内联 react/web-kit → exit 1）、`css-scope-plugin`（前缀 `pw-<id>-<hash>`、剥全局选择器/preflight）、`manifest-emit`（SRI + 可选签名）。

**关键文件**：协议 `packages/protocol/src/web-ext/*.ts`；作者 SDK `packages/web-kit/src/*` + `build/*`（bin `pi-web`）；客户端 `packages/react/src/web-ext/*`；宿主 `packages/ui/src/web-ext/*`；示例 `examples/webext-{layout,renderer,contrib,artifact,declarative}-agent/.pi/web/`。

### 8.6 视觉验收（agent-web-extension-visual-acceptance）

用 Chrome DevTools 驱动隔离构建（`NEXT_DIST_DIR=.next-e2e`）跑 stub agent 会话，对 5 Tier 全部 29 项（R1–R29）做端到端验收。stub 启动：`NEXT_DIST_DIR=.next-e2e SESSION_STORE=fs PI_WEB_STUB_AGENT=1 next start -p 3100`，sentinel 关键词（`ext-ui`/`ext-select`/`/`/`@` 等）触发确定性产出。12 个协议保留插槽各赋 `[data-pi-ext-<slot>]`，与内核环境 UI **共存（追加而非替换）**。

---

## 9. 扩展管理与环境 UI

### 9.1 扩展管理 API（extension-management）

经受控 HTTP API 暴露安装/卸载/列举/会话重载，以「管理员门控 + 来源白名单 + 版本固定 + 非交互执行 + 审计」收敛 RCE 风险。

| 方法 | 路径 | Body |
|---|---|---|
| GET | `/extensions` | — |
| POST | `/extensions` | `{ source }`（须精确固定 `npm:@scope/pkg@x.y.z` / `git:host/user/repo@<commit>` / `local:<path>`，否则 422 不执行） |
| DELETE | `/extensions/:id` | — |
| POST | `/sessions/:id/reload` | 重启子进程，应用 `trustPolicy` |

安装管线 fail-fast：管理员门控 → DTO 校验 → 白名单+版本固定 → 装配 args（始终 `--ignore-scripts`；git 注入 `GIT_TERMINAL_PROMPT=0` 等）→ `pi install` + 超时 → 审计。经 `createExtensionRoutes(opts)` 注入 handler 的 `routes?`。

### 9.2 环境 UI 表面（extension-ui-surfaces）

agent 经控制通道发 5 个**单向推送**（fire-and-forget）方法，**零协议改动**：

| 方法 | 表面 | data 属性 |
|---|---|---|
| `notify` | 浮层（~5s 自动消失） | `data-pi-notification` + `data-pi-notify-type` |
| `setStatus` | 头部状态条 pill | `data-pi-status` + `data-status-key` |
| `setWidget` | 输入框上/下 widget | `data-pi-widget` + `data-widget-key` |
| `setTitle` | 头部标题 | `data-pi-extension-title` |
| `set_editor_text` | 输入框预填（保留续编） | `data-pi-input-textarea` |

SSE 控制帧入 `ControlStore`：交互类入队列 FIFO，推送类分流到 ambient 切片（绝不入队列防阻塞）。消费经 `useExtensionUI()`。

### 9.3 内联交互（extension-ui-inline-interaction）

四类交互（confirm/select/input/editor）从模态弹窗改为**消息流末尾内联卡片**，弱打断、应答后保留只读终态留痕。FIFO 串行：仅 `queue[0]` 可应答；应答经 `respond(id, response)`，成功追加留痕并出队，失败保留可重试。挂载点为消息容器末尾（`<PiInteraction extensionUI>`，移除 `PiPermissionDialog` 模态）。

---

## 10. 配置 UI / Schema 表单

### 10.1 zod → 表单（schema-config-ui）

由对象 schema 自动生成可校验、可读写配置表单，schema 为单一事实源。窄腰 IR：

```typescript
type FieldKind = "string"|"secret"|"number"|"boolean"|"enum"|"multiEnum"|"stringList"|"object"|"record";
function zodToFormSchema(schema, meta): FormSchema;   // UI 元数据走 .describe(JSON.stringify({label,group,order,widget,...}))
```

前端 `useSchemaForm(formSchema, initial)` → `GET/PUT /api/config/:domain`。secret 字段（key 含 `apiKey/token/secret` 自动识别）读掩码、写仅写语义（空=保持、显式清除=删）。

**新域**：写 zod schema → `defaultSettingsRegistry.registerPanel({id, title, formSchema, ...makeConfigDomainIO("domain")})`，设置外壳零改动。**自定义渲染器**：`fieldRendererRegistry.registerFieldRenderer(kindOrKey, Component)`（与 `renderer-registry` 同款）。

> **动态选项陷阱**（与 MEMORY 一致）：前端**不读**后端注入 formSchema 的动态选项；provider/model 可搜索下拉必须走 widget + 数据端点 + 自定义 renderer。

### 10.2 JSON Schema → 表单（json-schema-config-form）

把带 `$schema` URL 的扩展配置文件转为 FormSchema IR：`jsonSchemaToFormSchema(schema, opts?)`，支持对象数组（新增 `objectList`）与 `oneOf`+`const` 判别键的多态变体、`$ref` 递归。不支持 anyOf/allOf/if-then 等 → 降级原始 JSON，不抛异常。MVP 把 schema 拉取放客户端（`ConfigFilesField` 直接 fetch `$schema` URL，按 URL 内存缓存），失败回退 textarea。

### 10.3 沙箱/扩展配置域（config-ui-sandbox-extensions）

在配置 UI 栈上增「沙箱」「扩展」两域，跨全局（`~/.pi/agent/*.json`）与项目（`<cwd>/.pi/*.json`）作用域，「同组面板=一菜单项+全局/项目 Tab」。`sandboxConfigSchema`→`sandbox.json`，`extensionsConfigSchema`→`settings.json` 顶层。沙箱 enforcement 强制注入：`resolveSandboxEntry(agentDir)` 读 `PI_WEB_SANDBOX_ENTRY` 或查 `<agentDir>/npm/node_modules/pi-sandbox/index.ts`，CLI 模式 `args += ["-e", entry]`，custom 模式经 `mapResourceLoaderOptions` 置前 `additionalExtensionPaths`。注册经 `registerConfigPanel({domain, group, tabLabel, isProjectScope, ...})`。

---

## 11. 触发符补全框架

completion-provider-framework：键入 `@`/`/`/`$` 等触发符，经资源无关端点向可插拔 `CompletionProvider` 取候选，选中插入带类型 token，提交时按 `kind` 分发到 provider 的 `resolve` 完成回环。

```typescript
interface CompletionProvider {
  id; trigger;              // 单一规范触发符（注册时校验单字符）
  kind?; priority?;         // 默认 kind=id, priority=0
  complete({query, ctx}): Promise<CompletionItem[]>;
  resolve?(ref, ctx): Promise<ResolvedContext | null>;
}
type CompletionCtx = { sessionId; cwd; userId };   // 服务端注入，前端不可篡改
```

**数据流**：挂载 `GET /sessions/:id/completion/triggers` 取触发符+提取规则 → 键入提取 token → 防抖 `GET …/completion?trigger=&q=` → registry 归一触发符（`＠→@`）→ 并发分发 provider（per-provider 超时）→ `merge`（`priority desc, score desc, label asc`，按 kind 去重，limit 截断）→ 渲染。插入用 `insertText ?? serializeToken`（文法 `@kind:id`）。提交时 messages 路由 `resolveCompletions` 扫 token → provider `resolve` 重写文本（失败保留原文不阻断发送）。

**加新资源类型 = 纯加一个 provider 注册**，零端点、零协议改动（在 `create-handler.ts` 构造期 `completion.register(provider)`）。

- **file provider**（`createFileProvider(opts?)`）：`includes?`/`excludes?`（cwd 相对 glob）、`respectGitignore?`（默认 true）。**刻意无 `root`**——cwd 外资源做成独立 provider；安全门 realpath 前缀必须 === realpath(cwd)。自研零依赖 glob（`** / * / ? / {a,b}`）。
- **attachment provider**（attachment-mention-completion）：`createAttachmentProvider(store)`，同 `@` 触发符与 file provider 并存。`complete` 列本会话已有附件，`resolve` 校验 `att.sessionId===ctx.sessionId` 后产 `buildAttachmentRefs([att])` 引用标记。被 mention 的附件**不进 `attachmentIds`**，解析为内联文本标记。

---

## 12. 附件系统

附件系统分 L0–L3，守 **三不变式**：①单一身份（公开 id `att_<nanoid>` 仅 server `put()` 铸造）；②先落库后引用；③base64 仅具名出口（vision 现状 + afterToolCall 标记复看）。上传（`origin:"upload"`）与 tool 产出（`origin:"tool-output"`）共用同一 id 空间。

### 12.1 对象存储（attachment-store，L0/L1）

```typescript
interface BlobStore { put(key, body, meta); getReadStream(key); head(key); presignUrl(key, {expiresInMs?}); delete(key); }
// AttachmentStore 门面：put(PutInput) → Attachment（仅此铸造公开 id）、head、getReadStream、
//   localPath(id)、listBySession、presignUrl、verifyUrl、delete
type PutInput = { bytes, name, mimeType, size, sessionId, origin };
```

`BlobStore` 端口可换 S3（`presignUrl` 同形缝已留）；内置 `LocalFsBlobBackend`（盘上 `<root>/<id>`，`key=id` 冻结为跨 spec 契约）。`UrlSigner` 用 HMAC-sha256 + timingSafeEqual + 过期。

**HTTP**：`POST /sessions/:id/attachments`（multipart，写路径，会话门控）；`GET /attachments/:id/raw?exp&sig`（读路径，签名自洽，不存在与签名失败响应不可区分以防枚举）。前端 `uploadAttachment(baseUrl, sessionId, file)`，`useAttachments` 的 `PendingAttachment` 扩展 `status/attachmentId?/displayUrl?`。**对 LLM 维持现状**：vision 仍发 base64。

### 12.2 工具桥接（attachment-tool-bridge，L2/L3）

把落库附件接到 runner 子进程的 server 端 tool。`resolveAttachment(store, id) → AttachmentHandle`，句柄有 `bytes()`/`stream()`/`localPath()`/`url({expiresInMs?})`（**无 base64 形态**）。`AttachmentToolContext` 提供 `resolve(id)` + `putOutput({bytes, name, mimeType, sessionId})`（固定 `origin:"tool-output"`）。

两个 pi hook 守闸门：`beforeToolCall`（从 `ctx.args` 提 `attachmentId`，校验 `meta.sessionId===sessionId`，越权→`{block:true}`）；`afterToolCall`（遍历 `result.content`，含 image 且非 `keepInlineImages` 标记 → 替换为文本引用）。引用标记单一来源 `buildAttachmentRefs`（`[attachment id=… type=… name=…]`）。

**写 server 端图像 tool**：`parameters` 用显式 `attachmentId: string`，`resolve(id)` 取 path/url/bytes → 处理 → `putOutput` 落库铸 `att_out` → 回 `{content:[text 引用], details:{outputAttachmentId, displayUrl}}`；回图 `ImageContent.data` 须先 await 成 string。示例 `examples/attachment-tool-agent/`。

> **共享 env**：`PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 由 attachment-store 经 spawn env 全权下发给 runner 子进程；子进程经 `createChildAttachmentStore(process.env)` 读取，env 缺失→能力降级 `available:false`，不回调主进程。

---

## 13. AIGC 工具

`@blksails/pi-web-tool-kit` 提供声明式 AIGC 工具引擎。**双入口强约束**：主入口 `@blksails/pi-web-tool-kit`（声明层，前端安全，禁顶层 import SDK/undici）；子入口 `@blksails/pi-web-tool-kit/runtime`（node-only，含 `compileTool`/`buildAigcTools`）。

### 13.1 架构（aigc-tools-refactor 后）

工具拍平为 `ToolSpec` + `models[]` 单层路由，`model` 成为 LLM 可见枚举入参。强制依赖方向 `Types → Providers → Tools → Assembly`。

```typescript
type ModelRoute = EndpointBehavior & { model; label; description? };  // model 既是 LLM enum 也是路由键
type ToolSpec = { name; description; inputSchema(不含 model); models: ModelRoute[]; defaultModel; requiredParams? };
function compileTool(tool, deps?): ToolDefinition;   // 仅 /runtime 导出
```

### 13.2 两个工具（对齐 OpenAI Images API）

| 工具 | 必填 | 可选 | models（**粗体=默认**） |
|---|---|---|---|
| `image_generation` | `prompt` | `model, n, size, negative_prompt, background, moderation, quality` | `wan2.6-t2i`, `qwen-image-pro`, **`gpt-image-2`** |
| `image_edit` | `image`(image), `prompt` | `mask(image), model, n, size, reference_images[], response_format` | **`qwen-image-edit-max`**, `gpt-image-2` |

**数据流**：`selectModelRoute(args.model | defaultModel)` → `checkRequiredVars + ctx.available` 降级门 → `resolveMediaFields`（`att_` → dataURI）→ `runEndpoint(route, args)`（同步 POST / 异步轮询，`AbortSignal` 透传）→ `persistPicked`（逐 url fetch 字节 `ctx.putOutput` 落库）→ `content(text + ![](displayUrl)) + details{ok, model, assets}`。非法 model 回退 defaultModel（不中止）。execute 全程 try/catch，失败 `details:{ok:false, error}` 不崩子进程。

> **image_edit 输入接缝**：输入图 `att_id` 经 `ctx.resolve(attId).bytes()` 转 **data URI** 注入（不用 `handle.url()`，因 dev 下 displayUrl 是 localhost provider 不可达）。

### 13.3 交互补全（aigc-tools-interactive-params）

`model`/`size`/`prompt` 在 schema 不标 required（避免校验拦截），由执行层缺失时经 pi SDK `ctx.ui` 弹窗补全：

```typescript
type InteractionSpec = { param; via:"select"|"input"; title; options?(含哨兵 "$models"); fallback? };
// ToolSpec.requiredParams?: InteractionSpec[]
```

`hasUI=true` → select（`$models` 展开为 `tool.models.map(m=>m.model)`）/ input，取消→`{ok:false}` 不调 provider；无 UI → fallback 优先（model→`defaultModel`）。

### 13.4 Provider 与密钥

三家 provider（DashScope / NewAPI / OpenRouter），工厂统一返回 `ModelRoute`：`createDashscopeSyncT2I`/`createDashscopeAsyncT2I`/`createDashscopeImageEdit`/`createNewApiImage`/`createOpenRouterImage` 等。`providerModel` 区分「LLM 可见 model 值」与「实际发往网关的 model 名」。密钥经 `${VAR}` env-only 解析（仅子进程 `process.env` 读取，不进前端 bundle），变量名声明在各 provider behavior（`NEWAPI_API_KEY` / `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` 与变体绑定，精确名见 `packages/tool-kit/src/aigc/providers/*.ts`）。

> 默认 `image_generation` → `gpt-image-2`（NewAPI）。缺密钥不是 bug：工具仍加载，调用返回「能力不可用/缺少配置」可读降级。runtime dep `undici`（代理 fetch，支持 socks5/http）。

---

## 附录 A：环境变量总表

| 变量 | 作用 | 归属 |
|---|---|---|
| `ANTHROPIC_API_KEY` 等 | provider 凭据（ER-1 后由子进程从 `~/.pi/agent/auth.json` 解析，非 config 强制） | app-shell |
| `PI_WEB_DEFAULT_PROVIDER` / `_MODEL` | 默认 provider/model（ER-1 改为可选，未设由 `settings.json` 决定） | app-shell |
| `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` | agent 目录（默认 `~/.pi/agent`），写入 `spawnSpec.env` | app-shell / resolver |
| `SESSION_STORE` | `fs`(默认 JSONL) / `sqlite` | session-persistence |
| `PI_WEB_ATTACHMENT_DIR` | 附件落盘目录 | attachment-store |
| `PI_WEB_ATTACHMENT_SECRET` | 附件 URL HMAC 签名 secret（主/子进程共享） | attachment-store |
| `PI_WEB_SANDBOX_ENTRY` | 沙箱 enforcement 入口 | config-ui-sandbox |
| `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` | Tier4 artifact iframe 门控 + 静态资源前缀 | agent-web-extension |
| `PI_WEB_HIDE_PROVIDERS` | 模型下拉隐藏指定 provider（后续 commit，非 design） | — |
| `NEWAPI_API_KEY` / `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` | AIGC provider 密钥（与变体绑定） | tool-kit |
| `PI_RUNNER_HOT_RELOAD` | dev runner 热重载 | rpc-channel |
| `NEXT_DIST_DIR` / `PI_WEB_E2E_STUB` / `PI_WEB_STUB_AGENT` / `PI_WEB_E2E_EXTERNAL_SERVER` | e2e 隔离 build / stub | 测试 |

---

## 附录 B：HTTP 路由总表

> DTO 形状取自 `@blksails/pi-web-protocol`。基址可经 `sse.basePath` 配置（如 `/api`）。

| Method | Path | 用途 | 类型 |
|---|---|---|---|
| POST | `/sessions` | 建会话（`{source,cwd?,model?,env?}` 或 `{resumeId}`）→ `{sessionId}` | JSON |
| **GET** | **`/sessions/:id/stream`** | **增量流（唯一 SSE）** | **SSE** |
| POST | `/sessions/:id/messages` | 发消息 | JSON |
| POST | `/sessions/:id/steer` · `/follow_up` · `/abort` | 控制 | JSON |
| POST | `/sessions/:id/model` · `/thinking` | 设模型/思考级 | JSON |
| POST | `/sessions/:id/ui-response` · `/ui-rpc` | 扩展 UI 应答 / Tier3 RPC 上行 | JSON |
| GET | `/sessions/:id/state` · `/stats` · `/messages` · `/commands` | 查询 | JSON |
| GET | `/sessions/:id/models` · POST `/fork` · GET `/fork-messages` | 富版模型/分支 | JSON |
| DELETE | `/sessions/:id` | 删会话 | JSON |
| GET/POST/DELETE | `/extensions` · `/extensions/:id` · POST `/sessions/:id/reload` | 扩展管理 | JSON |
| POST/GET | `/sessions/:id/attachments` · `/attachments/:id/raw` | 附件上传/分发 | multipart / binary |
| GET | `/sessions/:id/completion/triggers` · `/completion?trigger=&q=` | 补全 | JSON |
| GET/PUT | `/api/config/:domain` · `.../project?cwd` | 配置读写 | JSON |

> 有意未暴露（deferred）：`compact`/`clone`/`bash`/`abortBash`/`cycleModel`（命令层有，HTTP 未开）。

---

## 附录 C：data-* 钩子总表

集成方做 e2e / 自定义渲染时常用的 DOM 锚点：

- **会话/输入**：`data-agent-source-input`、`data-agent-source-submit`、`data-session-active`、`data-session-id`、`data-pi-input-textarea`、`data-pi-submit-state`、`data-new-session`、`data-switch-source`
- **消息/工具**：`data-pi-chat-messages`、`data-pi-tool`/`-phase`/`-name`/`-status`/`-detail`、`data-pi-error`
- **状态/用量**：`data-pi-session-stats[-region]`、`data-pi-stat`、`data-pi-theme-toggle`、`data-pi-chat-aside`
- **环境 UI**：`data-pi-notification`/`-notify-type`、`data-pi-status`/`data-status-key`、`data-pi-widget`/`data-widget-key`、`data-pi-extension-title`、`data-pi-ext-status-bar`
- **内联交互**：`data-pi-interaction[-active|-resolved|-method|-outcome|-submit|-cancel|-error]`、`data-pi-{confirm-ok,confirm-cancel,select-option,input,editor}`
- **WebExtension 插槽**：`data-pi-ext-<slot>`（12 保留插槽）、`data-pi-ext-theme`、`data-pi-artifact`
- **AIGC**：`data-testid=aigc-tool-card`、`aigc-view-image`/`aigc-view-json`

---

*本手册由 4 个并行 agent 深读 37 份 `design.md` 提炼综合而成。标注「(design 未明确)」处需查源码或对应 spec 确认。*

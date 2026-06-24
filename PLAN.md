# pi-web — pi 自定义 Agent 的即时 Web UI · 技术方案

> **项目目的**:给定一个**目录或 git 仓库**(其中含 `index.[js|ts]` 入口,用 pi SDK 定义了一个自定义 agent),
> pi-web 自动把它**载入并起一个流式 Web 聊天 UI**——让任何用 pi SDK 写的 agent 秒变带 UI 的产品。
>
> **集成方式**:pi-web 为每个会话 spawn 一个 **bootstrap runner** 子进程,它用 `jiti` 载入用户的
> `index.[js|ts]` → 组装成 pi `AgentSessionRuntime` → 调 SDK 的 **`runRpcMode(runtime)`**。
> 于是子进程通过 **RPC mode**(JSONL over stdio)对外,与"通用 `pi --mode rpc`"协议**完全一致**。
> 前端用 **Next.js + shadcn/ui + Vercel AI Elements**,经 **SSE + AI SDK v5 自定义 `ChatTransport`** 流式渲染。
>
> 关键收益:RPC 桥 / 事件→UIMessage 翻译 / 控制面板 / 权限弹窗这套前后端,
> **无论包的是用户自定义 agent 还是通用 pi agent 都不用改**——区别只在 spawn 的目标。

---

## 1. 技术栈与版本

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 15 (App Router, RSC) | API Route Handler 必须跑 **Node runtime**(spawn 子进程) |
| 语言 | TypeScript (strict) | |
| UI 基础 | shadcn/ui (Radix + Tailwind v4) | CSS variables 主题 |
| Chat 组件 | **Vercel AI Elements**(`npx ai-elements@latest add ...`) | Conversation / Message / Response / Reasoning / Tool / PromptInput / Actions |
| 状态/流 | AI SDK v5 `@ai-sdk/react` 的 `useChat` + 自定义 `ChatTransport` | transport 把 pi 事件翻译成 UIMessage 流 |
| Agent runtime | `@earendil-works/pi-coding-agent` SDK:`createAgentSessionRuntime` + `runRpcMode` | 自定义 agent 的承载层 |
| Agent 载入 | `jiti`(运行时直接跑用户 `index.ts`)+ bootstrap runner | 与 pi 载扩展同款方案 |
| 进程运行时 | Node `>=22.19.0`(`node:24-slim`) | pi `engines` 约束 |
| 运行形态 | 长驻 Node 服务(`next start` / 自托管),**非 Serverless/Edge** | 子进程需跨请求驻留 |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│ 浏览器 (Next.js Client)                                   │
│  AI Elements <Conversation>/<Message>/<Tool>/<Reasoning>  │
│  useChat({ transport: PiTransport })                      │
│  pi 控制面板: 模型/思考等级/成本/steering/权限弹窗         │
└───────▲───────────────────────────────┬──────────────────┘
        │ SSE (事件: UIMessage chunks)    │ HTTP POST (命令)
        │ GET /api/sessions/:id/stream    │ /api/sessions/:id/*
┌───────┴───────────────────────────────▼──────────────────┐
│ Next.js Route Handlers (Node runtime)                     │
│  AgentSourceResolver: 目录 | git → 本地路径(+缓存)        │
│  SessionRegistry: Map<sessionId, PiSession>(模块级单例)   │
│  PiSession: PiRpcProcess + 事件→UIMessage 翻译            │
└───────────────────────────┬──────────────────────────────┘
                            │ stdin/stdout (JSONL, LF)
        ┌───────────────────▼─────────────────────┐
        │  bootstrap runner (一会话一子进程)        │
        │  node --import jiti/register runner.ts    │
        │    --agent <resolvedPath> --cwd <work>    │
        │  ├─ jiti import <path>/index.[ts|js]      │
        │  ├─ 组装 AgentSessionRuntime              │
        │  └─ runRpcMode(runtime)  ← 标准 RPC 协议  │
        └───────────────────────────────────────────┘
   (无 index 时回退:直接 spawn `pi --mode rpc` 作为默认 agent)
```

---

## 3. 后端设计

### 3.0 Agent 载入与 Bootstrap Runner(★ 项目核心)

#### 3.0.0 双模式:自定义 agent 载入器 + 通用 pi CLI
pi-web 同时是两件事,由 agent 源里**是否存在入口文件**自动二选一:

| 源情况 | 模式 | spawn 目标 | 说明 |
|---|---|---|---|
| 含 `index.[ts\|js\|mjs]`(或 `package.json#pi-web.entry`) | **自定义 agent** | `node --import jiti/register runner.ts --agent <path>` | runner 载入用户定义 → `runRpcMode` |
| **无入口文件** | **通用 pi CLI** | `pi --mode rpc`(`node <pkg>/dist/cli.js --mode rpc`)`--cwd <source>` | 把该目录当普通项目,跑 stock pi agent |
| 未指定 source | **通用 pi CLI** | 同上,`cwd` = 默认工作区 | 等价"给 pi CLI 套个 web UI" |

> 关键:两种模式**对外都是同一套 RPC JSONL 协议**(自定义走 SDK 的 `runRpcMode`,通用走 CLI 的 `--mode rpc`),
> 所以 `PiRpcProcess` / SSE 桥 / 翻译层 / 前端**完全复用**,只是 `PiRpcProcess` 的 spawn 配置不同。
> 检测逻辑放在 `agent-source.ts`:解析源 → 探测入口 → 返回 `{ mode: "custom"|"cli", spawnSpec }`。

#### 3.0.1 Agent 源解析(目录 | git)
`POST /api/sessions { source }`,`source` 可为:
- **本地目录**:`/abs/path` 或 `./rel`(相对服务工作区)。
- **git**:`git:host/user/repo@ref`、`https://github.com/user/repo@ref`、`ssh://...`。
- 解析步骤:git → clone/pull 到缓存 `~/.pi-web/agents/git/<host>/<path>@<ref>`(pinned ref);
  目录 → 直接用。然后在根定位入口:`index.ts` > `index.js` > `index.mjs`(可被 `package.json#pi-web.entry` 覆盖)。
- 缓存与并发:同一 `source@ref` 复用克隆;非交互 git 用 `GIT_TERMINAL_PROMPT=0` + `GIT_SSH_COMMAND` BatchMode。

#### 3.0.2 Agent 模块契约(用户写的 `index.ts`)
入口 **default export** 一个 `AgentDefinition`,或一个 `(ctx) => AgentDefinition | Promise<…>` 工厂。
`ctx` 提供 `{ cwd, agentDir, env }`。`AgentDefinition` 是 `CreateAgentSession*` 选项的友好超集:

```ts
// 用户项目 index.ts
import { getModel } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default {
  model: getModel("anthropic", "claude-opus-4-5"),   // 或 { provider, modelId }
  thinkingLevel: "medium",
  tools: ["read", "grep", "bash"],                    // 内置工具白名单
  customTools: [/* defineTool(...) */],               // 自定义工具
  systemPrompt: () => "You are ...",                  // → resourceLoader.systemPromptOverride
  extensions: ["./ext/guard.ts"],                     // 路径或 ExtensionFactory[]
  // skills / contextFiles / scopedModels / settings 等可选
};
```

三种 export 形态由 bootstrap 归一化:
1. 定义对象 → 映射成 runtime factory。
2. `(ctx) => 定义对象` 函数 → 调用后映射。
3. 直接 export `createRuntime`(`CreateAgentSessionRuntimeFactory`)→ 最大控制,直接使用。

> 提供可选的 `defineAgent()` 帮助函数做类型提示(从 pi-web 的轻量 `@blksails/agent-kit` 包导出),
> 但运行时**不强制依赖**——只要 default export 结构匹配即可。

#### 3.0.3 Bootstrap Runner(`lib/pi/runner.ts`,被 spawn 的子进程入口)
```ts
// 伪代码
const def = await loadAgentDefinition(agentPath);     // jiti import + 归一化
const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd, agentDir,
    resourceLoaderOptions: {
      systemPromptOverride: def.systemPrompt,
      additionalExtensionPaths: def.extensionPaths,
      extensionFactories: def.extensionFactories,
      // skills/prompts/contextFiles override...
    },
  });
  const result = await createAgentSessionFromServices({
    services, sessionManager, sessionStartEvent,
    model: def.model, thinkingLevel: def.thinkingLevel, scopedModels: def.scopedModels,
    tools: def.tools, excludeTools: def.excludeTools, noTools: def.noTools, customTools: def.customTools,
  });
  return { ...result, services, diagnostics: services.diagnostics };
};
const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager: SessionManager.create(cwd) });
await runRpcMode(runtime);   // ← 之后就是标准 RPC JSONL 协议
```
- 启动方式:`node --import jiti/register lib/pi/runner.ts --agent <path> --cwd <work> [--agent-dir ...]`
  (或运行时用 `createJiti()` 程序化 import,免 `--import` 标志)。
- 这样 **pi-web 后端不在自己进程内跑用户代码**(隔离),且子进程对外是纯 RPC,复用全部桥接。

### 3.1 PiRpcProcess(后端 ↔ 子进程的 RPC 桥)
后端不直接用包里的 `RpcClient`(它写死 spawn `pi --mode rpc`,且**未暴露 extension UI 子协议**)。
而是**自写 `PiRpcProcess`**(参照 `RpcClient` 的 spawn + JSONL framing 实现),它:
- spawn 上面的 **bootstrap runner**(或回退 `pi --mode rpc`),用 `{ cwd, env, agentPath }` 配置。
- 内置**协议正确的 JSONL 解析器**(以 `\n` 切、剥 `\r`,**不用** Node `readline`,避免 `U+2028/2029` 误切)。
- 同时处理三类 stdout 消息:`response`(按 `id` 关联 Promise)、`event`(广播)、`extension_ui_request`(权限弹窗)。
- 暴露与 `RpcClient` 同名的方法:`prompt/steer/followUp/abort`、`setModel/cycleModel/getAvailableModels`、
  `setThinkingLevel`、`getState/getMessages/getSessionStats/getCommands`、`compact/fork/clone/newSession`、
  `bash/abortBash`,加 `onEvent()` 与 `respondExtensionUI(id, …)`。
- 协议类型从包 `dist/**/*.d.ts` 复制到本地 `rpc-types.ts`(`RpcCommand/RpcResponse/RpcExtensionUIRequest/Response`,
  因为未在包 `exports` 导出)。

### 3.2 SessionRegistry(进程驻留)
- 模块级 `Map<sessionId, PiSession>`,挂在 `globalThis` 上避免 Next dev 热重载丢失。
- `PiSession` 持有:子进程、`EventEmitter`(广播 pi 事件给所有 SSE 订阅者)、pending 的 extension UI 请求表、最近状态缓存。
- 生命周期:创建 → idle 计时器(N 分钟无活动)→ `stop()` + 从 Map 移除;进程退出/崩溃要广播错误事件并清理。

### 3.3 API Route Handlers(全部 `export const runtime = "nodejs"`)

| Method & Path | 作用 |
|---|---|
| `POST /api/sessions` | `{ source, cwd?, model?, env? }` → 解析 agent 源 → spawn bootstrap runner → 返回 `{ sessionId }` |
| `GET  /api/sessions/:id/stream` | **SSE**:订阅 pi 事件,服务端翻译成 UIMessage stream chunks 推给前端 |
| `POST /api/sessions/:id/messages` | 发送 `prompt`(支持 `streamingBehavior: steer/followUp`、images) |
| `POST /api/sessions/:id/steer` · `/follow_up` · `/abort` | 转向 / 跟进 / 中止 |
| `POST /api/sessions/:id/model` · `/thinking` | 切模型 / 设思考等级 |
| `GET  /api/sessions/:id/state` · `/stats` · `/messages` · `/commands` | 状态 / 成本 token / 历史 / 可用命令 |
| `POST /api/sessions/:id/ui-response` | 回复 extension UI 弹窗(select/confirm/input/editor) |
| `DELETE /api/sessions/:id` | 关闭会话、杀子进程 |

### 3.4 认证 / 配置
- pi 读取 provider key 顺序:子进程 `env`(如 `ANTHROPIC_API_KEY`)→ `~/.pi/agent/auth.json`。
- 后端从 `.env.local` 注入到 spawn 的 `env`,并传 `PI_CODING_AGENT_DIR`(agentDir 覆盖)、`PI_CODING_AGENT_SESSION_DIR`、`PI_PACKAGE_DIR` 等隔离配置(可选)。
- 模型/思考等级默认值由启动参数 `--provider/--model` 给定,运行中可 `set_model` 切换。

---

## 4. 事件 → AI SDK UIMessage 流 翻译层(核心)

`PiSession` 把 pi 的 `AgentEvent` 映射为 AI SDK v5 UIMessage stream chunk:

| pi 事件 | UIMessage chunk | 备注 |
|---|---|---|
| `agent_start` | `start` / `start-step` | 开启一条 assistant message |
| `message_update` · `text_start` | `text-start`(分配 partId) | |
| `message_update` · `text_delta` | `text-delta`(增量) | 直接驱动 `<Response>` Markdown 流式渲染 |
| `message_update` · `text_end` | `text-end` | |
| `message_update` · `thinking_*` | `reasoning-start/delta/end` | 驱动 `<Reasoning>` 折叠思考块 |
| `tool_execution_start` | `tool-input-available`(toolCallId/toolName/args) | 驱动 `<Tool>` 卡片 |
| `tool_execution_update` | 自定义 `data-` part(累积输出) | `partialResult` 是累积值,替换即可 |
| `tool_execution_end` | `tool-output-available`(result/isError) | |
| `turn_end` | `finish-step` | |
| `agent_end` | `finish` | 一轮结束 |
| `compaction_*` / `auto_retry_*` | 自定义 `data-pi-*` part | 顶部状态条提示 |
| `queue_update` | 自定义 `data-pi-queue` | 显示 steering/followUp 队列 |
| `extension_ui_request` | **走旁路 SSE 事件**(非 UIMessage) | 前端弹 dialog,回 `/ui-response` |

前端用自定义 `ChatTransport`:
- `sendMessages()`:POST `/messages` 发 prompt,返回 SSE-backed 的 `ReadableStream<UIMessageChunk>`(实际订阅 `/stream`)。
- `reconnectToStream()`:断线重连复用 `/stream`。
- pi 特有控制(模型/思考/stats/steer/abort)通过额外的 hook + fetch 调对应 route,不走 useChat。

---

## 5. 目录结构(计划)

```
pi-web/
├─ app/
│  ├─ layout.tsx · page.tsx                # 主聊天页
│  ├─ globals.css                           # tailwind + shadcn tokens
│  └─ api/sessions/
│     ├─ route.ts                           # POST 创建
│     └─ [id]/
│        ├─ stream/route.ts                 # GET SSE
│        ├─ messages/route.ts               # POST prompt
│        ├─ steer|follow_up|abort/route.ts
│        ├─ model|thinking/route.ts
│        ├─ state|stats|messages|commands/route.ts
│        ├─ ui-response/route.ts
│        └─ route.ts                         # DELETE
├─ lib/
│  ├─ pi/
│  │  ├─ runner.ts                          # ★ bootstrap runner(被 spawn,jiti 载 index + runRpcMode)
│  │  ├─ agent-loader.ts                    # jiti import + AgentDefinition 归一化
│  │  ├─ agent-source.ts                    # 目录|git 源解析 + 克隆缓存
│  │  ├─ pi-rpc-process.ts                  # 自写 spawn+JSONL+extension UI
│  │  ├─ rpc-types.ts                       # 从包 d.ts 复制的协议类型
│  │  ├─ session.ts                         # PiSession (事件广播+翻译)
│  │  ├─ registry.ts                        # SessionRegistry 单例
│  │  └─ event-to-uimessage.ts              # 翻译层
├─ packages/agent-kit/                       # 可选:defineAgent() 类型帮助(给用户 index.ts 用)
│  └─ transport/pi-transport.ts             # 前端 ChatTransport
├─ components/
│  ├─ ai-elements/...                       # npx ai-elements 生成
│  ├─ chat/chat-view.tsx                    # useChat + Conversation 装配
│  ├─ chat/tool-part.tsx · reasoning-part.tsx
│  ├─ controls/model-selector.tsx · thinking-level.tsx · session-stats.tsx
│  └─ dialogs/extension-ui-dialog.tsx       # 权限/确认/输入弹窗
├─ hooks/ use-pi-session.ts · use-pi-controls.ts
├─ .env.local.example                       # ANTHROPIC_API_KEY 等
└─ package.json
```

---

## 6. 里程碑拆解

- **M0 脚手架**:`create-next-app` + Tailwind + shadcn init + `ai-elements add`;装 `pi-coding-agent`、`jiti`、`ai`、`@ai-sdk/react`;`.env` 示例;一个示例自定义 agent(`examples/hello-agent/index.ts`)。
- **M1 Agent 载入 + RPC 桥(★核心)**:`agent-source`(目录解析,git 次之)、`agent-loader`、`runner.ts`(`runRpcMode`)、`PiRpcProcess`、`SessionRegistry`;命令行验证:对示例 agent spawn runner → 发 prompt → 收到事件流。
- **M2 翻译层 + 最小闭环**:`event-to-uimessage` + `PiTransport`;前端 `useChat` + `<Conversation>/<Response>` 跑通 **选 agent 源 → prompt → 流式文本回复**(验收点)。
- **M3 工具/思考/控制**:`<Tool>` 工具卡(start/update/end)、`<Reasoning>` 思考块;模型切换、思考等级、abort、steer、session stats/成本面板;agent 注册的 `/command`(`get_commands`)。
- **M4 扩展 UI + 健壮性**:extension UI 弹窗(权限确认)、断线重连、进程清理/超时、git 源 + clone 缓存、错误与 auto-retry 状态条、会话历史恢复(`get_messages`)。

---

## 7. 风险 / 注意点

1. **不能部署到 Serverless/Edge**:子进程需跨请求驻留 → 用长驻 Node(`next start`、Docker、或自托管)。
2. **JSONL framing**:严格按 `\n` 切分、剥离尾随 `\r`,禁用 Node `readline`。
3. **extension UI 未在 `RpcClient` 暴露** → 需自写 stdio 处理(已在 3.1 决定)。
4. **协议类型未导出**:`RpcCommand/RpcResponse/...` 需从包 `dist/**/*.d.ts` 复制到本地 `rpc-types.ts`。
5. **并发与背压**:单 SSE 连接对应一个 session;多标签页需共享或限制单连接。
6. **pi 可执行定位**:依赖包的 `bin: pi → dist/cli.js`;`PiRpcProcess` 用 `require.resolve` 定位包内 `dist/cli.js` 作为 `cliPath`,避免依赖全局 `pi`。
7. **node 版本**:`engines.node >=22.19.0`,CI/部署需对齐。

---

## 8. 验收标准(MVP = 完成 M2)

- 指定一个**含 `index.ts` 的目录**作为 agent 源 → 创建 session(spawn bootstrap runner,载入该自定义 agent)→ 输入 prompt → assistant 回复**逐字流式**渲染(Markdown)。
- 工具调用展示为 `<Tool>` 卡片,思考过程展示为 `<Reasoning>` 折叠块。
- 可中止(abort)、可切换模型、可看 token/成本。
- 危险操作触发权限弹窗,用户选择后 agent 继续。

---

## 9. 运行时与发行:Bun 决策

| 关注点 | 决策 | 理由 |
|---|---|---|
| **包管理 / 构建** | **Bun**(`bun install` / `bun run build`) | 快,lockfile 稳定;pi 自身也用 bun 开发 |
| **Next.js 生产服务运行时** | **Node 24**(`next start`,standalone output) | 核心依赖 `child_process.spawn`+stdio 流,Node 兼容性/稳定性最佳;Next 官方一等支持 Node |
| **pi 子进程运行时** | **Node `>=22.19.0`**(镜像 `node:24-bookworm-slim`) | pi `engines.node>=22.19.0`,官方容器化文档即用 node;有 `legacy-node20` dist-tag 说明对 node 版本敏感 |

**结论**:用 **Bun 做工具链(装包/构建)+ Node 做运行时(Next 服务与 pi 子进程)**。
不建议把 Next 生产服务器整体跑在 Bun runtime 上——`spawn`/流式/Next 内部行为在 Bun 上仍有边角差异,
对这种重度依赖子进程与长连接的服务风险偏高。若团队坚持全 Bun,可作为可选实验分支,但默认走 Node。
> pi 的可执行用 `require.resolve("@earendil-works/pi-coding-agent")` 定位包内 `dist/cli.js`,
> 以 `node dist/cli.js --mode rpc` 显式用 Node 启动,**不依赖全局 `pi` 是否存在、也不受宿主 PATH 影响**。

---

## 10. pi 资源体系支持(extensions / skills / prompt templates)

pi 把四类能力统一为 **resources**,由同一个 `ResourceLoader` 加载:**extensions**(TS 代码扩展)、
**skills**(按需加载的能力包)、**prompt templates**(`/命令` 展开为 prompt)、**themes**(仅 TUI,Web 不用)。
pi-web 从**三个层面**支持它们:

### 10.0.A 三层支持模型

**① 零配置自动发现(目录约定)** — agent 源目录就是子进程的 `cwd`,pi 自动发现:
| 资源 | 项目级(cwd) | 全局(agentDir) |
|---|---|---|
| extensions | `.pi/extensions/*.ts` | `~/.pi/agent/extensions/` |
| skills | `.pi/skills/`、`.agents/skills/`(含祖先目录至 repo 根) | `~/.pi/agent/skills/`、`~/.agents/skills/` |
| prompt templates | `.pi/prompts/*.md` | `~/.pi/agent/prompts/*.md` |
| context (AGENTS.md) | 从 cwd 向上 | `~/.pi/agent/AGENTS.md` |
> **两种模式都生效**:用户只要在仓库放 `.pi/skills/foo/SKILL.md`,无论"自定义 agent"还是"通用 CLI"模式都自动加载。
> 项目级资源需 **project trust**(首次信任目录),pi-web 在创建会话时处理信任语义。

**② `index.ts` 声明式(自定义 agent 模式)** — `AgentDefinition` 字段映射到 `DefaultResourceLoader` 覆盖项:
| AgentDefinition | → ResourceLoader / fromServices |
|---|---|
| `systemPrompt` | `systemPromptOverride` |
| `extensions: (path\|factory)[]` | `additionalExtensionPaths` / `extensionFactories` |
| `skills` | `skillsOverride` |
| `promptTemplates` | `promptsOverride` |
| `contextFiles` | `agentsFilesOverride` |
| `tools/customTools/excludeTools/noTools` | `createAgentSessionFromServices` 入参 |
| `eventBus` | 跨扩展通信(`pi.events`) |

**③ Web UI 暴露层(RPC)** — 把已加载资源呈现到前端:
- **`get_commands`**:列出全部可调用 `/命令`——`extension`(`/cmd`)、`prompt`(`/template`)、`skill`(`/skill:name`),
  含 `description` / `source` / `location` / `path`。→ 驱动 PromptInput 的 **"/" 命令面板/自动补全**。
- **`prompt` 命令做服务端展开**:前端只需把 `/skill:pdf extract` 或 `/review $args` 原样作为 message 发出,
  pi 在 RPC 侧展开 skill 内容与模板参数(`$1/$@/${1:-default}/${@:N:L}`)。**前端不实现展开逻辑**。
- **extension 命令即时执行**:`/mycommand` 即使在 streaming 中也立即执行(extension 自管 LLM 交互)。
- **extension UI 子协议**:`select/confirm/input/editor` → 前端弹窗;`notify/setStatus/setWidget/setTitle` → toast/状态条/侧栏 widget(§4 已含)。
- **开关**:`enableSkillCommands`(settings)控制是否暴露 `/skill:` 命令。

### 10.0.B 能力细节与注意点
- **skills 渐进式披露**:启动时仅 name+description 进系统提示;完整 `SKILL.md` 由模型用 `read` 按需加载,
  或用户 `/skill:name` 强制加载。pi-web 无需特殊处理,照常渲染工具调用即可。
- **复用其他 harness 的 skills**:settings `skills: ["~/.claude/skills","~/.codex/skills"]` 可直接吃 Claude Code / Codex 技能。
- **CLI 旁路加载**:`--skill <path>`(可重复,`--no-skills` 下仍加载)、`--prompt-template <path>`、`-e <ext>`、
  `--no-skills`/`--no-prompt-templates`——pi-web 可把这些作为 `spawnSpec.args` 传给子进程(通用 CLI 模式尤其有用)。
- **限制**:`get_commands` 当前返回 name/description/source/path,**未含 `argument-hint`**;若要在补全里显示参数提示,
  需读取模板文件 frontmatter 或等 RPC 增强。先实现 name+description 级补全。
- **themes 不适用**:RPC 模式 theme 方法已降级(`getAllThemes()` 返回 `[]`),pi-web 用 shadcn 自己的主题。

### 10.0.C 本地/全局扩展 + `.pi/` 路径:是否生效 & 信任门控(★ 易踩坑)

回答两个具体问题:

**Q1:本地/全局安装的扩展(`~/.pi/agent/extensions/`、`pi install` 写入的 settings)支持吗?**
→ **支持,且不受信任限制**。它们相对子进程的 **agentDir** 发现;agentDir 默认 `~/.pi/agent`,
可用环境变量 **`PI_CODING_AGENT_DIR`** 覆盖(注意:env 名由 APP_NAME 派生,是 `PI_CODING_AGENT_DIR`,**不是** `PI_AGENT_DIR`),
或 SDK `agentDir` 选项 / CLI `--agent-dir`。文档明确:trust 解析前 pi 就会加载 **user/global 扩展 + CLI `-e` 扩展 + context 文件**。
→ 通用 CLI 模式与自定义 agent 模式**都加载全局扩展**(只要 agentDir 指对)。

**Q2:`.pi/` 项目路径(`.pi/extensions`、`.pi/skills`、`.pi/prompts`、`.pi/settings.json`)工作吗?**
→ **路径定位没问题**(相对子进程 `cwd` = agent 源目录),**但受 project trust 门控,且 headless 下默认被静默忽略**:
- `--mode rpc` / `-p` / `--mode json` 等**非交互模式不弹信任提示**。
- 无已保存信任决定时,按全局 `defaultProjectTrust`(`~/.pi/agent/settings.json`):
  - **`"ask"`(默认)→ 忽略 `.pi/` 项目资源**(extensions/skills/prompts/settings/packages)
  - `"never"` → 忽略
  - `"always"` → 加载
- 覆盖手段:CLI **`--approve`/`-a`**(单次信任)、`--no-approve`/`-na`(单次忽略);或预写 `~/.pi/agent/trust.json`(按规范目录,父目录决定可继承)。
- 例外:**context 文件(`AGENTS.md`/`CLAUDE.md`)无论信任与否都加载**;**裸 `.pi` 目录不算需信任资源**。

**pi-web 的处理策略**(写入 `agent-source.ts` / spawnSpec):
- 想让 `.pi/` 项目扩展/skills/prompts 生效,**必须显式表态信任**——否则默认 `ask` 在 headless 下静默丢弃,表现为"扩展明明在却没加载"。
- 通用 CLI 模式:spawn 时加 `--approve`(单次)或在该 session 的 agentDir 设 `defaultProjectTrust:"always"`。
- 自定义 agent 模式(SDK):runner 在 `createAgentSessionServices` 的 `resourceLoaderReloadOptions.resolveProjectTrust` 回调里返回布尔,
  或用 runtime factory 的 `projectTrustContext` 控制。
- ⚠️ **信任 = 自动执行项目内任意扩展代码 = RCE**(§11.2)。pi-web 应把"是否信任 `.pi/`"做成**显式、按来源**的策略(可信来源 + 沙箱内才 `--approve`),而非无脑全开。

### 10.1 pi 扩展安装(pi packages)

pi 扩展是 **运行时加载的 TS 模块**(pi 内置 `jiti`,无需预编译),也可打包成 **pi package** 通过 npm/git 分发。

#### 10.1.1 加载机制(pi 侧)
- 自动发现目录:`~/.pi/agent/extensions/`(全局)、`<cwd>/.pi/extensions/`(项目级)。
- pi package:`pi install npm:@scope/pkg@x | git:host/user/repo@ref | https://... | <path>` → 写入 `settings.json`;
  `-l` 写项目 settings;`pi -e <src>` 仅当次临时加载;`pi list/remove/update`;TUI `/reload` 热重载。
- RPC mode 同样生效:启动时把扩展/包通过 CLI 参数传给子进程(`--mode rpc -e <src...>`),
  或预先 `pi install` 到该 session 的 agent-home,再 spawn。

#### 10.1.2 Web UI 暴露的扩展管理(后端 route)
| Method & Path | 作用 | 实现 |
|---|---|---|
| `GET  /api/extensions` | 列出已安装(全局/项目) | `pi list` 或读 `settings.json` |
| `POST /api/extensions` | 安装(`{ source }`) | shell out `pi install <source>`,**带白名单校验** |
| `DELETE /api/extensions/:id` | 卸载 | `pi remove <source>` |
| `POST /api/sessions/:id/reload` | 热重载该会话扩展 | RPC 暂无 reload 命令 → 用 `new_session`/重启子进程重载 |
| `GET  /api/sessions/:id/commands` | 列出扩展注册的 `/command` | RPC `get_commands` |

> 扩展安装影响 `settings.json`,**新建会话**即自动加载;已有会话需重启子进程或 `new_session` 生效。

#### 10.1.3 ⚠️ 扩展安装 = 远程代码执行(必须治理)
官方明确警告:扩展/包以**完整系统权限执行任意代码**。把"装扩展"开放给 Web 用户 = 把 RCE 做成功能。
生产必须满足以下**全部**:
1. **仅管理员**可安装;普通用户只能"启用/禁用"已审核条目。
2. **来源白名单 + 版本固定**(`npm:@scope/pkg@1.2.3` / git pinned ref),禁止任意 URL。
3. **`--ignore-scripts`** 安装(禁 npm 生命周期脚本);`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode(CI/非交互)。
4. 安装与运行都在**沙箱/容器内**(见 §11),与宿主、与其他租户隔离。
5. 安装审计日志(谁、何时、装了什么源)。

---

## 11. 生产部署(Production)

### 11.1 拓扑约束:有状态 + 长连接
- 每个会话 = 1 个常驻 pi 子进程(持有 LLM 上下文 + 工具执行),**进程存活于某一实例内存**。
- → **不能 Serverless/Edge**;**横向扩容必须按 `sessionId` 做 sticky routing(会话亲和)**,否则 SSE/命令会打到没有该子进程的实例。
- 用 `next build` 的 **standalone output** + 长驻 Node 服务(Docker/K8s)。

### 11.2 安全沙箱(最高优先级)
**两类任意代码执行风险**,生产**绝不能在宿主裸跑**:
1. **agent 源 `index.[js|ts]`**:载入即执行用户代码(jiti),等同 RCE——与扩展同级(§10.3)。来源必须可信/沙箱化。
2. **pi 工具**(bash/write/edit)默认**全权限**。

按隔离强度选型:

| 方案 | 隔离粒度 | 适用 | 取舍 |
|---|---|---|---|
| **每会话独立容器**(本服务 spawn 进容器 / 或每会话一个 sidecar) | 进程级文件系统/网络 | 多租户 SaaS | 启动开销、编排复杂 |
| **Gondolin 微 VM**(pi 扩展) | VM 级,工具路由进 VM | 强隔离 + 宿主保管 auth | 需 QEMU、node>=23.6 |
| **OpenShell 沙箱** | 策略化(FS/网络/凭据/推理) | 托管/远程沙箱 | 需 gateway;可让 API key 不进沙箱 |

最低要求:限定 `cwd` 工作区、`protected-paths`/`permission-gate` 扩展拦危险操作、容器只读根 + 可写工作卷、禁出网或按需放行。

### 11.3 子进程生命周期与资源
- **并发上限**:全局 + 每租户最大会话数;超限排队/拒绝。
- **空闲回收**:N 分钟无活动 → `stop()` + 清出 registry;进程崩溃 → 广播错误事件、清理、可选自动重建。
- **资源限额**:每会话容器/进程的 mem/CPU(cgroups)、bash 超时、输出截断(pi 已支持 `fullOutputPath`)。
- **优雅停机**:`SIGTERM` → 停止接新会话 → 通知前端 → `stop()` 所有子进程 → 关闭 SSE。
- **僵尸防护**:`spawn` 设 `detached:false`,父退出连带清理;监控 stderr 与 exit code。

### 11.4 密钥与多租户
- provider API key 经 `env` 注入子进程;**不要挂载宿主 `~/.pi/agent`**(会暴露 auth/session)。用 secret manager + 每容器注入。
- 每租户/用户:独立 `PI_CODING_AGENT_DIR`(隔离 settings/扩展/session)、独立 `cwd`、独立 auth。
- Web 应用自身需鉴权(谁能建会话、会话归属、跨用户隔离)。OpenShell 推理路由可让原始 key 不落沙箱。

### 11.5 网络 / 反向代理(SSE)
- nginx/ingress 关闭代理缓冲(`proxy_buffering off` / 响应头 `X-Accel-Buffering: no`)。
- 长超时(`proxy_read_timeout` 大)、HTTP/1.1 keep-alive、禁压缩 SSE、定时 heartbeat 注释帧防中断。

### 11.6 镜像 / 依赖
- 基础镜像 `node:24-bookworm-slim`;装 pi 工具所需 `git`、`ripgrep`、`bash`、`ca-certificates`。
- `bun install --frozen-lockfile`(或 npm ci)装应用依赖;`pi-coding-agent` 作为依赖随应用安装。
- 会话 JSONL 持久化挂卷;无需持久化时启动传 `--no-session`。

### 11.7 可观测性 / 计费
- 采集每会话 token/cost(RPC `get_session_stats`)用于配额/计费/限流。
- 结构化日志:会话生命周期、扩展安装审计、子进程 stderr、auto-retry/compaction 事件。

---

## 12. 风险更新(汇总 §7 + 新增)
- **双模式**:有 `index.[js|ts]` → 自定义 agent(`runRpcMode`);无 → 通用 pi CLI(`pi --mode rpc`)。两者同协议,前后端复用(§3.0.0)。
- **agent 源 = 任意代码执行**(jiti 载入 index.ts),与扩展同级 RCE,来源必须可信/沙箱(§11.2)。
- 扩展安装 = RCE,必须管理员 + 白名单 + 沙箱(§10.3)。
- pi 工具默认全权限,生产必须沙箱化(§11.2)。
- 有状态长连接 → sticky routing,不能无状态扩容(§11.1)。
- Bun 仅用于工具链,运行时坚持 Node(§9)。

---

## 13. 开放性与集成(SDK / 协议 / 组件 / 扩展点)

设计原则:**pi-web 不只是一个 app,而是一组分层、可单独取用的库**——从"纯协议"到"整页拖入",
让它能被任意 Web 项目按需集成,并在每一层留扩展点。Monorepo 拆包发布。

### 13.1 npm 包矩阵(分层,各层可单独依赖)

| 包 | 运行环境 | 职责 | 主要导出 |
|---|---|---|---|
| **`@blksails/protocol`** | 同构(types) | 协议契约:RPC 类型、SSE 事件、UIMessage data-part schema、REST DTO | 纯 TS 类型 + zod schema,**零运行时依赖** |
| **`@blksails/agent-kit`** | Node(用户写 agent) | `defineAgent()` 类型帮助,给用户 `index.ts` 用 | `defineAgent`, `AgentDefinition` 类型 |
| **`@blksails/server`** | Node | 无框架后端引擎(spawn/桥/registry/源解析) | `PiRpcProcess`, `PiSession`, `SessionRegistry`, `AgentSourceResolver`, `createPiWebHandler`, `defineSandboxProvider` |
| **`@blksails/react`** | 浏览器 | headless React 层(hooks + transport),无样式 | `PiProvider`, `usePiSession`, `usePiControls`, `useExtensionUI`, `PiTransport`, `createPiClient` |
| **`@blksails/ui`** | 浏览器 | shadcn/AI-Elements 组件,有样式 | `<PiChat>` 及细粒度组件;同时发 **shadcn registry**(`npx pi-web add chat`) |
| **`@pi-web/embed`** | 浏览器 | 非 React 集成:Web Component + iframe widget | `<pi-web-chat>` 自定义元素、`mountPiChat(el, opts)` |
| **`pi-web`(app)** | Node | 开箱即用的 Next.js 整站(消费上面所有包) | 可部署产品 / 参考实现 |

> 依赖方向:`protocol` ← 所有;`server` 仅依赖 `protocol`;`react` 依赖 `protocol`(+ AI SDK);`ui` 依赖 `react`。
> 这样后端可独立于前端,前端可独立于框架,协议可独立于实现。

### 13.2 语言无关的 HTTP/SSE 协议(最底层开放面)
`@blksails/server` 暴露的 REST + SSE(§3.3 的接口)**本身就是稳定契约**,任何语言/框架可直接对接,
不需要用我们的前端。`@blksails/protocol` 提供 OpenAPI + SSE 事件 schema。核心面:
- `POST /sessions`、`GET /sessions/:id/stream`(SSE)、`POST /sessions/:id/{messages,steer,abort,...}`、
  `POST /sessions/:id/ui-response`、`GET /sessions/:id/{state,stats,messages,commands}`。
- SSE 帧两类:**UIMessage chunks**(text/reasoning/tool/data-part,直接喂 AI SDK)+ **旁路控制事件**(extension UI、queue、stats、error)。
- `createPiWebHandler(opts)` 返回标准 **Web Fetch `(req: Request) => Promise<Response>`**,可挂载到:
  Next.js Route Handler、Hono、Express(adapter)、Cloudflare-style runtime(注意子进程约束,见 §11.1)。

### 13.3 集成方式矩阵(嵌入到其它 Web 项目)

| 方式 | 适用 | 怎么做 | 集成度/控制力 |
|---|---|---|---|
| **A. 组件级(React)** | React/Next 项目 | 装 `@blksails/react`+`@blksails/ui`,`<PiChat sessionUrl=.../>`;后端挂 `@blksails/server` | 最高,主题/布局自定义 |
| **B. Headless hooks** | 已有自研 UI 的 React 项目 | 只装 `@blksails/react`,用 `usePiSession`+`PiTransport` 接自己组件 | 高,UI 全自控 |
| **C. Web Component / iframe** | 非 React(Vue/Svelte/纯 HTML/后台系统) | `@pi-web/embed`:`<pi-web-chat src endpoint token>` 或 `<script>`+`mountPiChat()` | 中,样式靠 CSS 变量/部件穿透 |
| **D. 纯协议** | 任意栈(Python/Go 前端) | 只用 `@blksails/server` 的 REST/SSE,自建 UI | 后端复用,前端自建 |
| **E. 整站** | 想直接要产品 | 部署 `pi-web` app,配置 agent 源 | 开箱即用 |

### 13.4 pi-web 自身的扩展点(区别于"pi 扩展")

**(1) 后端可插拔(`@blksails/server` 选项 / 中间件):**
- `authResolver(req) → { userId, tenantId } | 401`:鉴权与多租户归属。
- `authorizeSession(ctx) → boolean`:谁能对某 session 发命令。
- **`agentHostProvider`**(★,原 `sandboxProvider` 泛化):可插拔的"agent 跑在哪 + RPC 通道怎么连"。
  接口返回一个 **传输无关的 `PiRpcChannel`**(`{ send(line), onLine(cb), close() }`)+ 生命周期句柄,
  把"本地子进程 + 本地管道"的假设抽掉。内置实现:`local`(child_process + pipe)、`docker`(每会话容器)、
  `gondolin`/`openshell`;**为未来预留**:`e2b`(远程 microVM,stdio 走 e2b SDK 流)、`ssh`/`device`(远程主机/设备守护进程,
  RPC 走反向隧道/WebSocket)。`PiRpcProcess` 退化为 `local` 实现之一(见 §14.1)。
- `sourceResolver` 插件:扩展 agent 源类型(除 dir|git 外,如 `s3:`、内部 registry)。
- `trustPolicy(source) → "always"|"never"|"ask"`:把 §10.0.C 的信任策略外置(按来源决定)。
- `onAudit(event)`:会话/扩展安装/命令的审计钩子。
- `eventInterceptors`:在事件转发前改写/过滤(脱敏、注入)。

**(2) 事件→UI 翻译可扩展:**
- `registerEventTranslator(piEventType, fn)`:把自定义 pi 事件/扩展 widget 映射成自定义 `data-*` UIMessage part。

**(3) 前端渲染器注册表(★ 打通 pi 扩展的自定义工具/部件 → 自定义 React UI):**
- `registerToolRenderer(toolName, Component)`:某 pi 扩展注册的 `customTool` → 用你给的卡片渲染(而非默认 `<Tool>`)。
- `registerDataPartRenderer(type, Component)`:渲染自定义 data-part(对应 extension `setWidget`/`setStatus`/`notify`)。
- `slots`:`<PiChat>` 暴露 header/footer/sidebar/messageActions 等插槽。
- 主题:全部走 shadcn CSS 变量,继承宿主项目主题。

**(4) Agent 侧(已有,见 §3.0.2 / §10):** 用户用 `@blksails/agent-kit` 的 `defineAgent()` 定义 model/tools/customTools/extensions/skills/prompts——这是"扩展 agent 能力"的主入口,与 pi 原生扩展体系完全一致。

### 13.5 版本与稳定性
- `@blksails/protocol` 语义化版本即兼容契约;SSE 帧带 `protocolVersion`,前后端协商。
- pi 协议本身随 `@earendil-works/pi-coding-agent` 演进 → `@blksails/server` 锁定/适配 pi 版本范围,对上层屏蔽差异。

---

## 14. 未来演进:pi cloud(多 agent 管理 / e2b / edge / 设备主机)

> 目标形态:基于 pi-web 的开放层,构建一个 **pi cloud**——多 agent 切换与管理、e2b 等云沙箱、
> edge 部署、纳管前沿设备与主机系统。**本节不实现,只锁定现在必须保留的"接缝",避免日后推倒重来。**

### 14.1 必须现在就预留的三道接缝(否则未来重构成本极高)

**① 传输无关的 RPC 通道(`PiRpcChannel`)** —— 现在 `PiRpcProcess` 写死"本地 child_process + 管道"。
必须把它收敛到一个接口 `PiRpcChannel { send(line); onLine(cb); close(); health() }`,`PiRpcProcess` 只是 `local` 实现。
未来 e2b / ssh / device / websocket 只是同接口的另一实现。**M1 就按接口写**,代价几乎为零,收益巨大。

**② 外置化的会话路由(`SessionStore` / `SessionRouter`)** —— 现在 `SessionRegistry` 是单机内存 `Map`。
抽象出 `SessionStore`(session → 宿主位置/host handle)接口,单机用内存实现,未来云上换 Redis / Durable Object,
解决跨节点 sticky routing(§11.1 的会话亲和从"哪个 Node 实例"变成"哪个 sandbox/设备")。

**③ 控制面 / 数据面分离** —— pi-web 当前把两者合在一个 Node 服务。未来:
- **控制面**:agent 目录(catalog)、鉴权/多租户、路由、计费、设备纳管——可无状态、可上 edge。
- **数据面**:到 agent 宿主的 RPC 通道(SSE/命令转发)——有状态,但状态在**宿主**(sandbox/设备)里,不在网关。
现在 `createPiWebHandler` 的内部就按"网关只转发、状态在 channel 背后"组织,边界清晰即可。

### 14.2 多 agent 管理(在 §13 之上加一层 orchestration)
- 新增 `AgentCatalog`(在 `@blksails/server` 之上,可能是 `@pi-web/cloud`):多个 `AgentDefinition`/源的注册、版本、权限、分享。
- UI:agent 切换器 + 多会话(fleet)面板;一个用户对多 agent、多 host 并发会话。
- pi 已具备的基元可复用:`new_session`/`fork`/`clone`/`switch_session`、`get_session_stats`(计费)、`set_session_name`。

### 14.3 e2b / 云沙箱
- 作为 `agentHostProvider` 的 `e2b` 实现:每会话开一个 e2b sandbox,在其中 `pi --mode rpc` 或 runner,
  RPC JSONL 经 e2b SDK 的 process stdio 流桥接到 `PiRpcChannel`。
- 取舍:冷启动延迟与成本 → 需 sandbox **池化/预热**、空闲回收、按会话计费(§11.7 的 stats 正好用)。
- 收益:把 §11.2 的隔离与 §11.4 的密钥问题外包给 e2b;原始 key 可不落沙箱(类 OpenShell 推理路由)。

### 14.4 Edge 部署模式(化解 §11.1 的矛盾)
- §11.1 说"有状态子进程 → 不能 edge"。**化解办法 = 控制面/数据面分离(§14.1③)**:
  edge 只跑**无状态网关**(鉴权、路由、SSE 代理),agent 真正跑在远端 sandbox(e2b)或设备/主机里。
- 于是 edge 函数本身无状态、可水平扩;sticky 由 `SessionRouter`(外置 store)解决,路由到正确的宿主。
- 注意:edge runtime 不能 spawn 子进程,所以 edge 模式下 `agentHostProvider` **必须是远程类**(e2b/ssh/device),不能是 `local`。

### 14.5 纳管前沿设备 / 主机系统
- agent 宿主 = 已注册的远程机器/设备:设备侧跑 pi(`--mode rpc`/runner)+ 一个**反向隧道/WS 守护**回连 cloud。
- 这是一套独立的**设备控制面**:注册/enrollment、心跳、反向隧道、凭据下发、健康与版本管理——范围很大,属 pi cloud 专项。
- 复用点:pi 的 `ssh` 扩展示例、OpenShell 远程 gateway、容器化文档(§11)的工具路由思想;RPC 通道仍是同一套(§14.1①)。

### 14.6 诚实的风险/取舍(避免乐观主义)
- **edge + 有状态 agent 本质困难**:分离后多了一跳路由与延迟;SSE 经 edge 长连接对部分 edge 平台有超时/连接数限制。
- **远程宿主冷启动与成本**:e2b/设备连接的建链延迟、池化复杂度、断连恢复(会话状态在远端,需重连而非重建)。
- **设备纳管是大工程**:安全(反向隧道鉴权、最小权限)、运维(离线/版本漂移)、合规——不可低估。
- **结论**:M0–M4 仅落地 `local`/`docker` provider + 单机内存 store,但**按 §14.1 的三个接口写**;
  `e2b`/`edge`/`device` 作为后续独立里程碑(M5+),不阻塞 MVP。

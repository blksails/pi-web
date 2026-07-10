# 20 · 术语表

pi-web 全链路术语速查——每条给出 1–3 句定义并交叉链接到详述章节。

---

## A

### Agent Source（agent 源）

agent 载入的入口描述，可以是**本地目录**（绝对路径）或 **git 源**（解析拉取后落为本地目录）。源解析器（`agent-source-resolver` spec）完成三件事：解析目录或 git → 本地工作目录；探测入口（`index.[js|ts]`）；结合信任策略生成 `SpawnSpec`（子进程怎么起）。

详见 [02 · 核心概念](./02-core-concepts.md)、[08 · Agent 开发](./08-agent-development.md)。

### AgentDefinition

自定义 agent 的**静态声明结构**，由 agent 的 `index.ts` default export 提供（也可以是返回该结构的工厂函数）。关键字段包括 `model`、`systemPrompt`、`customTools`、`noTools`、`extensions`、`allowExtensions`、`skills`、`scopedModels` 等。runner bootstrap 载入后经 `loadAgentDefinition()`（`packages/server/src/runner/agent-loader.ts`）归一化为统一运行时工厂。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…", noTools: "builtin" });
```

详见 [08 · Agent 开发](./08-agent-development.md)。

### agentHostProvider（规划中 / 未实现）

**规划中的接口隔离点**，意图抽象"如何 spawn agent 子进程"。当前代码中**尚未落地**该工厂——传输接缝由已实现的 `PiRpcChannel`（local 实现 `PiRpcProcess`，本机 `child_process` spawn）承担；`agentHostProvider` 见 `.kiro/steering/roadmap.md` 与 [25 · 路线图](./25-roadmap.md)，是为 docker / e2b / ssh / device 等远程 host 预留的工厂层。详见 [03 · 系统架构](./03-architecture.md)、[25 · 路线图](./25-roadmap.md)。

### att\_\<id\>（附件公开 id）

`AttachmentStore.put()` 铸造的全局唯一附件标识，格式为 `att_` + 16 字节 `randomBytes` base64url 编码（`mintAttachmentId()` — `packages/server/src/attachment/id.ts`）。历史记录与 LLM context 中**只存 `att_<id>` 引用**，base64 仅在两个具名出口短暂物化（喂 LLM vision、工具读取）。

详见 [09 · 附件系统](./09-attachment-system.md)。

### Artifact / Artifact iframe（Tier 4）

WebExtension 可在 `.pi/web/dist/` 声明一个独立 HTML 表面（`artifact.entry`），宿主以 `<iframe sandbox="allow-scripts">` 加载——不含 `allow-same-origin`，iframe 获得不透明 origin，无法访问宿主 cookie/DOM/凭证。双向通信经 `postMessage`，消息类型由 `@blksails/pi-web-protocol` 的 `ArtifactMessage` 约束。挂载门控：**必须设置 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`**，否则 `ArtifactSurface` 不渲染。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## B

### BlobStore（对象存储端口）

附件系统 **L0 层**的可插拔存储接口（`packages/server/src/attachment/blob-store.ts`），定义 put / get / stream / delete / exists 五个能力 + `BlobNotFoundError`。当前实现为 `LocalFsBlobBackend`（落盘 `$PI_WEB_ATTACHMENT_DIR`），接口为 S3 风格，便于未来切换对象存储后端。

详见 [09 · 附件系统](./09-attachment-system.md)。

### bootstrap runner（bootstrap 启动器）

自定义 agent（custom 模式）的子进程入口脚本：`packages/server/runner-bootstrap.mjs`（纯 ESM，无需 jiti 启动自身）。它创建 jiti 实例，加载 `src/runner/runner.ts`，经 `parseRunnerArgs` 解析参数、`loadAgentDefinition` 归一化 agent、`createAgentSessionRuntime` 构建会话，最终进入 `runRpcMode` 永不返回的 RPC 循环。

详见 [08 · Agent 开发](./08-agent-development.md)。

---

## C

### CompletionProvider（补全提供者）

触发符驱动的**补全注册框架**（`completion-provider-framework` spec）。以 `@` 为例，`AttachmentCompletionProvider` 在 `packages/server/src/completion/providers/attachment-provider.ts` 注册，返回本会话已有附件列表；token 形态 `@attachment:<id>`，提交时解析为规范引用标记。开发者可注册自定义 provider 接入同一补全端点。

详见 [09 · 附件系统](./09-attachment-system.md)、[10 · 扩展与 Skills](./10-extensions-and-skills.md)。

### createPiWebHandler

`@blksails/pi-web-server` 导出的**框架无关 HTTP 处理函数工厂**（`packages/server/src/http/create-handler.ts`），`createPiWebHandler(opts)` 返回类型为 `PiWebHandler = (req: Request) => Promise<Response>`（Web Fetch API）。Next.js catch-all 路由仅把标准 `Request` 无损转发给它，原样返回含 SSE `ReadableStream` body 的 `Response`，不重写 status/headers/body，不缓冲。app 把它挂在 `/api/**` 下，handler 内部路由为 `/sessions/**`、`/config/**`（经 `sse.basePath:"/api"` 去前缀）。这使得后端引擎理论上可挂到任何支持 Web Fetch 的运行时，而不绑定 Next.js。

详见 [03 · 系统架构](./03-architecture.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

### 贡献点（ContributionPoints）

WebExtension Tier 3 能力，声明于 `defineWebExtension({ contributions: { slash, mention, keybindings, … } })`。slash 命令补全、@mention 候选、快捷键绑定——贡献点行为由扩展代码实现，经 **UI↔Agent RPC 总线**（`POST /api/sessions/:id/ui-rpc`，handler 内部路由为 `/sessions/:id/ui-rpc`）回调 agent 进程取结果。需要扩展声明 `capabilities: ["contributions"]`，且宿主在会话空闲时自动开启 `openControlOnlyStream`。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## D

### defineAgent

`@blksails/pi-web-agent-kit` 导出的**恒等辅助函数**，运行时原样返回入参，仅为编译期类型推断服务。不使用此包写出的等价 `AgentDefinition` 对象同样能被 runner 载入。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…" });
```

详见 [08 · Agent 开发](./08-agent-development.md)、[05 · 包结构](./05-packages.md)。

### 双模式载入（Dual-mode）

pi-web 载入 agent source 的两种模式，但**对外使用同一套 RPC 协议**：

| 模式 | 触发条件 | spawn 目标 |
|------|----------|------------|
| **custom** | 源目录有 `index.[js\|ts]` | `runner-bootstrap.mjs` → jiti → `runRpcMode` |
| **cli** | 源目录无入口 | `pi --mode rpc` |

两种模式底层 RPC 实现完全相同，前后端桥接完全复用，仅 spawn 目标不同。详见 [02 · 核心概念](./02-core-concepts.md)。

---

## E

### 事件 → UIMessage 翻译层

后端将 agent 子进程发出的 RPC 事件（文本增量、思考块、工具调用、工具结果……）转换为 AI SDK v5 的 `UIMessage` data-part，再经 SSE 推给浏览器 `useChat` 的**前后端枢纽**。后端 RPC 桥用对真实子进程的集成测试保障；前端翻译层是纯函数，用单元测试覆盖。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### extension UI 子协议

agent 子进程在执行过程中可经 RPC 发起 `extension_ui_request`（confirm / select / input / editor），这条 `RPC frame → PiSession.ControlStore.extensionUiQueue → SSE control 帧 → 前端 useExtensionUI → PiInteraction 内联卡片 → ui-response → 后端出队` 的完整链路即为扩展 UI 子协议。pi SDK 自带的 `RpcClient` 不暴露此子协议，这是 pi-web 自写 `PiRpcProcess` 的核心原因之一。

详见 [10 · 扩展与 Skills](./10-extensions-and-skills.md)、[02 · 核心概念](./02-core-concepts.md)。

---

## F

### formSchema / 表单 IR（Form IR）

配置 UI 的归一化中间表示，由 `FormSchema` + `FieldDescriptor[]` 构成（`packages/protocol/src/config/form-schema.ts`）。任何来源（zod schema、JSON Schema、手写）都先经适配器转为 `FormSchema`，渲染层 `<SchemaForm>` 只认此 IR，实现来源与渲染的解耦。`FieldDescriptor.widget` 字段允许指定自定义渲染器（如 `"providerSelect"`），通过 `FieldRegistry` 注册表分派。

```ts
// GET /api/config/:domain 返回:
{ formSchema: FormSchema, values: Record<string, unknown>, protocolVersion: string }
```

详见 [13 · 配置 UI](./13-config-ui.md)。

---

## J

### jiti

运行时 TypeScript/ESM 加载器。bootstrap runner 通过 `createJiti()` 创建实例，直接在子进程内 import 用户 `index.ts`，无需预编译。jiti 根锚定在 `@blksails/pi-web-server` 包目录，保证 pi SDK 等依赖从正确位置解析。

详见 [08 · Agent 开发](./08-agent-development.md)、[03 · 系统架构](./03-architecture.md)。

### JSONL framing（JSONL 帧协议）

`PiRpcProcess` 与 agent 子进程之间的进程间通信格式：每条消息为 JSON 对象序列化后以 `\n` 结尾的一行。严格按 `\n` 切割并剥除 `\r`，**禁用 Node `readline`**——因为 readline 会将 `U+2028`（LS）和 `U+2029`（PS）当行分隔符，破坏 JSON 内嵌的这两个字符。

消息分三类：`response`（命令应答）、`event`（流式事件）、`extension_ui_request`（扩展 UI 请求）。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

---

## K

### Kiro（steering / spec）

Kiro 是 pi-web 项目采用的**规格驱动开发（Spec-Driven Development）框架**。

- **Steering**（`.kiro/steering/`）：项目级 AI 引导文件（`product.md`、`tech.md`、`structure.md` 等），在所有会话中作为持久上下文加载，约束 AI 行为。
- **Spec**（`.kiro/specs/<feature>/`）：单个特性的正式规格，包含 `requirements.md`（需求）、`design.md`（设计）、`tasks.md`（任务）、`evidence/`（验收证据）。开发遵循需求 → 设计 → 任务三阶段审批流，每阶段人工确认后再进入下一阶段。

详见 [CLAUDE.md](../../CLAUDE.md)。

---

## L

### L0 / L1 / L2 / L3（附件分层）

附件系统的四层架构：

| 层 | 名称 | 核心职责 |
|----|------|----------|
| L0 | 对象存储 | `BlobStore`（`LocalFsBlobBackend` / S3-ready）字节落盘/读取 |
| L1 | 描述符与公开 id | `AttachmentStore` 门面铸造 `att_<id>`，`AttachmentRegistry` 持久化描述符 |
| L2 | resolve 投影 | `resolveAttachment()` → `AttachmentHandle`（`bytes/stream/localPath/url`） |
| L3 | context 闸门 | `beforeToolCall` 属主校验 + `afterToolCall` base64 剥离；由 `wireAttachmentBridge()`（`packages/server/src/runner/attachment-wiring.ts`）组合进 pi `agent.beforeToolCall`/`afterToolCall` |

详见 [09 · 附件系统](./09-attachment-system.md)。

---

## O

### openControlOnlyStream

当 WebExtension 需要 `ui-rpc` 回调（声明了 `contributions`，或带 Artifact 且配置了 base URL，即 `needsIdleControl = hasContributions || hasArtifactRpc`）且会话**处于空闲状态**（`!isBusy`）时，宿主自动开启的专用 SSE 下行连接，用于接收 `ui-rpc` 响应的 control 帧。per-prompt 消息流发出期间此连接关闭（由消息流接管），避免并发冲突。源见 `packages/ui/src/chat/pi-chat.tsx:400-410`。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## P

### PiRpcChannel

**传输无关的 RPC 通道接口**（`packages/server/src/rpc-channel/`），三个方法：

```ts
interface PiRpcChannel {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  close(): void;
}
```

当前 local 实现为 `PiRpcProcess`（基于 `child_process` spawn）；接口设计为 e2b / ssh / device 等远程 host 预留替换空间。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### PiRpcProcess

`PiRpcChannel` 的 **local 实现**，包装 Node `child_process.spawn`，经 JSONL framing 处理三类消息（`response`、`event`、`extension_ui_request`）。pi-web 自写此类而非使用 SDK 内置 `RpcClient`，原因是 SDK 版本写死 spawn `pi` 且不暴露扩展 UI 子协议。

详见 [03 · 系统架构](./03-architecture.md)。

### protocolVersion

`@blksails/pi-web-protocol` 包导出的**语义化版本字符串**，随每条 SSE 帧携带。客户端可据此检测版本兼容性（`PiProtocolVersionError`）。协议类型/schema 的任何改动都需遵循语义化版本管理。

详见 [05 · 包结构](./05-packages.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## R

### renderer / 渲染器（Tier 2）

WebExtension 在 `defineWebExtension({ renderers: { tools: {…}, dataParts: {…} } })` 中注册的**自定义卡片渲染组件**，按 per-session 命名空间隔离，多扩展互不覆盖。宿主收到匹配的 `tool-*` 或 `data-*` part 时调用对应渲染器。真实 dev 环境需 LLM 实际调用工具才触发；可用 `PI_WEB_STUB_AGENT=1` 离线验证。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

### resolve 投影（L2）

`resolveAttachment(store, id)` 返回 `AttachmentHandle`，提供对附件四种访问方式：

```ts
handle.bytes()      // 整块字节（小文件）
handle.stream()     // ReadableStream（大文件）
handle.localPath()  // 本地路径（LocalFs 后端，零拷贝）
handle.url()        // HMAC 签名分发 URL（跨进程安全）
```

子进程内经 `createChildAttachmentStore(process.env)` 实例化同一后端，不回调主进程。

详见 [09 · 附件系统](./09-attachment-system.md)。

### runRpcMode

pi SDK（`@earendil-works/pi-coding-agent`）导出的函数，在 agent 子进程内启动**永不返回的 RPC 循环**：监听 stdin JSONL 帧、路由 `command` / `run` / `get_commands` 等请求、将流式事件写到 stdout。custom 模式和 cli 模式均复用同一 `runRpcMode` 实现，这是两种模式协议完全兼容的技术基础。

详见 [08 · Agent 开发](./08-agent-development.md)、[02 · 核心概念](./02-core-concepts.md)。

---

## S

### Session（会话）

一个会话 = **一个常驻 agent 子进程 + 一条 SSE 长连接**。`POST /api/sessions` 建会话，返回 `sessionId`；`PiSession`（`session-engine` spec）负责事件广播、生命周期管理与扩展 UI 挂起表。会话状态绑定在某台进程驻留的实例上，这是 pi-web **不能 Serverless/Edge** 且横向扩容需 sticky routing 的根本原因。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### SessionStore

活动会话注册表接口（`packages/server/src/session/session-store.ts`），默认实现为 `InMemorySessionStore`——以 `sessionId` 为键的 `Map`，挂在 `globalThis`（`Symbol.for("@blksails/pi-web-server:InMemorySessionStore")`）以抗 dev 热重载。接口外置，为未来 Redis / Durable Object 等分布式后端预留接缝。

> 注意：这与会话历史**持久化**层 `SessionEntryStore`（`packages/server/src/session-store/`，`fs` / `sqlite` / `postgres` 三后端，由 `SESSION_STORE` 环境变量选择，默认 `fs`）是两个不同抽象，勿混淆。

详见 [03 · 系统架构](./03-architecture.md)。

### 插槽（Slots）

WebExtension Tier 1 能力，通过 `defineWebExtension({ slots: { [SlotKey]: ReactNode } })` 向宿主 19 个具名区域（`background`、`headerLeft/Center/Right`、`panelRight`、`empty`、`toolbar`、`statusBar`、`logs` 等）注入内容。插槽以**追加方式**挂载，不替换宿主内核表面。宿主未声明对应插槽时静默忽略。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

### SSE 帧（Server-Sent Events frame）

前后端通过 `text/event-stream` 协议推送流式数据的单位。每帧携带 `protocolVersion`，event 类型分为：`ui-message-chunk`（消息流）、`control`（控制帧，含 `ui-rpc` 响应、`extension_ui_request`、`stats`）等。浏览器侧 `PiSessionConnection`（`@blksails/pi-web-react`）负责解析帧并路由到 `ControlStore` 或 `useChat`。

详见 [24 · HTTP API 参考](./24-http-api-reference.md)。

### standalone（独立产物）

由 Next.js `output: "standalone"` 生成的最小化 Node 服务器包，可脱离 monorepo 源码树独立运行。`scripts/pack-standalone.mjs` 补全静态资源（`static/`、`public/`）。`next.config.ts` 的 `outputFileTracingIncludes` 显式纳入 runner-bootstrap、pi SDK、jiti 等运行时动态依赖——缺少此配置，真实会话无法启动。

CLI 构建命令：`pnpm build:cli`（`NEXT_DIST_DIR=.next-cli next build`）。

详见 [18 · CLI](./18-cli.md)、[19 · 部署](./19-deployment.md)。

### steering（引导文件）

见 **Kiro**。

### sticky routing（会话亲和路由）

横向扩容时，**同一 `sessionId` 的所有请求必须路由到同一实例**（该实例驻留对应子进程）的路由策略。nginx 以 `ip_hash` 或 `$cookie_SESSION` 实现，K8s 以 `Service.sessionAffinity=ClientIP` 或 Ingress annotation 实现。未配置时后续请求被路由到无此子进程的实例，导致 404 或静默断连。

详见 [03 · 系统架构](./03-architecture.md)、[19 · 部署](./19-deployment.md)。

### 声明式布局（Declarative Config，Tier 5）

WebExtension 无需携带任何 JS bundle，仅在 `manifest.json` 的 `config` 字段声明 `layout`（宿主 `LayoutPreset` 取 `"centered"` / `"wide"` / `"full"` / `"split"`，见 `packages/ui/src/customization/layout.ts`）、`theme`（CSS 变量）、`documentTitle`、`empty`（空态文案与 starters）等配置，宿主读取后直接应用。零代码 UI 定制的最轻量路径。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## T

### trustPolicy（信任策略）

决定一个 agent source 或项目 `.pi/` 目录下资源（skills/extensions/prompts）能否被载入的**可替换策略插件点**。取值 `"always"` 放行、`"ask"`（默认）或 `"never"` 拒绝。cli 模式经 `--approve` / `defaultProjectTrust:"always"` 放行；custom 模式经 `PI_WEB_TRUST_PROJECT` 环境变量传递信任信号。持久化实现：`FsProjectTrustStore`，读写 `<agentDir>/trust.json`（`@blksails/pi-web-server/trust` 子路径导出）。

详见 [10 · 扩展与 Skills](./10-extensions-and-skills.md)、[03 · 系统架构](./03-architecture.md)。

---

## W

### WebExtension

每个 agent source 可在 `.pi/web/` 目录携带的 **UI 控制层**，宿主在该 source 的会话激活时动态加载。入口文件 `web.config.tsx` default export 为 `defineWebExtension(…)` 的返回值，经 `pi-web build` 产出 `web-extension.mjs` + `manifest.json`（含 SRI）。宿主校验 SRI + 签名白名单 + 版本兼容后方才加载。分五层能力（Tier 1–5）：插槽、渲染器、贡献点、Artifact iframe、纯声明配置。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## 速查索引

| 术语 | 详述章节 |
|------|---------|
| Agent Source | [02](./02-core-concepts.md)、[07](./08-agent-development.md) |
| AgentDefinition / defineAgent | [07](./08-agent-development.md)、[04](./05-packages.md) |
| agentHostProvider | [03](./03-architecture.md) |
| att\_\<id\> | [08](./09-attachment-system.md) |
| Artifact iframe | [10](./12-web-ui-extension.md) |
| BlobStore / L0–L3 | [08](./09-attachment-system.md) |
| bootstrap runner | [07](./08-agent-development.md) |
| CompletionProvider | [08](./09-attachment-system.md)、[09](./10-extensions-and-skills.md) |
| createPiWebHandler | [03](./03-architecture.md)、[13](./24-http-api-reference.md) |
| 贡献点 | [10](./12-web-ui-extension.md) |
| 双模式载入 | [02](./02-core-concepts.md) |
| extension UI 子协议 | [09](./10-extensions-and-skills.md)、[02](./02-core-concepts.md) |
| formSchema / 表单 IR | [12](./13-config-ui.md) |
| JSONL framing | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| Kiro steering / spec | [CLAUDE.md](../../CLAUDE.md) |
| openControlOnlyStream | [10](./12-web-ui-extension.md) |
| PiRpcChannel / PiRpcProcess | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| protocolVersion | [04](./05-packages.md)、[13](./24-http-api-reference.md) |
| renderer（渲染器） | [10](./12-web-ui-extension.md) |
| resolve 投影 | [08](./09-attachment-system.md) |
| runRpcMode | [07](./08-agent-development.md)、[02](./02-core-concepts.md) |
| Session | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| SessionStore | [03](./03-architecture.md) |
| 插槽（Slots） | [10](./12-web-ui-extension.md) |
| SSE 帧 | [13](./24-http-api-reference.md) |
| standalone | [14](./18-cli.md)、[15](./19-deployment.md) |
| sticky routing | [03](./03-architecture.md)、[15](./19-deployment.md) |
| 声明式布局 | [10](./12-web-ui-extension.md) |
| trustPolicy | [09](./10-extensions-and-skills.md)、[03](./03-architecture.md) |
| WebExtension | [10](./12-web-ui-extension.md) |

---

## 下一步 / 相关

- 理解整体运行模型请从 [02 · 核心概念](./02-core-concepts.md) 入手。
- 查看进程边界与依赖约束：[03 · 系统架构](./03-architecture.md)。
- 开始开发自定义 agent：[08 · Agent 开发](./08-agent-development.md)。
- 开始编写 WebExtension：[12 · Web UI 扩展](./12-web-ui-extension.md)。

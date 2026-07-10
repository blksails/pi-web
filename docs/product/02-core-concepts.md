# 02 · 核心概念

这是 pi-web 的概念地图：抓住下面这几个概念，后面每一章都能对号入座。

> 本章只画地图、不深潜。凡是给了「详见」跳转的地方，都会在对应专章展开代码级细节。

## Agent Source（agent 源）

一个 **agent source** 是 pi-web 载入对象的入口描述，可以是：

- 一个**本地目录**（绝对路径），
- 一个 **git 源**（解析/拉取后落到本地目录）。

源解析（`agent-source-resolver` spec）做三件事：

1. **解析**目录或 git → 本地工作目录；
2. **入口探测**（`entry-probe.ts`）— 优先 `package.json#pi-web.entry` 覆盖，否则按 `index.ts` > `index.js` > `index.mjs` 取首个存在者；都没有则无入口；
3. **双模式判定** + 信任策略 → 生成一份 `spawnSpec`（子进程怎么起，由 `@blksails/pi-web-protocol` 定义类型）。

### 上手：把一个本地目录当 agent source

`examples/hello-agent` 是一个最小 custom agent（目录里有 `index.ts`，默认导出一个 `AgentDefinition`）。把它设为默认源起服务：

```bash
# custom 模式:examples/hello-agent 目录内有 index.ts,被判定为 custom 入口
PI_WEB_DEFAULT_SOURCE="$PWD/examples/hello-agent" pnpm dev
# 浏览器打开 http://localhost:5173,新建会话即以该源起一个常驻子进程
```

- `PI_WEB_DEFAULT_SOURCE` 由 `server/bootstrap.ts:73`（经 `lib/app/config.ts:97`）读取，缺省是 `builtin:default-agent`。
- `pnpm dev` 是 `scripts/dev-all.mjs`，并发拉起 API server（`:3000`）与 Vite dev server（`:5173`）；**开发期浏览器打开 `:5173`**，`/api` 请求由 Vite 代理到 `:3000`。
- `hello-agent` 刻意省略 `model`，会继承 `~/.pi/agent/settings.json` 的默认 provider/model —— 任意 `pi` 登录都能开箱跑通。

预期结果：选源页里出现该源，新建会话后能与 agent 对话并触发它的 `echo` 工具。

## 双模式载入（Dual-mode）

| 模式 | 触发条件 | spawn 目标 |
| --- | --- | --- |
| **custom** | 探测到入口（`index.ts/js/mjs` 或 `pi-web.entry` 覆盖） | bootstrap runner（`node <runner-bootstrap.mjs> --agent <entry> --cwd <work>`）：`jiti` 载入用户入口 → 归一化为 `AgentDefinition` → `createAgentSessionRuntime` → `runRpcMode` |
| **cli** | 源里无入口 | pi CLI：`node <piCliEntry> --mode rpc`（工作目录经 `spawnSpec.cwd` 设置，pi CLI 无 `--cwd` 标志） |

**关键决策：两模式对外是同一套 RPC 协议。** 底层 RPC 实现完全相同，前后端桥接完全复用，只是 spawn 的目标进程不同。这让 pi-web 既能跑任意自定义 agent，也能把通用 pi coding agent 当 Web 服务提供，而无需两套前端。

> custom 模式怎么写入口、归一化为 `AgentDefinition`，见 [08 自定义 Agent 开发](./08-agent-development.md)；cli 模式与全局 `pi-web` 命令行见 [18 CLI](./18-cli.md)。

## Session（会话）

一个会话 = **一个常驻 agent 子进程**。

- 建会话（`POST /api/sessions`）→ 解析源 → spawn 子进程 → 返回 `sessionId`；
- 会话期间该进程常驻，前端经 SSE 订阅其事件流；
- `PiSession`（`session-engine` spec）负责事件广播、生命周期、以及**扩展 UI 挂起表**（权限弹窗等待用户响应）。

会话注册表是 `SessionStore` 接口（`packages/server/src/session/session-store.ts:12`），默认实现 `InMemorySessionStore`（内存，同文件 `:39`），但**接口外置**——为未来 Redis / Durable Object 等分布式后端预留接缝。

> 一会话一进程 + SSE 长连接 = **有状态服务**。这是 pi-web 不能跑 Serverless/Edge、横向扩容需按 `sessionId` 粘性路由的根本原因。详见 [03 系统架构](./03-architecture.md)。

> 历史会话可在 **会话列表**里浏览并一键恢复（按 `sessionId` 重新订阅其事件流），详见 [14 会话列表](./14-sessions-list.md)。

### 会话生命周期状态（就绪握手）

子进程「已 spawn」不等于「能接收 prompt」：pi 事件流里**没有** `session_start` / `ready` 锚点，服务端一旦标记会话可用，往往早于 agent 真正能处理命令。pi-web 为此定义了一层与通道活动态（active/stopping/stopped）**正交**的**业务就绪态**：

| 生命周期态 | 含义 |
| --- | --- |
| `initializing` | 子进程已起、就绪探针尚未成功（默认初态，失败安全：未确认即不可发送）。 |
| `ready` | 就绪探针首条响应到达，agent 可接受 prompt。 |
| `error` | 探针超时 / 子进程就绪前早退，会话不可用。 |
| `ended` | 正常停止 / 就绪后子进程退出。 |

- 服务端以**只读探针 `getCommands()` 的首条响应**判定真实就绪（`packages/server/src/session/pi-session.ts:447-471`）。
- 就绪态经一条**粘性** `control: session-status` 帧广播；新订阅者订阅时会**回放当前态**，防止早期帧丢失（`packages/protocol/src/transport/session-status.ts:21-41`）。

> 前端据此决定「输入框何时可发消息」；断线重连时也靠回放拿回当前态。这是理解「会话何时可用」的基础概念。

## RPC 通道（`PiRpcChannel`）

后端核心是一条**传输无关的 RPC 通道**：

```ts
// packages/server/src/rpc-channel/pi-rpc-channel.ts
interface PiRpcChannel {
  send(line: string): void;                 // 写一行 JSONL 到下游（local 即子进程 stdin）
  onLine(cb: (line: string) => void): Unsubscribe; // 注册按行回调，返回取消订阅句柄
  close(): Promise<void>;                    // 关闭通道并干净退出
  health(): ChannelHealth;                   // 查询通道健康（alive / exitCode / signal）
}
```

- `PiRpcProcess`（`packages/server/src/rpc-channel/pi-rpc-process.ts`）是它的 **local 实现**（基于 `node:child_process` spawn）；
- `SpawnSpec`（子进程怎么起）由 `@blksails/pi-web-protocol` 拥有并导出，是单一事实来源；
- 通道抽象为未来 e2b / ssh / device 等远程 host 预留。

子进程通信用 **JSONL framing**：严格按 `\n` 切、剥 `\r`，**禁用 Node `readline`**（它会误切 `U+2028/2029`）。消息分三类：`response`（命令应答）、`event`（流式事件）、`extension_ui_request`（扩展 UI 请求，如权限弹窗）。

> pi-web **不直接用 SDK 内置的 `RpcClient`**——它写死 spawn `pi` 且未暴露 extension UI 子协议。pi-web 自写 `PiRpcProcess` 处理这三类消息。

## 两条正交的通信平面

RPC 通道之上，pi-web 有**两条彼此正交的跨进程通信平面**。建立起这个心智模型，很多设计就顺了：一条是**对话流**（聊天消息的单向渲染），另一条是**权威表面**（领域状态 + 命令的双向 CQRS 约定）。

### 平面一：事件 → UIMessage 翻译层（对话流）

这是**聊天的枢纽**。agent 子进程发出的 RPC 事件（文本增量、思考、工具调用、工具结果……）经翻译层转换为 AI SDK v5 的 `UIMessage` data-part，再经 SSE 推给浏览器的 `useChat`。

- 后端 RPC 桥用对**真实子进程的集成测试**保障；
- 前端翻译层是**纯函数**，用单元测试覆盖。

这条平面是**单向**的：agent → 浏览器，渲染一段会话消息流。

### 平面二：Surface 权威表面（领域状态 + 命令）

有些富交互 UI（如 Canvas 画布）不适合塞进聊天消息流：它需要一份**结构化领域状态**实时下行到前端，同时前端要能对该领域**发起命令**——且命令走结构化通道，**不经 LLM**。pi-web 用 **Surface 权威表面**范式承载这一场景：

- **权威快照在 agent 子进程**（单写者，CQRS）：状态经 `control: "state"` 帧下行镜像到前端（`packages/tool-kit/src/surface/create-surface.ts`）；
- **命令从前端上行**：`useSurface` hook 经 ui-rpc 通道发结构化命令给 agent 执行（`packages/react/src/hooks/use-surface.ts`）；
- 一个 `domain`（如 `canvas`）= 一份权威表面。

> 这与平面一**正交**：聊天流渲染消息，Surface 平面同步领域状态。Canvas 工作台就端到端建立在这条平面之上（`domain=canvas`）。概念足矣，`createSurface` / `wireSurfaceBridge` / `useSurface` 的完整 API 见 [04 Surface 权威表面栈](./04-surface-stack.md)。
>
> 注：pre-spec 设计草案里把这套范式称作 **AAS（Agent-Authoritative Surface）**；在 main 上它以 Surface 栈的形态实现，AAS 仅作设计词汇出现。

### 平面二的地基：状态注入桥（双向共享 KV）

Surface 之下是一条更基础的**会话级共享 KV**，权威同样在 agent 子进程：

- **下行**（agent → UI）：权威 KV 变更经 SSE `control: "state"` 帧镜像到前端，每 key 带**单调递增 `rev`**（前端据此丢弃乱序/过期帧，`packages/protocol/src/web-ext/state.ts:14-24`）；
- **写回**（UI → agent）：前端经 `POST /sessions/:id/state`（`packages/server/src/http/create-handler.ts:172`）写回，同步 ack；
- **作者面**：agent 工具内经 `getSessionState()`（seam `__piWebSessionState__`，`packages/tool-kit/src/session-state.ts:15`）读写这份状态，供**人机共读写**。

`examples/state-bridge-agent` 就是这条桥的端到端示例（AI 用 `increment`/`read_state` 工具，人在 UI 里点按钮写回，双方看同一份实时状态）。写回端点与 `control:"state"` 帧的完整契约见 [24 HTTP/SSE API 参考](./24-http-api-reference.md)，作者面用法见 [08 自定义 Agent 开发](./08-agent-development.md)。

## SSE 帧：数据帧与控制帧

前后端经 **SSE（Server-Sent Events）** 传流式数据，每帧携带 `protocolVersion`。顶层帧以 `kind` 判别两类（`packages/protocol/src/transport/sse-frame.ts`）：

- **`kind: "uiMessageChunk"`** — 数据帧，内嵌 `UiMessageChunk`（text / reasoning / tool / data-part），直接喂 AI SDK（对话流平面）；
- **`kind: "control"`** — 旁路**控制帧**，内层再以 `control` 判别。控制帧不止一类，概念上要记住这几种：
  - `session-status` — 会话就绪握手（上文生命周期态，粘性）；
  - `state` — 状态注入桥 / Surface 的权威 KV 下行镜像；
  - `ui-rpc` — Tier3 扩展 UI ↔ agent 的下行响应；
  - 另有 `error` / `queue` / `stats` / `logs` / `session-state` 等。

> 早期文档曾说「SSE 只推 UIMessage」，这是不完整的——控制帧平面同样真实广播。`@blksails/pi-web-protocol` 是稳定契约，类型/schema 改动需语义化版本管理。控制帧的**完整枚举与「哪些真实发送」**见 [24 HTTP/SSE API 参考](./24-http-api-reference.md)。

## 附件的两条路径（概念预览）

附件不进 pi 协议，全在 pi-web 层。核心是**「引用而非 base64」**：历史与 context 里只放 `att_<id>` 引用，base64 仅在两个出口物化：

1. **喂 LLM 识别**（vision）— 上传图在该出口转 base64 给模型；
2. **交 server 端 tool** — 文件经 `attachmentId` 参数在 runner 子进程内 `resolve` 为 path/url/bytes，工具产出再落库回流。

详见 [09 附件系统](./09-attachment-system.md)。

## 其它能力面（概念预览）

除了对话流与 Surface，两块大能力面在此先点一句、留跳转：

- **Web UI 扩展（5-tier）** — agent 可经声明式扩展往 Web UI 的 21 个协议插槽挂内容（从内联小组件到隔离 iframe 表面 `artifactSurface`），是 pi-web 让 agent「长出 UI」的机制。注意它与上文 Surface 平面**正交**：5-tier 讲**挂载位置**，Surface 讲**通信约定**。详见 [12 Web UI 扩展](./12-web-ui-extension.md)。
- **Canvas 工作台** — 一个二创画布编辑器（舞台缩放/平移、工具轨、掩码标注、版本条、画廊、vision「解读」按钮），建立在 Surface 平面之上（`domain=canvas`），由环境变量门控、**默认关闭**。详见 [16 Canvas 工作台](./16-canvas-workbench.md)。

## 配置目录 `~/.pi/agent`

凭据与默认值的来源：

- `auth.json` — provider 凭据（`pi` 登录后生成）；
- `settings.json` — 默认 provider/model 等；
- `models.json` — 自定义 OpenAI-compatible provider（见 [07 Provider 与模型](./07-providers-and-models.md)）。

可经 `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` 覆盖目录。注意环境变量名是 `PI_CODING_AGENT_DIR`（不是 `PI_AGENT_DIR`）。

## 三个不变式（贯穿设计）

记住这三条，很多设计决策就自洽了：

1. **单一身份** — 每个附件一个 `att_<id>`，全链路同一身份空间（含工具产出物）。
2. **先落库后引用** — 任何附件先入对象存储拿到 id，再被消息/工具引用。
3. **base64 仅具名出口物化** — 平时只传引用，base64 只在「喂 LLM」与「工具读取」两个明确出口短暂出现，以省 context。

## 下一步 / 相关

- 这些概念如何落到层与数据流上 → [03 系统架构](./03-architecture.md)
- Surface 权威表面 / 状态注入桥的完整 API 与 Canvas 实例 → [04 Surface 权威表面栈](./04-surface-stack.md)
- 提到的 `@blksails/pi-web-protocol`、`@blksails/pi-web-server` 等包边界 → [05 分层包](./05-packages.md)
- 给自己的 agent 套 UI（custom 模式入口）→ [08 自定义 Agent 开发](./08-agent-development.md)
- 附件三不变式的完整实现 → [09 附件系统](./09-attachment-system.md)
- 把通用 pi agent 当 Web 服务起（cli 模式 / `pi-web` 命令）→ [18 CLI](./18-cli.md)
- SSE 帧与控制帧的完整枚举、`POST /sessions/:id/state` 端点 → [24 HTTP/SSE API 参考](./24-http-api-reference.md)
- 不熟的名词随时查 → [26 术语表](./26-glossary.md)

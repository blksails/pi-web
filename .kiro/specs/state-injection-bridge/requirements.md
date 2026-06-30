# Requirements Document

## Introduction

pi-web 当前是「AI 对话 UI 框架」：agent 在子进程里思考、调用工具，前端把对话流式渲染出来。但它缺一条**独立于 LLM 对话历史之外的共享状态路线** —— 一份既能被工具同步读写、又能被用户在 UI 上直接操作的实时状态。

> **重要事实更正（2026-06-30 核实于真实事实源）**：pi 框架（`@earendil-works/pi-coding-agent@0.79.6`，npm 依赖，本仓无源码）**没有**原生的 `ctx.state` / `StateStore` 这类可订阅的实时可变 KV，**也没有** `__hostPlugins` / `definePlugin` 注入点。pi 原生的「context 外状态」只有 **append-only 的会话自定义条目**（`pi.appendEntry(customType, data)`，注释原文「for state persistence (not sent to LLM)」），那是持久化日志，不是实时可变共享态。早期讨论稿与需求草案曾基于一份**虚构的 pi API**，现已废止。本特性据真实能力面重新立项。

pi 0.79.6 真实能给的（已逐行核对 `dist/core/extensions/types.d.ts`）：
- `ctx.ui`：`notify/setStatus/setWidget/setTitle/setEditorText/select/confirm/input/editor/custom…`（agent→UI 的 ambient 推送 + 对话框，pi-web 已桥接到前端 `ControlStore.ambient`）。
- `ctx.sessionManager`（**只读**）、`ctx.model`、`ctx.cwd`、`isIdle()`、`signal`。
- `pi.registerTool / registerCommand / registerMessageRenderer / sendMessage / appendEntry`。

因此本特性的本质是：**pi-web 在 agent 子进程内自建一份会话级、可变、可订阅的共享状态核（KV）**，并把它双向桥接到浏览器 —— 全部经 pi-web 既有的注入与传输手段实现，**不改 pi 框架源码、不改 agent 作者的 `index.ts`**：

- **工具读写**：工具 `execute` 时经 pi-web 提供的接入点同步读写权威状态（零跨进程）。
- **UI 读写**：用户在前端改状态（点按钮、填表单、切模式），经既有命令通道写回权威状态。
- **实时同步**：状态变更经 SSE 下行帧镜像到前端，前端 hook / webext 响应式消费。

它带来的质变：pi-web 从「AI 对话 UI」演进为 **AI 原生应用运行时**。agent 是后端大脑，webext 是前端，这份共享状态核是人和 AI **共同读写的同一份实时状态层** —— 这就是「人机共驾」：用户在 UI 上拨动的开关、AI 用工具写下的进度，落在同一处、彼此实时可见。

权威副本必须在 agent 子进程内：这是 pi JSONL 协议方向性决定的硬约束（已核实 `pi-rpc-process.ts:473`，`agent → server` 只有 `event` / `response` / `extension_ui_request` 三类被分派，工具无法主动「向 server/UI pull 状态」）。状态权威若不在子进程，工具就只能靠「每轮注入」拿到它 —— 那等于进了 context，违背「context 外」初衷。

## Boundary Context

- **In scope**：
  - 单会话内全局（session-scoped global）的共享状态：一份 key→value 的结构化可变 KV，权威在 agent 子进程，由 pi-web **自建**。
  - 三条边：工具同步读写、状态变更 agent→UI 下行镜像、UI→agent 写回。
  - 前端订阅/写回的响应式 hook，以及 webext 作者侧的对外 API。
  - 不破坏现有 MCP 服务、内置/作者工具、ambient UI（`ctx.ui.*`）、会话就绪握手等既有能力。
- **Out of scope**：
  - 跨会话 / 全局单例状态、多用户共享状态。
  - 把状态自动喂进 LLM 上下文（是否喂、何时喂由 agent 作者在组装 prompt 时显式决定，本特性默认不喂）。
  - 修改 pi 框架源码或 pi SDK 协议；修改 agent 作者的业务代码。
  - 复杂的多端并发冲突合并（CRDT/OT 等）；本期以单调修订号（rev）做「后写覆盖 + 丢弃过期」的最小一致性。
  - 状态的冷恢复/落盘（可选；本期可仅内存，落盘留待后续，见 Requirement 9）。
- **Adjacent expectations**：
  - 依赖 pi 0.79.6 的真实能力面：`pi.registerTool`/`registerCommand`、`ctx.ui.*`、`ctx.sessionManager`（只读）、`pi.appendEntry`。本特性**不**依赖任何 pi 原生 `ctx.state`/`StateStore`/`__hostPlugins`（均不存在）。
  - 经 pi-web 既有的扩展注入手段把状态桥扩展装入会话（已验证范式：`forcedExtensionPaths` 强制注入，见 `auto-session-title`；或 runner 子进程装配，见 `wireAttachmentBridge`/`wireSessionTitlePersistence`）。
  - 工具接入点经 pi-web 既有的 globalThis seam 范式透给运行在子进程的工具（已验证范式：`attachment-tool-context`）。
  - agent→UI 下行复用 pi-web 既有的「自定义 JSONL 行被 session 层截获 → SSE control 帧」范式（已验证：`pi-session.ts` 的 `handleRawLine` 已在截获自定义 `ui_rpc_response` 行并转 `control:"ui-rpc"` 帧）。
  - UI→agent 写回复用 pi-web 既有的命令通道（`ui-rpc`/`ui-command`），不新增传输层。
  - 协议层新增帧/命令契约须随既有 `protocolVersion` 承载，遵循协议包 semver。

## Requirements

### Requirement 1: 人机共驾的会话状态层（纲领）

**Objective:** 作为 pi-web 应用的使用者与 agent 作者，我希望用户（经 UI）和 AI（经工具）能读写**同一份**会话级实时状态，以便把 pi-web 用作「人机共驾」的 AI 原生应用运行时，而不仅是只读对话 UI。

#### Acceptance Criteria

1. The State Injection Bridge shall 在每个会话内提供一份 key→value 的结构化、可变共享状态，其权威副本位于该会话的 agent 子进程，且不进入 LLM 对话消息历史。
2. When 工具在 `execute` 中写入某个状态 key，the State Injection Bridge shall 使该会话前端对应视图在无需用户刷新页面的情况下反映出新值。
3. When 用户在前端改写某个状态 key，the State Injection Bridge shall 使同会话工具在其后续 `execute` 中读到该新值。
4. The State Injection Bridge shall 保证该状态默认不被 LLM「看见」，仅当 agent 作者在组装 prompt 时显式纳入时才进入上下文。
5. While 某状态 key 不存在或尚未初始化，the State Injection Bridge shall 向读取方返回「未定义」语义而非报错中断。

### Requirement 2: 以纯 pi-web 手段注入（不改 pi、不改 agent 代码）

**Objective:** 作为平台维护者，我希望状态桥完全由 pi-web 自建并经既有注入手段装入，以便在不修改 pi 框架源码、不修改 agent 作者业务代码的前提下为会话启用该能力。

#### Acceptance Criteria

1. The State Injection Bridge shall 经 pi-web 既有的扩展注入或 runner 子进程装配手段装载，且不改动 pi 框架源码与 pi SDK 协议。
2. The State Injection Bridge shall 在不要求 agent 作者修改其 `index.ts` 的前提下，对启用了本特性的会话生效。
3. While agent 作者未声明任何状态用法，the State Injection Bridge shall 不改变该会话的既有行为（无多余帧、无副作用）。
4. If 状态桥注入或初始化失败，then the State Injection Bridge shall 记录可诊断的错误并让会话以「无状态桥」方式继续运行，而非使会话启动崩溃（对齐 `wireAttachmentBridge` 的优雅降级范式）。

### Requirement 3: 状态下行镜像（agent → UI）

**Objective:** 作为前端使用者，我希望 agent 侧状态的任何变更都能实时推送到浏览器，以便 UI 始终展示最新状态。

#### Acceptance Criteria

1. When agent 子进程内某状态 key 发生变更（新增/更新/删除），the State Injection Bridge shall 经 SSE 下行向该会话前端发送一条携带 `key`、`value`、单调递增 `rev` 的状态帧。
2. When 前端在会话进行中（订阅已建立后）收到状态帧，the State Injection Bridge shall 将该 key 的前端视图更新为帧中的值。
3. If 前端收到的状态帧 `rev` 不大于该 key 已应用的 `rev`，then the State Injection Bridge shall 丢弃该帧以防乱序回退。
4. The State Injection Bridge shall 使下行状态帧独立于 LLM 对话消息流，不产生对话气泡、不进入消息历史。
5. While 一次会话中状态多次变更，the State Injection Bridge shall 保证每个 key 的 `rev` 单调递增。

### Requirement 4: 状态写回（UI → agent）

**Objective:** 作为前端使用者，我希望在 UI 上的操作能写回 agent 侧的权威状态，以便用户成为状态的共同驱动方。

#### Acceptance Criteria

1. When 用户在前端发起对某状态 key 的写入，the State Injection Bridge shall 经既有命令通道（`ui-rpc`/`ui-command`）将写入请求送达 agent 子进程并更新权威状态。
2. When 权威状态因 UI 写回而变更，the State Injection Bridge shall 触发对应的下行镜像帧（满足 Requirement 3），使所有该会话前端视图收敛到同一值。
3. If UI 写回请求的目标 key 或负载不合契约，then the State Injection Bridge shall 拒绝该写入并返回可诊断的错误，且不改变权威状态。
4. The State Injection Bridge shall 复用现有命令通道的**同步 HTTP 响应体**返回写回结果，而非依赖 SSE 空闲控制流（对齐 `unified-command-result-layer` 的既有决策）。

### Requirement 5: 协议契约与 schema

**Objective:** 作为协议维护者，我希望状态帧与写回命令有明确的契约 schema，以便前后端类型一致、可演进、可校验。

#### Acceptance Criteria

1. The State Injection Bridge shall 在协议包中新增一个状态下行帧契约，至少包含 `key`、`value`、`rev` 字段，并随 SSE 帧携带既有的 `protocolVersion`。
2. The State Injection Bridge shall 定义 UI→agent 状态写回命令的契约（命令标识 + `key` + `value` 负载），且承载于既有命令通道契约之内而不另起传输协议。
3. If 收到的状态帧或写回命令不满足契约 schema，then the State Injection Bridge shall 校验失败并安全拒绝，而非以未定义行为继续。
4. The State Injection Bridge shall 保持 `value` 为传输无关的结构化数据（任意可 JSON 序列化值），不限定为纯文本。

### Requirement 6: 前端订阅与写回 hook

**Objective:** 作为前端/webext 开发者，我希望有一个与现有 `useExtensionUI` 风格一致的 hook 来读写共享状态，以便用最小心智成本接入。

#### Acceptance Criteria

1. The State Injection Bridge shall 提供一个前端 hook（如 `useExtensionState(key)`），返回该 key 的当前值与一个写入函数。
2. When 该 key 的下行状态帧到达，the State Injection Bridge shall 使订阅该 key 的组件以 React 一致的方式重渲染为新值。
3. When 调用写入函数，the State Injection Bridge shall 经 Requirement 4 的写回路径提交新值。
4. While 多个组件订阅同一 key，the State Injection Bridge shall 使它们读到一致的同一值。
5. The State Injection Bridge shall 在前端状态分片的读写上对齐既有 ambient（`ControlStore`）的实现惯例（不可变快照 + `useSyncExternalStore`），不引入与之冲突的并行状态机制。

### Requirement 7: webext 作者侧暴露

**Objective:** 作为 webext 扩展作者，我希望在 `.pi/web` 扩展代码中直接使用共享状态 API，以便构建「人机共驾」的前端控件。

#### Acceptance Criteria

1. The State Injection Bridge shall 经 webext 作者 SDK（web-kit）对外暴露读写共享状态的能力。
2. When webext 组件读写某状态 key，the State Injection Bridge shall 复用同一条下行/写回通道，行为与 Requirement 3、4 一致。
3. Where webext 信任模型（签名/白名单）对其能力做门控，the State Injection Bridge shall 使状态写回沿用与既有 webext 能力一致的门控边界，不绕过它。

### Requirement 8: 不破坏现有能力

**Objective:** 作为平台维护者，我希望新增状态桥不影响任何既有能力，以便安全上线。

#### Acceptance Criteria

1. The State Injection Bridge shall 不改变 MCP 服务、内置工具与 agent 作者工具的既有注册与执行行为。
2. The State Injection Bridge shall 不改变 ambient UI（`ctx.ui.*`）与既有 ui-rpc 贡献点的行为。
3. The State Injection Bridge shall 不破坏会话就绪握手（readiness handshake）与既有 SSE 控制帧（`queue`/`stats`/`error`/`extension-ui`/`ui-rpc`/`logs`/`session-status`）的处理。
4. While 会话未使用任何共享状态，the State Injection Bridge shall 使端到端行为与未引入本特性时一致（无额外帧、无回归）。

### Requirement 9: 测试与质量门

**Objective:** 作为质量负责人，我希望本特性具备分层测试与端到端验证，以便满足项目「每个 spec 须单测/集成测试 + e2e 且有真实运行证据」的硬规则。

#### Acceptance Criteria

1. The State Injection Bridge shall 为协议契约（状态帧 / 写回命令 schema）与前端状态分片提供纯函数/hook 单元测试。
2. The State Injection Bridge shall 提供针对真实 agent 子进程的集成测试，覆盖「工具写 → 下行帧」与「写回命令 → 工具下次读到新值」两条路径。
3. The State Injection Bridge shall 提供离线（`PI_WEB_STUB_AGENT`）浏览器 e2e，在隔离构建目录（`NEXT_DIST_DIR`）下验证双向闭环：工具改状态 → UI 视图更新；UI 点击 → 写回 → 工具读到新值。
4. The State Injection Bridge shall 通过工作区 `typecheck`（`strict`、无 `any`）。

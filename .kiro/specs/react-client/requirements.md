# Requirements Document

## Introduction

本特性交付 `@blksails/pi-web-react`——pi-web 的**无样式 headless React 层**。它面向两类用户:本项目的 `ui-components`(消费本层装配有样式组件),以及任何已有自研 UI 的第三方 React/Next 项目(只用本层、UI 全自控)。

现状是:`http-api` 已提供稳定的 REST + SSE 契约,但每个前端都要重复手写 SSE 订阅、把 SSE 帧喂进 AI SDK、调用各命令端点、管理扩展 UI 请求队列——重复且易错。本特性提供:

- `PiTransport`:实现 AI SDK v5 `ChatTransport`,让 `useChat({ transport })` 开箱即用——`sendMessages()` POST `/messages` 并把 `/stream` 的 SSE 解码为 `ReadableStream<UIMessageChunk>`;`reconnectToStream()` 断线重连。
- `createPiClient(baseUrl, fetch?)`:封装全部 REST 调用(建会话、各命令、stats、commands 列表、ui-response)。
- 一组 headless hooks:`usePiSession`(建/连会话 + 连接状态)、`usePiControls`(model/thinking/abort/steer/stats/commands)、`useExtensionUI`(扩展 UI 请求队列,冒泡给上层弹窗)。
- 旁路 control 帧(extension-ui / queue / stats / error)分流到 hooks,**不污染** `useChat` 的消息流。

本特性运行于浏览器环境,仅依赖 `@blksails/pi-web-protocol`(契约类型/schema)、AI SDK(`ai` / `@ai-sdk/react`)与 `http-api` 暴露的 HTTP/SSE 契约,**不依赖任何后端实现细节**。

## Boundary Context

- **In scope(本特性负责)**:
  - AI SDK v5 `ChatTransport` 实现(`PiTransport`):POST 发 prompt + 把 SSE 解码为 `UIMessageChunk` 可读流 + 断线重连。
  - SSE 帧分流:`uiMessageChunk` 帧进 AI SDK 流;`control` 帧(extension-ui / queue / stats / error)旁路到 hooks。
  - REST 客户端(`createPiClient`):建会话、prompt/steer/follow_up/abort/model/thinking/ui-response、查询 state/stats/messages/commands、删除会话。
  - headless hooks:`usePiSession` / `usePiControls` / `useExtensionUI`,各自暴露状态机与操作函数。
- **Out of scope(本特性不负责)**:
  - 任何样式、视觉组件、AI Elements 装配、shadcn registry(归 `ui-components`)。
  - REST/SSE 端点实现、SSE 编码、会话进程驻留、事件→UIMessage 翻译、子进程 spawn、鉴权策略落地(归 `http-api` / `session-engine` / 后端引擎)。
  - 协议类型 / zod schema / `protocolVersion` 常量的定义(归 `protocol-contract`,仅消费)。
  - 扩展安装/卸载/命令面板的后端逻辑(归 `extension-management`;本层仅消费 `commands` 列表与 `ui-response` 端点)。
  - 非 React 集成(Web Component / iframe,归 `embed-integrations`,未来范围)。
- **Adjacent expectations(对相邻系统/spec 的依赖与不拥有项)**:
  - 依赖 `http-api` 按既定契约提供 REST 端点与 SSE 流(`data:`/`event:`/`id:` 行、心跳、`Last-Event-ID` 重连、`protocolVersion` 承载)。
  - 依赖 `protocol-contract` 提供 `SseFrame` / `UiMessageChunk` / data-part / REST DTO 的类型与 `protocolVersion`,本层据此解码与拼装,不重定义形状。
  - 依赖 AI SDK v5(`ai` / `@ai-sdk/react`)的 `ChatTransport` 接口与 `useChat` 行为;`UIMessageChunk` 类型以 AI SDK 与 `@blksails/pi-web-protocol` 的对齐为准。

## Requirements

### Requirement 1: PiTransport 实现 AI SDK v5 ChatTransport

**Objective:** As a 使用 useChat 的 React 开发者, I want 一个直接可传给 `useChat({ transport })` 的传输实现, so that 我无需手写 SSE 订阅与流转换即可获得 pi 的流式回复

#### Acceptance Criteria

1. The PiTransport shall 实现 AI SDK v5 `ChatTransport` 接口,可作为 `useChat({ transport })` 的传输直接使用。
2. When `sendMessages()` 被调用, the PiTransport shall 向 `http-api` 的 `POST /sessions/:id/messages` 端点提交 prompt 请求。
3. When `sendMessages()` 被调用, the PiTransport shall 返回一个 `ReadableStream<UIMessageChunk>`,其内容来自对该会话 `GET /sessions/:id/stream` SSE 流的订阅与解码。
4. When `sendMessages()` 收到 `abortSignal` 中止信号, the PiTransport shall 终止底层 SSE 订阅并关闭返回的可读流。
5. Where 调用方提供 `headers`/`body` 等附加请求参数, the PiTransport shall 将其透传到对应的 HTTP 请求。
6. The PiTransport shall 仅依赖标准 Web Fetch 与 AI SDK 类型,不依赖任何后端内部对象或非浏览器专有 API。

### Requirement 2: SSE 帧解码为 UIMessageChunk

**Objective:** As a useChat 的消费方, I want SSE 上的 `uiMessageChunk` 帧被正确解码为 AI SDK 可消费的块, so that 文本/思考/工具/data-part 能驱动流式 UI 渲染

#### Acceptance Criteria

1. When SSE 流推送 `kind: "uiMessageChunk"` 文本类帧(text-start/text-delta/text-end), the PiTransport shall 将其解码为对应的 `UIMessageChunk` 并写入可读流。
2. When SSE 流推送 reasoning(thinking)类 uiMessageChunk 帧(reasoning-start/delta/end), the PiTransport shall 将其解码为对应的 reasoning `UIMessageChunk`。
3. When SSE 流推送 tool 类 uiMessageChunk 帧(tool-input-available / tool-output-available), the PiTransport shall 将其解码为对应的 tool `UIMessageChunk`。
4. When SSE 流推送 data-part 类 uiMessageChunk 帧(`data-pi-*`,如累积工具输出), the PiTransport shall 将其解码为对应的 data-part `UIMessageChunk`。
5. When SSE 流推送会话结束信号(finish / 结束 control 帧), the PiTransport shall 关闭返回的可读流。
6. If SSE 帧无法按 `@blksails/pi-web-protocol` 的 schema 解析, then the PiTransport shall 不向可读流注入污染数据,并以可观测方式上报该解析错误(error 旁路或流错误)。

### Requirement 3: 断线重连续流

**Objective:** As a 长会话用户, I want SSE 连接中断后能续接后续帧, so that 我不会丢失会话进行中的增量回复

#### Acceptance Criteria

1. The PiTransport shall 实现 `ChatTransport.reconnectToStream()`,通过重新订阅 `GET /sessions/:id/stream` 续接帧流。
2. When 已记录最近接收帧的事件 ID 且发生重连, the PiTransport shall 携带 `Last-Event-ID` 重新订阅以从断点续推。
3. If 重连时会话已结束或不存在, then the PiTransport shall 返回表示无可续流的结果(`reconnectToStream` 返回 `null` 或以结束信号收束),而不挂起。
4. While SSE 连接保持中, the PiTransport shall 记录最近接收帧的事件 ID 以供后续重连定位。

### Requirement 4: createPiClient 封装 REST 调用

**Objective:** As a headless 层与 hooks 的实现者, I want 一个统一的 REST 客户端封装所有命令与查询, so that hooks 与传输层无需各自拼装 HTTP 请求

#### Acceptance Criteria

1. When 调用 `createPiClient(baseUrl, fetch?)`, the createPiClient shall 返回一个绑定到该 `baseUrl` 的客户端;Where 提供了自定义 `fetch`, the createPiClient shall 使用该 `fetch` 而非全局 fetch 发起请求。
2. When 客户端的建会话方法被调用, the PiClient shall 按 `@blksails/pi-web-protocol` 的 `CreateSessionRequest` 形状向 `POST /sessions` 提交 `{ source, cwd?, model?, env? }` 并返回 `{ sessionId }`。
3. When 客户端的命令方法(prompt / steer / follow_up / abort / model / thinking / ui-response)被调用, the PiClient shall 向对应的 `POST /sessions/:id/{...}` 端点提交符合协议 DTO 的请求体并返回该端点的响应。
4. When 客户端的查询方法(state / stats / messages / commands)被调用, the PiClient shall 向对应的 `GET /sessions/:id/{...}` 端点发起请求并返回符合协议响应 DTO 的结果。
5. If `http-api` 返回非 2xx 状态, then the PiClient shall 以可辨识的错误(含状态码与协议错误体字段)向调用方报告,而不静默吞错。
6. The PiClient shall 仅依据 `@blksails/pi-web-protocol` 的 DTO 与端点路径拼装请求,不重定义请求/响应形状。

### Requirement 5: usePiSession 会话生命周期与连接状态

**Objective:** As a 集成方, I want 一个 hook 管理会话的建立/连接与状态, so that 我能在 UI 中反映会话是否就绪、是否在流式响应、是否断线

#### Acceptance Criteria

1. When `usePiSession` 以建会话参数被使用, the usePiSession shall 通过 `createPiClient` 建立会话并暴露其 `sessionId`。
2. While 会话正在建立/连接/已连接/已断开/已结束, the usePiSession shall 暴露可辨识的连接状态供 UI 渲染。
3. The usePiSession shall 暴露一个绑定到该会话的 `PiTransport` 实例供 `useChat` 使用。
4. When 组件卸载或会话被显式关闭, the usePiSession shall 释放底层 SSE 订阅与相关资源,不产生悬挂连接。
5. If 建会话或连接失败, then the usePiSession shall 暴露可辨识的错误状态,而不抛出未捕获异常。

### Requirement 6: usePiControls pi 控制能力

**Objective:** As a 集成方, I want 一个 hook 提供模型/思考/中止/引导/统计/命令等控制能力, so that 这些 pi 特有控制不必经由 useChat 消息流即可触发

#### Acceptance Criteria

1. The usePiControls shall 暴露 `setModel`、`setThinking`、`abort`、`steer`、`followUp` 操作,各自调用对应的命令端点。
2. When `getStats` 被调用, the usePiControls shall 通过查询端点获取并暴露当前会话统计(stats)。
3. When `getCommands` 被调用, the usePiControls shall 通过查询端点获取并暴露可用命令列表(commands)。
4. While 某控制操作进行中, the usePiControls shall 暴露该操作的进行中/成功/失败状态供 UI 渲染。
5. The usePiControls shall 经由 `createPiClient` 调用 REST 端点完成上述控制,且这些控制不写入 `useChat` 的消息流。
6. If 控制操作端点返回错误, then the usePiControls shall 暴露可辨识的错误状态,而不静默失败。

### Requirement 7: useExtensionUI 扩展 UI 请求队列

**Objective:** As a 集成方, I want 一个 hook 把后端发起的扩展 UI 请求按队列暴露给我, so that 我能在自己的弹窗/组件中处理并回传响应

#### Acceptance Criteria

1. When SSE 上到达 `extension-ui` control 帧, the useExtensionUI shall 将该扩展 UI 请求加入待处理队列并暴露给上层。
2. The useExtensionUI shall 按到达顺序暴露待处理的扩展 UI 请求(队列语义),不丢弃未处理项。
3. When 上层对某扩展 UI 请求提交响应, the useExtensionUI shall 经 `POST /sessions/:id/ui-response` 回传响应并将该项从队列移除。
4. The useExtensionUI shall 确保扩展 UI 请求不进入 `useChat` 的消息流(仅经旁路队列暴露)。
5. If 扩展 UI 响应回传失败, then the useExtensionUI shall 保留该队列项并暴露可辨识的错误状态,允许重试。

### Requirement 8: control 帧旁路分流

**Objective:** As a 集成方, I want SSE 上的 control 帧被分流到正确的 hook 而不污染消息, so that 聊天消息流保持纯净、控制信息各归其位

#### Acceptance Criteria

1. When SSE 流上到达 `kind: "control"` 帧, the 帧分流逻辑 shall 按其子类型(extension-ui / queue / stats / error)将其路由到对应的 hook 状态,而不写入 `useChat` 消息流。
2. When 到达 `queue` control 帧, the 帧分流逻辑 shall 更新可供 UI 渲染的 steering/followUp 队列状态。
3. When 到达 `stats` control 帧, the 帧分流逻辑 shall 更新可供 UI 渲染的会话统计状态。
4. When 到达 `error` control 帧, the 帧分流逻辑 shall 以可辨识的会话级错误暴露该错误,而不作为聊天消息呈现。
5. The 帧分流逻辑 shall 保证同一 SSE 连接上 uiMessageChunk 帧与 control 帧由单一订阅消费并各自正确分流(不重复订阅、不交叉污染)。

### Requirement 9: 协议与版本一致性

**Objective:** As a 维护者, I want 本层与后端的协议版本保持一致, so that 契约漂移能被尽早发现而非以错误数据静默运行

#### Acceptance Criteria

1. The `@blksails/pi-web-react` shall 以 `@blksails/pi-web-protocol` 的类型与 schema 作为帧解码与 DTO 拼装的唯一来源,不内置并行的形状定义。
2. When SSE 帧或 REST 响应携带 `protocolVersion`, the `@blksails/pi-web-react` shall 以 `@blksails/pi-web-protocol` 暴露的 `protocolVersion` 为基准进行兼容判定。
3. If 收到的 `protocolVersion` 与本层基准不兼容, then the `@blksails/pi-web-react` shall 以可辨识的方式向调用方暴露版本不兼容,而不静默按错误形状解析。

### Requirement 10: 测试与端到端验证(硬性)

**Objective:** As a 项目维护者, I want 本层带有单元/组件/集成与 e2e 验证, so that 流解码、重连、请求拼装与 hook 状态机均有新鲜运行证据证明可用

#### Acceptance Criteria

1. The 测试套件 shall 包含 `PiTransport` 对 mock SSE 流的解码单测,覆盖 text / reasoning / tool / data-part 四类 uiMessageChunk 帧到 `UIMessageChunk` 的转换。
2. The 测试套件 shall 包含 `PiTransport` 重连逻辑单测,验证携带 `Last-Event-ID` 续流与会话已结束时不挂起。
3. The 测试套件 shall 包含 `createPiClient` 请求拼装单测,验证各端点的方法/路径/请求体形状与错误处理。
4. The 测试套件 shall 包含用 `@testing-library/react` 跑 `useChat({ transport: PiTransport })` 对 mock server 的组件/集成测试,断言消息随 SSE 帧流式更新。
5. The 测试套件 shall 包含 `usePiSession` / `usePiControls` / `useExtensionUI` 的 hook 状态机测试。
6. The e2e 测试 shall 接真实 `http-api`(配 stub agent),经 hook 驱动一轮 prompt 并接收流式回复直至结束。
7. The e2e 测试 shall 验证扩展 UI 请求经 `useExtensionUI` 冒泡(扩展 UI 请求出现在队列并可回传响应)。
8. The 测试套件 shall 可由单一命令运行全部单元/组件/集成/e2e 并产出可验证结果。

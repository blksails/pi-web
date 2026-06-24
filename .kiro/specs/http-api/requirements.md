# Requirements Document

## Introduction

`http-api` 是 pi-web 后端的**对外开放面**:把 `session-engine` 的进程内会话抽象(`SessionManager` / `SessionStore` / `PiSession`)经一套稳定的 **REST + SSE 契约**暴露出去,并提供**框架无关**的入口 `createPiWebHandler(opts)`——返回标准 Web Fetch `(req: Request) => Promise<Response>`,可挂载到 Next.js Route Handler、Hono、Express(adapter)等任意支持 Web Fetch 的 Node 宿主。

任何语言/框架的客户端(浏览器前端、Python/Go 客户端)都通过这套 HTTP/SSE 契约对接,无需理解 pi 原生事件或内部对象。SSE 帧分两类:**UIMessage chunks**(可直接喂 AI SDK)与**旁路 control 事件**(extension UI / queue / stats / error),并以心跳注释帧防断、`X-Accel-Buffering: no` 抑制反代缓冲。契约携带 `protocolVersion` 用于前后端握手与漂移防护。

本 spec **消费而非重定义**上游契约:REST DTO、SSE 帧 schema、`protocolVersion` 取自 `@blksails/protocol`;`PiSession` API、`SessionStore`、`subscribe()`、命令转发取自 `session-engine`。权威设计见 `PLAN.md` §3.3(端点表)、§13.2(`createPiWebHandler`/协议)、§11.5(SSE 反代)、§14.1③(控制面/数据面分离)、§13.4(可插拔鉴权点)。

## Boundary Context

- **In scope**(本 spec 拥有):
  - REST 端点:`POST /sessions`、`POST /sessions/:id/{messages,steer,follow_up,abort,model,thinking,ui-response}`、`GET /sessions/:id/{state,stats,messages,commands}`、`DELETE /sessions/:id`。其中 `GET /sessions/:id/commands` 为纯 `PiSession` 查询,由 http-api 独占拥有;`extension-management` 等下游消费而非重实现。
  - 外部路由注入接缝 `opts.routes`:供下游 spec(如 `extension-management`)挂载额外路由;内置路由对精确 `path`+`method` 冲突优先,外部路由不能遮蔽内置端点。
  - SSE 端点:`GET /sessions/:id/stream`——把 `PiSession.subscribe()` 的 UIMessage chunk 帧 + 旁路 control 帧编码为 `text/event-stream`,含心跳注释帧与 `X-Accel-Buffering: no`。
  - 框架无关入口 `createPiWebHandler(opts)`:返回 `(req: Request) => Promise<Response>`;内部路由方法+路径到对应处理器。
  - 每个处理器的请求边界校验(用 `@blksails/protocol` DTO `safeParse`)与统一错误码/错误响应体。
  - SSE 帧编码(`SseFrame` → `text/event-stream` 文本)与重连续流(`Last-Event-ID` / 重新 subscribe)。
  - `protocolVersion` 握手:响应/帧携带版本;客户端版本不兼容时的协商响应。
  - 可插拔鉴权接缝(**仅接口,默认放行**):`authResolver(req)`、`authorizeSession(ctx)`(§13.4)。
  - 把上游 `SessionManager.shutdown()` 暴露给宿主用于 `SIGTERM` 优雅停机(注册点归宿主,本 spec 提供可调用入口)。
- **Out of scope**(本 spec 不拥有,留给其他 spec / 未来):
  - 子进程 spawn、JSONL framing、`PiRpcChannel`(归 `rpc-channel`)。
  - 会话对象、事件广播、事件→UIMessage 翻译、生命周期、`SessionStore` 实现(归 `session-engine`,仅消费)。
  - agent 源解析、`spawnSpec` 生成、信任决策(归 `agent-source-resolver`)。
  - protocol 类型/zod schema/`protocolVersion` 常量定义(归 `protocol-contract`,仅消费)。
  - 完整鉴权/多租户/密钥管理落地——本 spec **只留 `authResolver`/`authorizeSession` 接口,默认放行**(归生产硬化 / `extension-management` 等)。
  - 前端 UI(`react-client`/`ui-components`)与扩展安装(`extension-management`)。
  - Edge/Serverless 运行(子进程驻留约束,见约束),沙箱 provider 落地(留接缝)。
  - **下层(`session-engine`/pi)已具备但本批次刻意不在 REST 面暴露的命令**:`compact`、`fork`、`clone`、`bash`/`abortBash`、`cycleModel`、`getAvailableModels`。属**有意延后**(deferred)而非覆盖缺口;后续批次再按需补端点 + DTO + 测试。
- **Adjacent expectations**:
  - 仅在 **Node runtime** 运行(子进程驻留、SSE 长连接),不支持 Edge/Serverless。
  - 部署需配反代关闭缓冲(`proxy_buffering off`)、长超时、HTTP/1.1 keep-alive、禁压缩 SSE(§11.5),本 spec 通过响应头(`X-Accel-Buffering: no`)与心跳帧配合。
  - 上游 `session-engine` 提供 `SessionManager.createSession` / `SessionStore.get` / `PiSession.subscribe` 与命令转发方法,本 spec 依赖其稳定契约。
  - e2e 测试依赖 `session-engine` 经 rpc-channel 起 stub agent(或真实 `pi --mode rpc`)产出事件流。

## Requirements

### Requirement 1: 框架无关的 HTTP 入口 createPiWebHandler

**Objective:** 作为任意 Node Web 框架的集成方,我想要一个返回标准 Web Fetch `(Request) => Promise<Response>` 的处理器工厂,以便把 pi-web 后端挂载到 Next.js / Hono / Express 等宿主而无需绑定具体框架。

#### Acceptance Criteria

1. The http-api shall 导出 `createPiWebHandler(opts)` 并返回签名为 `(req: Request) => Promise<Response>` 的标准 Web Fetch 处理器。
2. When 宿主以一个 Web `Request` 调用该处理器,the http-api shall 依据请求方法与路径将其路由到对应的端点处理器并返回 `Response`。
3. The http-api shall 通过 `opts` 接收上游会话依赖(`SessionManager` / `SessionStore` 或等价注入),且不在内部 spawn 子进程、不解析 agent 源、不定义 protocol schema。
4. When 请求路径不匹配任何已知端点,the http-api shall 返回 `404` 且响应体为统一错误结构。
5. When 请求路径匹配端点但方法不允许,the http-api shall 返回 `405` 且响应体为统一错误结构。
6. The http-api shall 不依赖任何特定框架的请求/响应对象类型,仅依赖 Web Fetch `Request`/`Response` 标准。
7. The http-api shall 通过 `opts.routes`(`ReadonlyArray<{ method, path, handler }>`)提供外部路由注入接缝,供下游 spec(如 `extension-management`)挂载额外路由;内部 `Router` 将外部路由与内置路由合并,且在精确 `path`+`method` 冲突时内置路由优先,外部路由不能覆盖或遮蔽任何内置端点。

### Requirement 2: 会话生命周期端点(创建 / 删除)

**Objective:** 作为客户端,我想要通过 HTTP 创建与销毁会话,以便按需开启 agent 会话并在结束后释放资源。

#### Acceptance Criteria

1. When 收到 `POST /sessions` 且请求体经 `@blksails/protocol` 的建会话 DTO 校验通过(含必填 `source`,可选 `cwd`/`model`/`env`),the http-api shall 经上游创建会话并返回 `{ sessionId }`(`200/201`)。
2. If `POST /sessions` 请求体缺 `source` 或字段类型不符,then the http-api shall 返回 `400` 且响应体包含错误码与可定位出错字段的信息。
3. When 收到 `DELETE /sessions/:id` 且会话存在,the http-api shall 触发该会话停止(关闭通道、从 store 移除)并返回 ack(`200/204`)。
4. When 任一携带 `:id` 的端点收到的 `sessionId` 在 store 中不存在,the http-api shall 返回 `404` 且响应体为统一错误结构。
5. While 进程已进入优雅停机(停止接受新会话),when 收到 `POST /sessions`,the http-api shall 拒绝新建并返回服务不可用类错误(`503`)。

### Requirement 3: 命令转发端点(POST 命令)

**Objective:** 作为客户端,我想要通过 HTTP 向会话发送 prompt、转向、跟进、中止、切模型、设思考等级及扩展 UI 回复,以便驱动并控制 agent 运行。

#### Acceptance Criteria

1. When 收到 `POST /sessions/:id/messages` 且请求体经对应 protocol DTO 校验通过,the http-api shall 调用 `PiSession` 的 prompt 转发并返回 ack/状态。
2. The http-api shall 为 `POST /sessions/:id/steer`、`/follow_up`、`/abort`、`/model`、`/thinking`、`/ui-response` 各端点分别将请求体校验后转发到对应 `PiSession` 命令方法(steer/follow_up/abort/setModel/setThinkingLevel/respondExtensionUI)并返回 ack。
3. If 任一命令端点请求体校验失败,then the http-api shall 返回 `400` 且包含错误码与字段路径,且不向会话转发。
4. When 命令端点目标会话已停止(`PiSession` 以已停止拒绝),the http-api shall 返回冲突类错误(`409`)而非 `500`。
5. When `POST /sessions/:id/ui-response` 的 extension UI 回复 ID 未在挂起表(上游以未知 ID 拒绝),the http-api shall 返回 `404`/`409` 类错误而非 `500`。
6. The http-api shall 仅转发命令负载,不改写命令语义(语义由 `session-engine`/pi 决定)。

### Requirement 4: 查询端点(GET 状态 / 统计 / 历史 / 命令)

**Objective:** 作为客户端,我想要查询会话状态、成本统计、消息历史与可用命令,以便展示会话信息并构建命令面板。

#### Acceptance Criteria

1. When 收到 `GET /sessions/:id/state`,the http-api shall 返回该会话的状态响应 DTO。
2. When 收到 `GET /sessions/:id/stats`,the http-api shall 返回该会话的 token/cost 统计响应 DTO。
3. When 收到 `GET /sessions/:id/messages`,the http-api shall 返回该会话的消息历史响应 DTO。
4. When 收到 `GET /sessions/:id/commands`,the http-api shall 返回该会话的可用命令响应 DTO。该端点为纯 `PiSession` 查询(无安装/信任治理),由 http-api 独占拥有;下游 spec(如 `extension-management`)消费此端点而非重新实现。
5. The http-api shall 对查询端点的响应体形状以 `@blksails/protocol` 的对应响应 DTO 为准,不重定义形状。

### Requirement 5: SSE 流式端点与帧编码

**Objective:** 作为流式客户端,我想要订阅会话的 SSE 流并接收 UIMessage chunk 与旁路 control 事件,以便逐字渲染 agent 回复并响应扩展 UI/状态变化。

#### Acceptance Criteria

1. When 收到 `GET /sessions/:id/stream` 且会话存在,the http-api shall 返回 `Content-Type: text/event-stream` 的长连接响应并经 `PiSession.subscribe()` 订阅会话帧。
2. The http-api shall 把上游 `SseFrame`(`uiMessageChunk` 与 `control` 两类)编码为符合 SSE 规范的 `text/event-stream` 文本帧(`data:` 行,必要时 `event:`/`id:` 行),且每帧承载 `protocolVersion`。
3. The http-api shall 在 SSE 响应头设置 `X-Accel-Buffering: no` 并关闭对该响应的压缩,以抑制反向代理缓冲(§11.5)。
4. While SSE 连接保持空闲,the http-api shall 周期性发送心跳注释帧(`:` 开头)以防中间网络/反代断连。
5. When 会话结束(stop/idle/crash/shutdown),the http-api shall 在 SSE 流上发出结束信号(control 结束/错误帧)并关闭该连接。
6. When 客户端断开 SSE 连接,the http-api shall 取消该订阅句柄并释放与该连接关联的资源,且不影响同会话其他订阅者。
7. When 对不存在的会话请求 `GET /sessions/:id/stream`,the http-api shall 返回 `404` 而非建立空流。

### Requirement 6: 断线重连与续流

**Objective:** 作为流式客户端,我想要在网络抖动断线后重连 SSE 并续接同一会话的流,以便不丢失会话上下文地继续接收增量。

#### Acceptance Criteria

1. The http-api shall 为 SSE 帧分配可用于重连定位的事件标识(`id:` 行),供客户端断线后通过 `Last-Event-ID` 表达续接位置。
2. When 客户端携带 `Last-Event-ID` 重连 `GET /sessions/:id/stream` 且会话仍存活,the http-api shall 重新订阅该会话并恢复后续帧推送(续流)。
3. When 客户端在会话已结束后重连,the http-api shall 返回明确的结束/不存在响应而非无限挂起。
4. The http-api shall 在重连续流时保持帧的 `protocolVersion` 一致,使客户端解码不中断。

### Requirement 7: protocolVersion 握手与漂移防护

**Objective:** 作为前后端协议协商方,我想要在 HTTP/SSE 契约中携带并校验 `protocolVersion`,以便在协议不兼容时尽早暴露而非产生静默错误。

#### Acceptance Criteria

1. The http-api shall 在响应(REST 响应头/响应体与 SSE 帧)中携带来自 `@blksails/protocol` 的 `protocolVersion`。
2. When 客户端在请求中声明了不兼容的 `protocolVersion`,the http-api shall 返回明确的版本协商错误(如 `426`/`400` 类)而非静默继续。
3. The http-api shall 以 `@blksails/protocol` 导出的 `protocolVersion` 为唯一版本来源,不自定义版本号。

### Requirement 8: 可插拔鉴权接缝(接口优先,默认放行)

**Objective:** 作为部署方,我想要在不实现完整鉴权的前提下保留鉴权与授权的插入点,以便后续按需接入鉴权而无需重构端点。

#### Acceptance Criteria

1. The http-api shall 接收可选的 `authResolver(req)` 选项,用于解析请求身份/多租户归属(返回身份上下文或拒绝)。
2. The http-api shall 接收可选的 `authorizeSession(ctx)` 选项,用于决定身份是否可对某会话发命令/订阅(返回允许或拒绝)。
3. While 未配置 `authResolver`/`authorizeSession`,the http-api shall **默认放行**所有请求(保持接口形状不变)。
4. When `authResolver` 返回拒绝,the http-api shall 返回 `401` 且不触达会话。
5. When `authorizeSession` 返回拒绝,the http-api shall 返回 `403` 且不触达会话命令/订阅。
6. The http-api shall 仅定义并调用这两个接缝接口,不在本 spec 落地具体鉴权策略、密钥管理或多租户隔离实现。

### Requirement 9: 统一错误处理与控制/数据面边界

**Objective:** 作为客户端与运维方,我想要一致的错误响应结构与清晰的"网关只转发、状态在通道背后"的边界,以便可预测地处理错误并为未来控制/数据面分离留接缝。

#### Acceptance Criteria

1. The http-api shall 以统一结构返回错误响应(含错误码、可读消息,校验错误附字段路径),区分 `400`(校验)、`401`/`403`(鉴权/授权)、`404`(不存在)、`405`(方法不允许)、`409`(状态冲突)、`426`/`400`(版本)、`503`(停机)。
2. When 上游会话层抛出已知错误(已停止/未找到/未知扩展 UI/缺入参),the http-api shall 映射为对应 HTTP 状态码而非统一 `500`。
3. When 处理器发生未预期异常,the http-api shall 返回 `500` 且不泄露敏感信息(env/凭据/堆栈细节)。
4. The http-api shall 作为无状态网关只转发命令与订阅,会话状态保留在 `session-engine`/通道背后(§14.1③),不在网关内持久化会话状态。

### Requirement 10: 测试与 e2e(硬性)

**Objective:** 作为质量负责人,我想要单元、集成与 e2e 测试覆盖请求校验、错误码、SSE 帧编码与全链路流式,以便以新鲜运行证据证明契约正确。

#### Acceptance Criteria

1. The http-api shall 提供单元测试,覆盖每个 handler 的请求校验(用 protocol DTO)与错误码映射,以及 SSE 帧编码(`SseFrame` → `text/event-stream` 文本、心跳帧、`id:` 行)。
2. The http-api shall 提供集成测试:对真实 `session-engine`(经 rpc-channel + stub agent)起 `createPiWebHandler`,`POST` 命令并订阅 SSE,断言命令转发与帧推送一致。
3. The http-api shall 提供 e2e 测试:HTTP `POST /sessions` → `GET /stream` → `POST /messages` 后在 SSE 上接收逐字 `text-delta` 直至 `finish`。
4. The http-api shall 在 e2e 中验证 `POST /sessions/:id/abort` 生效(中止后流以结束信号收束)。
5. The http-api shall 在 e2e 中验证断线重连续流:断开 SSE 后携带续接标识重连,恢复后续帧推送。
6. The http-api shall 支持以单一命令运行全部单元/集成/e2e 测试并产出可验证结果。

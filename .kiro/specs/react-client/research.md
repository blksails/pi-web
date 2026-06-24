# Research Log — react-client

## Discovery Scope

Greenfield 包 `@blksails/react`(headless React 层)。发现聚焦于三处既定契约的消费,而非重定义:
1. AI SDK v5 `ChatTransport` / `useChat` 接口形状(本层实现的目标接口)。
2. `@blksails/protocol` 的 `SseFrame` / `UiMessageChunk` / data-part / REST DTO / `protocolVersion`(解码与拼装的唯一来源)。
3. `http-api` 的 REST + SSE 契约(本层调用的对象)。

权威设计来源:`PLAN.md` §4(事件→UIMessage 翻译表 + ChatTransport 双连接模型)、§13.1(`@blksails/react` 导出面)、§13.3 B(headless hooks 集成方式)、`.kiro/specs/protocol-contract/design.md`、`.kiro/specs/http-api/design.md`。

## 关键发现

### F1. AI SDK v5 ChatTransport 是本层实现的目标接口
- `useChat` 接受 `transport: ChatTransport<UI_MESSAGE>`。`ChatTransport` 的核心方法:
  - `sendMessages(options) => Promise<ReadableStream<UIMessageChunk>>`,`options` 含 `chatId`、`messages`、`abortSignal`、`trigger`(`submit-message` / `regenerate-message`)、`messageId`、可选 `headers`/`body`/`metadata`。
  - `reconnectToStream(options) => Promise<ReadableStream<UIMessageChunk> | null>`,返回 `null` 表示无可续流。
- `UIMessageChunk` 是可辨识联合(`type`: `text-start`/`text-delta`/`text-end`/`reasoning-*`/`tool-input-available`/`tool-output-available`/`data-*`/`start`/`finish` 等)。本层负责把 SSE 上的 `uiMessageChunk` 帧映射为这些 chunk。
- **Implication**:`PiTransport` 是单一适配类;`sendMessages` 的「POST + SSE 流」是双连接模型(§13.2/§4):POST 立即 ack,增量经独立 `/stream` 连接推送。返回的 `ReadableStream` 实际桥接到一条 SSE 订阅。

### F2. SSE 双类帧 + 单订阅分流(protocol + http-api 已定形)
- `http-api` 的 `/stream` 输出 `text/event-stream`,每帧 JSON 是 `SseFrame`(protocol):`kind: "uiMessageChunk"` 或 `kind: "control"`,均承载 `protocolVersion`,行级带 `id:`(帧序号)供 `Last-Event-ID` 重连。
- `control` 帧子类型:`extension-ui` / `queue` / `stats` / `error`(protocol `ControlFrameSchema`)。
- **决策**:本层用**单条 SSE 订阅**消费一条流,在分流器中按 `kind` 判别:`uiMessageChunk` → 注入 `PiTransport` 的可读流;`control` → 旁路 emitter → hooks。避免对同一会话开多条 `/stream`(重复订阅 + 交叉污染)。`PiTransport.sendMessages` 返回的可读流与 hooks 的 control 状态共享同一订阅。

### F3. 重连续流由 http-api 的 Last-Event-ID 契约支撑
- `http-api` Req 6.x:`id:` 行承载帧序号;带 `Last-Event-ID` 重连即重新 `subscribe()` 续推;会话已结束→明确结束响应不挂起。
- **Implication**:`PiTransport` 记录最近事件 ID(`lastEventId`),`reconnectToStream` 用浏览器 `EventSource` 的内建 `Last-Event-ID`,或用 `fetch` + 手动设 `Last-Event-ID` 头。会话已结束 → `reconnectToStream` 返回 `null`。

### F4. EventSource vs fetch-stream 的取舍
- 浏览器原生 `EventSource` 自动带 `Last-Event-ID` 重连、自动解析 SSE 帧,但**只支持 GET 且不能自定义请求头**(无法带 `Authorization`)。
- `fetch` + `ReadableStream` 读取 + 手写 SSE 解析器,可带任意头、可手动控制重连与 `Last-Event-ID`,且对单元测试更友好(可注入 mock `fetch` 返回 mock SSE 文本流)。
- **决策**:采用 **fetch + 手写 SSE 帧解析器**。理由:(a) Req 1.5 要求透传 `headers`(鉴权);(b) Req 10.1/10.2 要求对 mock SSE 流单测,fetch 注入比 EventSource 更可控;(c) 与 `createPiClient(baseUrl, fetch?)` 的自定义 fetch 注入一致。SSE 解析器是纯函数(行缓冲 → 帧),独立单测。

### F5. headless 与样式严格分离(§13.1 / §13.3 B / structure.md)
- `@blksails/react` 仅导出 `PiProvider`(可选)、`usePiSession`、`usePiControls`、`useExtensionUI`、`PiTransport`、`createPiClient`。无任何 JSX 组件/样式(归 `ui-components`)。
- **Implication**:hooks 返回纯状态对象与操作函数;扩展 UI 经队列冒泡,由上层决定如何弹窗。本层不渲染。

### F6. 协议版本一致性
- `SseFrame` 与 REST 响应带 `protocolVersion`(protocol/http-api)。本层以 `@blksails/protocol` 导出的 `protocolVersion` 为基准比对,不兼容时显式暴露(Req 9.3),不静默按错误形状解析。

## 架构模式评估

| 候选 | 说明 | 取舍 |
|---|---|---|
| EventSource 直驱 | 用原生 EventSource 订阅 SSE | ❌ 不能带鉴权头、不能 POST、难单测 |
| fetch + 手写 SSE 解析 + 单订阅分流器 | fetch 读流,纯函数解析帧,分流器按 kind 路由 | ✅ 选定:可注入 fetch、可带头、可测、单订阅避免污染 |
| 每 hook 各开一条 SSE | 各 hook 自己订阅 | ❌ 同会话多订阅、control 帧重复/交叉污染 |
| Context-Provider 强耦合 | 必须包 Provider 才能用 hooks | ⚠️ 提供可选 `PiProvider`,但 hooks 也接受显式 client/transport 注入,不强制 |

**选定**:单订阅 SSE 分流 + fetch 传输 + 可注入 REST 客户端。`PiSessionConnection` 持有唯一订阅,产出 (a) 给 `PiTransport` 的 `UIMessageChunk` 可读流,(b) control 帧 emitter 供 hooks 订阅。

## Synthesis 决策

- **Build vs Adopt**:`ChatTransport` 接口与 `UIMessageChunk` 类型 **adopt** AI SDK + protocol;SSE 解析器、分流器、REST 客户端、hooks **build**(薄、无业务状态在后端外)。
- **Generalization**:SSE 解析为纯函数(`parseSseChunk(buffer) → { frames, rest }`),与传输/重连解耦,直接单测。
- **Simplification**:不引入状态库;hooks 用 `useState`/`useRef`/`useSyncExternalStore` 订阅连接的 control emitter。control 状态(queue/stats/error/extension-ui)集中在 `PiSessionConnection` 的一个可订阅 store,三个 hook 各取所需切片——避免三份并行订阅。
- **Boundary**:本层不持有会话真值(真值在后端通道背后);仅持有「连接态 + 旁路 control 快照 + 扩展 UI 待办队列」这类**前端派生 UI 状态**。

## 风险与缓解

- **R1 SSE 解析边界**(多行 `data:`、`U+2028/2029`、半帧跨 chunk):解析器维护行缓冲,按 `\n` 切并剥 `\r`,半帧留存到下次;对应单测覆盖跨 chunk 半帧。
- **R2 AI SDK v5 chunk 形状漂移**:`UIMessageChunk` 以 AI SDK 与 protocol 对齐为准;protocol 的 `data-pi-*` data-part 与 AI SDK `data-*` 对接点集中在解码映射表,漂移时单点修改 + 单测暴露。
- **R3 重连竞态**(重连期间又收到结束):`reconnectToStream` 在订阅前先判定会话态;`null` 表示无可续流。
- **R4 资源泄漏**:连接 `close()` 必须 abort fetch reader + 清 emitter 监听;`usePiSession` 卸载时调用(Req 5.4)。
- **R5 ui-response 失败**:保留队列项 + 暴露错误允许重试(Req 7.5),不静默移除。

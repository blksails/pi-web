# Research Log — stream-error-surfacing

## Discovery 范围
- 类型:Extension(在既有会话翻译层 + 前端 pi-chat 上修复),light discovery。
- 目标:定位"provider/流式错误不向用户呈现"的精确断点与可复用的呈现通道,确定服务端/前端两层的最小改动面。

## 关键调查与发现

### 1. 运行时事件契约(`packages/protocol/src/rpc/event.ts` / `model.ts`)
- `agent_end` = `{ messages: AgentMessage[], willRetry: boolean }`(event.ts:111-115)。**终态错误的权威检测点**:回合结束时带最终消息与是否还会重试。
- `message_end` = `{ message: AgentMessage }`(event.ts:128)。
- `message_update.assistantMessageEvent` 的 `error` 子事件 = `{ reason: "aborted"|"error", error: AssistantMessage }`(event.ts:91-95)。真实错误文案在 `error.errorMessage`。
- `auto_retry_start` 带 `errorMessage`,`auto_retry_end` 带 `success` + `finalError?`(event.ts:176-188)。
- `AssistantMessage`(model.ts:110-125)为**类型化**字段:`stopReason: StopReason`、`errorMessage?: string`;`StopReason` 枚举含 `"error"`、`"aborted"`(model.ts:89-95)。`AgentMessage` 为 user/assistant/toolResult 联合,可按 `role==="assistant"` 收窄。

### 2. 翻译层现状(`packages/server/src/session/translate/translate-event.ts`)
- `agent_end` → 一律 `finish`(306-311),**不看** `willRetry` / 最终消息 `stopReason` / `errorMessage`。
- `message_end` → `none`(313-317),**丢弃**承载 `errorMessage` 的消息。
- `message_update.error` 分支(122-140):`reason==="aborted"` → `abort`;否则 → `error` chunk,但 `errorText` 为**硬编码** `"assistant message stream error"`,**丢弃真实** `ame.error.errorMessage`。
- `auto_retry_start/end` → `data-pi-auto-retry` 数据部件(248-281),已携带 `errorMessage`/`finalError`。
- 纯函数(Functional Core):无 I/O,产帧经 `makeUiMessageChunkFrame`,且 `error`/`abort` 已是 AI SDK 对齐的生命周期块(文件头注释 §帧映射)。

### 3. 前端呈现管道
- `error`/`abort` UiMessageChunk 已被前端 `decode-chunk.ts:34-37` 映射为 AI SDK `{type:"abort"}` / `{type:"error",errorText}`,进入自定义 `pi-transport` → `useChat` 流。
- `useChat` 收到 `error` 块会置 `chat.error`(Error,message=errorText)与 `status==="error"`。
- **断点**:`packages/ui/src/chat/pi-chat.tsx:196` 仅取 `{ messages, sendMessage, status, stop }`,**未消费 `chat.error`**,且无 `status==="error"` 渲染分支 → 即便服务端发 `error` 块,用户仍看不到。
- 既有错误样式资产:shadcn `--destructive` CSS 变量(见 `notifications.tsx` error 配色);`elements/` 目录是无状态展示元件的既有模式。

### 4. 既有测试
- 翻译层:`packages/server/test/session/translate-event.table.test.ts`(表驱动)。
- 前端:`packages/ui/test/chat/pi-chat*.test.tsx` + `test/fixtures/mock-session.ts`、`ui-message-fixtures.ts`。

## 架构决策
- **D1 复用既有 `error`/`abort` 生命周期块,不新增协议类型**:`error` 块已贯通 protocol→translate→decode→useChat,缺的只是"翻译层在终态错误时发它"和"前端呈现它"。最小足迹、最符合既有 seam。
- **D2 终态错误检测放在 `agent_end`**:`willRetry===false` 且最终 assistant 消息 `stopReason==="error"` → 发 `error` 块(`errorText = errorMessage ?? 回退`);`stopReason==="aborted"` → 发 `abort` 块;其余(`stop`/`length`/`toolUse`)→ 维持 `finish`。`willRetry===true` → 维持现状(`finish`,重试反馈由 `data-pi-auto-retry` 承载)。发块前关闭悬挂 text/reasoning part(满足 R1.4 收尾)。
- **D3 `message_update.error` 透传真实文案**:`reason==="error"` 用 `ame.error.errorMessage ?? 回退` 取代硬编码;`reason==="aborted"` 维持 `abort`(R2.3/R4)。
- **D4 前端补呈现**:`pi-chat` 消费 `chat.error`(或 `status==="error"`),以无状态错误元件(destructive 配色)展示 `error.message`;保留已流式出的助手消息内容(R1.2/R1.4/R2.4)。
- **D5 回退文案常量**:仅当运行时确无 `errorMessage`/`finalError` 时使用一句明确回退(如 "对话失败,但运行时未提供具体错误信息"),不覆盖真实信息(R2.2)。

## 风险与权衡
- **R-1**:AI SDK `error` 块是否会丢弃已流式的部分助手消息?v5 语义是置 `error`/`status` 并保留既有 `messages`,不删除部分消息。实现期须用前端组件测试验证"部分文本仍在 + 错误可见"(对应 R1.4)。若验证发现会丢弃,降级方案:改用内联 `data-pi-error` 数据部件(需新增协议块,作为 fallback,不作首选)。
- **R-2**:`agent_end` 的 `messages` 末项未必是 assistant(可能 toolResult)。检测需从尾部找最近的 assistant 消息再判 `stopReason`,并对非 assistant/缺字段安全跳过(不抛、不误报)。
- **R-3**:`error` 块与 `finish` 的关系。AI SDK 中 `error` 即终态,不再额外发 `finish`;需保证 ctx 收尾(关闭悬挂 part)与既有 `finish` 路径不冲突。翻译层纯函数,单测可覆盖。

## 综合(Synthesis)
- Build-vs-adopt:**adopt** 既有 `error`/`abort` 块与 `useChat` 错误态,仅补"翻译层发射条件"与"前端呈现",不自造错误通道/通知中心。
- 简化:不引入新协议块(首选);重试反馈复用既有 `data-pi-auto-retry`;错误呈现复用既有 destructive 样式与 `elements/` 模式。
- 泛化:`agent_end` 的终态判定同时覆盖 error 与 aborted 两种 `stopReason`,与 `message_update.error` 的 reason 分支语义一致(error→error 块、aborted→abort 块),前后端一致。

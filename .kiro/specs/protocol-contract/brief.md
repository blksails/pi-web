# Brief — protocol-contract

> 语言:zh(spec.json.language = "zh")。权威设计:`PLAN.md` §3.1、§4、§13.1–13.2、§14.1①。

## 问题
- **谁**:pi-web 的所有上下游层(后端引擎、HTTP、前端、第三方集成方)。
- **现状**:pi 的 RPC 命令/响应/事件/扩展UI 类型只存在于 `@earendil-works/pi-coding-agent` 的 `dist/**/*.d.ts`,
  且未在包 `exports` 导出;AI SDK UIMessage 流、SSE 帧、REST DTO 尚无统一契约。
- **改变**:建立一个**零运行时依赖、同构可用**的协议包 `@blksails/protocol`,成为全项目唯一契约根。

## 方法 / 范围
- 从 pi d.ts 派生并本地化:`RpcCommand` / `RpcResponse` / `AgentEvent`(message_update 各 delta、tool_execution_*、agent/turn 等)/ `RpcExtensionUIRequest` / `RpcExtensionUIResponse` / `RpcSessionState` / `Model` / `AgentMessage`。
- 定义 **SSE 帧 schema**:两类——`uiMessageChunk`(text/reasoning/tool/data-part)与旁路 `control`(extension-ui、queue、stats、error)。
- 定义 **UIMessage data-part schema**(pi 特有:queue、compaction、auto-retry、tool partialResult)。
- 定义 **REST DTO**(建会话入参 `{source,cwd?,model?,env?}`、各命令请求/响应)。
- 用 `zod`(或 typebox)给运行时可校验的 schema;导出 `protocolVersion` 常量。
- **范围外**:不实现 spawn、不实现翻译逻辑(只定义类型/schema)。

## 关键契约
- `protocolVersion`(SSE 帧/握手用,语义化版本)。
- 严格区分:pi 原生 RPC 类型 vs pi-web 自定义传输层 DTO,二者分文件。

## 测试 + e2e(硬性)
- **单元**:每个 zod schema 的 parse/safeParse 正反例;版本常量存在性。
- **e2e/契约测试**:采集真实 `pi --mode rpc` 的样本帧(prompt→text_delta→tool→agent_end)与 SSE 样本,断言全部通过 schema 校验(防 schema 与真实协议漂移)。

## 约束
- 零运行时依赖(除 zod 之类校验库);纯 TS,同构(Node + 浏览器)。
- 类型须与 pi 当前版本(0.79.x)对齐,标注来源 d.ts 路径。

# Requirements Document

## Introduction

`@blksails/pi-web-protocol` 是 pi-web 全项目的**唯一契约根**:一个零运行时依赖、同构可用(Node + 浏览器)、纯 TypeScript 的协议包。它集中定义并以 zod schema 在运行时校验所有跨层契约——包括从 `@earendil-works/pi-coding-agent`(pi `0.79.x`)`dist/**/*.d.ts` 派生并本地化的 pi 原生 RPC 类型、pi-web 自定义的 SSE 帧、UIMessage data-part、REST DTO,并导出语义化版本常量 `protocolVersion` 用于握手与漂移防护。

本协议包是依赖图最底层(`protocol ← 所有`),后端引擎、HTTP 层、前端、第三方集成方均依赖它,因此其正确性、稳定性与可校验性直接决定全链路契约一致性。权威设计见 `PLAN.md` §3.1、§4、§13.1–13.2、§14.1①。

## Boundary Context

- **In scope**:
  - pi 原生 RPC 契约的本地化类型 + zod schema:`RpcCommand` / `RpcResponse` / `AgentEvent`(含 `message_update` 各 delta、`tool_execution_*`、`agent`/`turn` 等)/ `RpcExtensionUIRequest` / `RpcExtensionUIResponse` / `RpcSessionState` / `Model` / `AgentMessage`。
  - pi-web 自定义传输层 SSE 帧 schema:两类——`uiMessageChunk`(text/reasoning/tool/data-part)与旁路 `control`(extension-ui / queue / stats / error)。
  - UIMessage data-part schema(pi 特有:queue、compaction、auto-retry、tool partialResult)。
  - REST DTO schema(建会话入参 `{ source, cwd?, model?, env? }`、各命令请求/响应)。
  - `SpawnSpec` 子进程启动规格 schema(`{ cmd, args, cwd, env }`):由 `agent-source-resolver` 产出、`rpc-channel` 消费的跨层契约,与建会话入参 `CreateSessionRequest` 是不同契约。
  - `protocolVersion` 语义化版本常量。
  - 运行时可校验的 schema(zod)+ 由 schema 推导的静态类型。
  - 每个 schema 的来源 d.ts 路径标注(对齐 pi `0.79.x`)。
- **Out of scope**(本 spec 不拥有,留给下游 spec):
  - 不实现子进程 spawn、JSONL framing、RPC 通道(归 `rpc-channel`)。
  - 不实现事件→UIMessage 的翻译逻辑(归 `session-engine`);本包只定义两端类型/schema。
  - 不实现 HTTP Route Handler、SSE 编解码传输(归 `http-api`);本包只定义帧 schema。
  - 不实现 agent 源解析、runner、前端 transport/hooks/组件。
- **Adjacent expectations**:
  - 上游依赖 `@earendil-works/pi-coding-agent` `0.79.x` 的 `dist/**/*.d.ts` 作为 pi 原生类型的派生来源;该包未在 `exports` 导出这些类型,故必须本地化复制。
  - 下游全部包通过本包的导出获取类型与 schema;`rpc-channel`、`session-engine`、`http-api`、`react-client` 等依赖其稳定性。
  - e2e 契约测试依赖真实 `pi --mode rpc` 运行环境产出样本帧(为 §14.1① 的传输无关接缝防漂移)。

## Requirements

### Requirement 1: pi 原生 RPC 契约本地化(类型 + schema)

**Objective:** 作为下游引擎/集成方开发者,我想要从协议包获得与 pi `0.79.x` 对齐的本地化 RPC 命令/响应/事件/扩展 UI 类型与可运行校验的 schema,以便不依赖未导出的 pi `d.ts` 即可生产并校验 RPC 消息。

#### Acceptance Criteria

1. The protocol package shall 导出 `RpcCommand`、`RpcResponse`、`RpcExtensionUIRequest`、`RpcExtensionUIResponse`、`RpcSessionState`、`Model`、`AgentMessage` 的类型与对应 zod schema。
2. The protocol package shall 导出 `AgentEvent` 的可辨识联合(discriminated union)schema,覆盖 `agent_start`、`agent_end`、`turn_end`、`message_update`(含 `text_start`/`text_delta`/`text_end`/`thinking_start`/`thinking_delta`/`thinking_end`)、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`compaction_*`、`auto_retry_*`、`queue_update`、`extension_ui_request`。
3. When 一个符合 pi 协议的合法 RPC 命令/响应/事件对象传入对应 schema 的 `parse`,the protocol package shall 返回与输入语义一致的已校验对象且不抛错。
4. If 一个缺少必填字段或类型不符的对象传入对应 schema 的 `safeParse`,then the protocol package shall 返回 `success: false` 且 `error` 中包含可定位到出错字段路径的信息。
5. Where 某 schema 由 pi `dist/**/*.d.ts` 派生,the protocol package shall 在该 schema 定义处以注释标注其来源 d.ts 路径与对齐的 pi 版本(`0.79.x`)。
6. The protocol package shall 使所有导出类型由其 zod schema 推导(单一事实来源),使类型与运行时校验不会分叉。

### Requirement 2: SSE 帧契约(两类:uiMessageChunk 与 control)

**Objective:** 作为传输层(HTTP/SSE)与前端 transport 开发者,我想要一套明确区分"喂给 AI SDK 的 UIMessage chunk"与"旁路控制事件"的 SSE 帧 schema,以便服务端编码与前端解码使用同一契约。

#### Acceptance Criteria

1. The protocol package shall 导出 SSE 帧的顶层 schema,且其能区分两类帧:`uiMessageChunk` 与 `control`。
2. The protocol package shall 使 `uiMessageChunk` 帧覆盖 text、reasoning、tool、data-part 四类负载。
3. The protocol package shall 使 `control` 帧覆盖 `extension-ui`、`queue`、`stats`、`error` 四类旁路控制负载。
4. When 一个合法 SSE 帧对象传入 SSE 帧 schema 的 `parse`,the protocol package shall 返回已校验对象且其类别(`uiMessageChunk` 或 `control`)可通过可辨识字段判定。
5. If 一个类别字段缺失或与负载不匹配的 SSE 帧传入 `safeParse`,then the protocol package shall 返回 `success: false`。
6. The protocol package shall 在 SSE 帧契约中包含 `protocolVersion` 字段,供前后端在握手与流式过程中协商版本。

### Requirement 3: UIMessage data-part 契约(pi 特有)

**Objective:** 作为前端渲染与翻译层开发者,我想要 pi 特有的 UIMessage data-part schema,以便顶部状态条、队列、重试与工具部分结果能被类型安全地渲染。

#### Acceptance Criteria

1. The protocol package shall 导出 UIMessage data-part 的 schema,覆盖 pi 特有的 queue、compaction、auto-retry、tool partialResult 四类。
2. The protocol package shall 使每类 data-part 携带可辨识的 `type` 标识(例如 `data-pi-queue`、`data-pi-*`),以便前端按类型分发渲染器。
3. When 一个合法 data-part 对象传入对应 schema 的 `parse`,the protocol package shall 返回已校验对象。
4. If 一个未知 `type` 或字段不符的 data-part 传入 `safeParse`,then the protocol package shall 返回 `success: false`。

### Requirement 4: REST DTO 契约

**Objective:** 作为 HTTP API 与第三方集成方开发者,我想要建会话与各命令的请求/响应 DTO schema,以便语言无关地对接 REST 面并在边界处校验入参。

#### Acceptance Criteria

1. The protocol package shall 导出建会话请求 DTO 的 schema,其形状为 `{ source, cwd?, model?, env? }`,其中 `source` 为必填,`cwd`/`model`/`env` 为可选。
2. The protocol package shall 为各命令(prompt/steer/follow_up/abort、set_model/thinking、获取 state/stats/messages/commands、ui-response、删除会话)导出对应的请求/响应 DTO schema。
3. When 一个合法 REST DTO 对象传入对应 schema 的 `parse`,the protocol package shall 返回已校验对象。
4. If 建会话请求缺少 `source` 字段,then the protocol package shall 在 `safeParse` 中返回 `success: false`。
5. The protocol package shall 导出 `SpawnSpec` 的 schema 与类型,其形状为 `{ cmd: string, args: string[], cwd: string, env: Record<string, string> }`(四字段均必填),作为 `agent-source-resolver` 产出、`rpc-channel` 消费的跨层契约;其与建会话请求 DTO(`{ source, cwd?, model?, env? }`)是两个不同契约,且当任一必填字段缺失或类型不符时 `safeParse` 返回 `success: false`。

### Requirement 5: 协议版本常量与契约分层

**Objective:** 作为全链路契约维护者,我想要一个语义化版本常量并把 pi 原生类型与 pi-web 自定义 DTO 在文件层面严格分离,以便版本协商与契约演进可控且来源可辨。

#### Acceptance Criteria

1. The protocol package shall 导出 `protocolVersion` 常量,其值为语义化版本(SemVer)字符串。
2. The protocol package shall 把"pi 原生 RPC 类型/schema"与"pi-web 自定义传输层 DTO(SSE 帧 / UIMessage data-part / REST DTO)"放在不同文件,使二者来源可辨识、可分别演进。
3. Where SSE 帧或握手需要版本协商,the protocol package shall 使 `protocolVersion` 可被引用并随帧传递(见 Requirement 2.6)。
4. The protocol package shall 提供一个集中入口导出全部公共类型、schema 与 `protocolVersion`,使下游通过单一导入面消费契约。

### Requirement 6: 同构与零运行时依赖约束

**Objective:** 作为同时运行于 Node 与浏览器的下游开发者,我想要协议包零运行时依赖(除校验库)且纯 TS 同构,以便它能被任意环境无副作用地引入。

#### Acceptance Criteria

1. The protocol package shall 仅包含纯 TypeScript 类型与 schema,不包含 Node 专有或浏览器专有的运行时 API 调用,以保证 Node 与浏览器同构可用。
2. The protocol package shall 除校验库(zod 或同类)外不引入任何运行时依赖。
3. While 在浏览器或 Node 环境中导入本包,the protocol package shall 不产生任何 I/O、子进程或文件系统副作用。

### Requirement 7: 契约可测试性与防漂移验证(测试硬性要求)

**Objective:** 作为质量负责人,我想要每个 schema 都有正反例单元测试,且有对真实 `pi --mode rpc` 样本帧的契约校验,以便防止 schema 与真实协议随 pi 演进而漂移。

#### Acceptance Criteria

1. The protocol package shall 为每个导出 zod schema 提供 `parse`/`safeParse` 的正例(合法对象通过)与反例(非法对象被拒)单元测试。
2. The protocol package shall 提供断言 `protocolVersion` 常量存在且为合法 SemVer 字符串的单元测试。
3. When 采集自真实 `pi --mode rpc` 运行的样本帧序列(至少覆盖 `prompt → text_delta → tool(execution start/update/end) → agent_end` 这条链路)被逐帧传入对应 schema 校验,the protocol package shall 使全部样本帧通过校验(`success: true`)。
4. When 采集的真实 SSE 样本帧被传入 SSE 帧 schema 校验,the protocol package shall 使全部样本帧通过校验。
5. If 任一真实样本帧未能通过对应 schema 校验,then 该契约校验测试 shall 失败并报告未通过的帧及其字段路径(暴露 schema 与真实协议的漂移)。
6. The protocol package shall 使上述单元测试与契约校验测试可通过单一测试命令执行并产出可供验证的运行结果。

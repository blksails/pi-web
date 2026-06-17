# Requirements Document

## Introduction

session-engine 是 pi-web 后端引擎的会话中枢。它把上游 `agent-source-resolver` 产出的 `ResolvedSource` 与 `rpc-channel` 提供的 `PiRpcChannel` 组装成"一个会话"(`PiSession`):向 agent 子进程转发命令、把 pi 的 `AgentEvent` 广播并翻译为可直接被前端渲染的 AI SDK v5 UIMessage 流、管理会话生命周期与资源回收,并通过可外置的 `SessionStore` 接口注册与检索会话。它向 `http-api` 提供唯一的会话抽象,使 HTTP 层只需转发,而把有状态逻辑收敛在会话引擎内。

本特性消费(不重定义)上游契约:protocol-contract 的 `AgentEvent`/SSE 帧/data-part/`protocolVersion`、rpc-channel 的 `PiRpcChannel` 与命令/扩展 UI 能力、agent-source-resolver 的 `ResolvedSource`。事件→UIMessage 的翻译被设计为纯函数,使其可在不依赖任何运行时(进程、网络、计时器)的前提下独立测试。

## Boundary Context

- **In scope**:
  - 会话对象 `PiSession`:持有通道、向多个订阅者广播事件、维护 extension UI 挂起表与最近状态缓存、转发命令、提供订阅接口。
  - 会话生命周期:创建、idle 空闲回收、显式停止(幂等)、子进程崩溃清理与错误广播、`SIGTERM` 优雅停机。
  - 会话注册与检索:`SessionStore` 接口与内存实现(`get`/`create`/`delete`/`list`),按接口外置以备未来分布式存储。
  - 事件→UIMessage 纯函数翻译层:把每种 pi `AgentEvent` 翻译为 protocol 定义的 SSE 帧(`uiMessageChunk` 或 `control`)。
- **Out of scope**:
  - HTTP 端点、SSE 编解码与网络传输(归 `http-api`)。
  - 子进程 spawn、JSONL framing、`PiRpcChannel` 接口与命令负载形状定义(归 `rpc-channel`)。
  - agent 源解析与 `spawnSpec` 生成(归 `agent-source-resolver`)。
  - protocol 类型/zod schema 定义(归 `protocol-contract`,仅消费)。
  - 并发上限/资源限额/沙箱隔离的生产硬化落地(本 spec 仅在生命周期范围内做空闲回收与崩溃清理;限额留作非功能项接缝)。
- **Adjacent expectations**:
  - `http-api` 期望通过 `SessionStore` 创建/检索会话,通过 `PiSession.subscribe()` 获取 UIMessage 帧流以编码为 SSE,通过命令转发方法触发 pi 操作,并把前端的 extension UI 回复路由回会话。
  - `rpc-channel` 期望被原样持有与调用,其 `onExit`/崩溃信号驱动会话清理。
  - `agent-source-resolver` 期望其 `ResolvedSource` 作为创建会话的输入。

## Requirements

### Requirement 1: 会话创建与组装

**Objective:** 作为 HTTP 层,我想用一个 `ResolvedSource` 与一个已建立的 `PiRpcChannel` 创建一个会话,以便获得一个可发命令、可订阅事件的会话句柄。

#### Acceptance Criteria

1. When 调用方以 `ResolvedSource` 与 `PiRpcChannel` 请求创建会话, the Session Engine shall 生成唯一 `sessionId` 并返回持有该通道的 `PiSession`。
2. When 会话被创建, the Session Engine shall 订阅通道的事件流(`onEvent`)、扩展 UI 请求(`onExtensionUIRequest`)与退出/崩溃信号(`onExit`),以便后续广播与清理。
3. When 会话被创建, the Session Engine shall 记录会话的 `mode` 与 `trust`(来自 `ResolvedSource`)供检索与审计使用。
4. The Session Engine shall 不在本特性内 spawn 子进程或解析 agent 源,而是接收调用方注入的已建立通道与已解析结果。
5. If 创建会话时未提供通道或已解析结果, then the Session Engine shall 拒绝创建并返回可识别的错误,而不产生半初始化的会话。

### Requirement 2: 命令转发

**Objective:** 作为 HTTP 层,我想通过会话把用户操作(prompt、steer、abort、切模型、查状态等)转发给 agent,以便不直接接触底层通道。

#### Acceptance Criteria

1. When 调用方在会话上调用某命令转发方法, the Session Engine shall 经持有的 `PiRpcChannel` 对应命令方法发出该命令并返回其结果。
2. The Session Engine shall 暴露与通道命令对齐的转发能力(prompt、steer、follow_up、abort、set_model、cycle_model、get_available_models、set_thinking_level、get_state、get_messages、get_session_stats、get_commands 及通道提供的其余命令)。
3. When 命令为状态类查询(如 state/stats), the Session Engine shall 在返回结果的同时刷新最近状态缓存。
4. If 在已停止的会话上调用命令转发方法, then the Session Engine shall 立即以"会话已停止"错误拒绝,而不向已关闭的通道发送。
5. The Session Engine shall 不解释或改写命令负载语义,仅转发并关联通道返回的结果。

### Requirement 3: 事件广播与多订阅者一致性

**Objective:** 作为 HTTP 层,我想让多个 SSE 连接订阅同一会话的事件流,以便同一会话的多个客户端看到一致的输出。

#### Acceptance Criteria

1. When 通道广播一个 pi 事件, the Session Engine shall 把该事件经会话的事件发射器分发给所有当前订阅者。
2. When 调用方调用 `subscribe()`, the Session Engine shall 返回一个可独立取消的订阅句柄,取消后该订阅者不再收到后续事件。
3. While 存在多个订阅者, the Session Engine shall 保证每个订阅者按事件到达的相同顺序收到相同的翻译结果。
4. When 一个订阅者取消订阅, the Session Engine shall 不影响其余订阅者继续接收事件。
5. If 在广播过程中某个订阅者回调抛出异常, then the Session Engine shall 隔离该异常使其不阻断对其余订阅者的分发。

### Requirement 4: 事件→UIMessage 纯函数翻译

**Objective:** 作为前端,我想直接收到 AI SDK v5 UIMessage 流帧,以便用 `<Response>`/`<Reasoning>`/`<Tool>` 等组件直接渲染,而无需在前端理解 pi 原生事件。

#### Acceptance Criteria

1. The Session Engine shall 提供一个纯函数翻译能力,其输入为单个 pi `AgentEvent`(及必要的会话内翻译上下文),输出为零个或多个 protocol 定义的 SSE 帧,且不产生任何副作用(无 I/O、无进程、无计时器、无可变全局状态)。
2. When 输入为 `agent_start`, the Session Engine shall 产出开启一条 assistant message 的帧(`start`/`start-step`)。
3. When 输入为 `message_update` 的 `text_start`/`text_delta`/`text_end`, the Session Engine shall 分别产出 `text-start`(分配 partId)/`text-delta`(增量)/`text-end` 帧。
4. When 输入为 `message_update` 的 `thinking_start`/`thinking_delta`/`thinking_end`, the Session Engine shall 分别产出 `reasoning-start`/`reasoning-delta`/`reasoning-end` 帧。
5. When 输入为 `tool_execution_start`, the Session Engine shall 产出携带 `toolCallId`/`toolName`/`args` 的 `tool-input-available` 帧。
6. When 输入为 `tool_execution_update`, the Session Engine shall 产出携带累积 `partialResult`(替换语义)的 data-part 帧。
7. When 输入为 `tool_execution_end`, the Session Engine shall 产出携带 `result`/`isError` 的 `tool-output-available` 帧。
8. When 输入为 `turn_end`, the Session Engine shall 产出 `finish-step` 帧;When 输入为 `agent_end`, the Session Engine shall 产出 `finish` 帧。
9. When 输入为 `compaction_*` 或 `auto_retry_*`, the Session Engine shall 产出对应的 `data-pi-*` control 旁路帧;When 输入为 `queue_update`, the Session Engine shall 产出 `data-pi-queue` 帧。
10. When 输入为 `extension_ui_request`, the Session Engine shall 产出旁路 `control` 帧(非 UIMessage chunk),供前端弹出对话框。
11. The Session Engine shall 使产出的每个 SSE 帧符合 protocol-contract 定义的帧 schema 且携带 `protocolVersion`,翻译层只产出 protocol 定义的帧形状,不引入额外帧类型。
12. If 输入为未知或无法翻译的事件类型, then the Session Engine shall 以确定方式处理(产出可识别的诊断 control 帧或显式丢弃)而不抛出未捕获异常。

### Requirement 5: Extension UI 挂起与往返

**Objective:** 作为前端,我想在 agent 请求用户决策(权限/选择/输入)时收到提示并回复结果,以便交互式控制 agent。

#### Acceptance Criteria

1. When 通道上到达一个 `extension_ui_request`, the Session Engine shall 把该请求登记进会话的 extension UI 挂起表,并经事件广播以旁路 control 帧通知订阅者。
2. When 调用方为某挂起的扩展 UI 请求提交回复, the Session Engine shall 经通道把回复写回 agent 并从挂起表移除该请求。
3. If 调用方为不存在或已被回复的扩展 UI 请求 ID 提交回复, then the Session Engine shall 拒绝该回复并返回可识别错误,而不向通道写出。
4. When 会话停止或子进程崩溃, the Session Engine shall 清空挂起表,使后续对其中任意 ID 的回复被拒绝。

### Requirement 6: 最近状态缓存

**Objective:** 作为 HTTP 层,我想在不打扰子进程的前提下快速取到会话的最近状态/统计,以便支撑控制面板展示。

#### Acceptance Criteria

1. When 会话观察到状态类响应或状态相关事件, the Session Engine shall 更新最近状态缓存(如模型、思考等级、会话统计)。
2. When 调用方请求会话的缓存状态, the Session Engine shall 返回最近一次已知值而不强制向子进程发起新命令。
3. While 尚无任何状态被观察到, the Session Engine shall 返回明确表示"暂无缓存"的结果而非编造默认值。

### Requirement 7: 会话生命周期

**Objective:** 作为运维方,我想让空闲会话被自动回收、崩溃会话被清理、停止操作可重复安全调用,以便控制资源占用并避免僵尸进程。

#### Acceptance Criteria

1. While 会话在配置的空闲时长内无任何活动(无命令、无事件、无订阅), the Session Engine shall 停止该会话并将其从注册表移除。
2. When 会话上发生活动, the Session Engine shall 重置该会话的空闲计时,使其不被过早回收。
3. When 调用方显式停止会话, the Session Engine shall 关闭其通道、移除其注册项,并向订阅者发出会话结束信号。
4. When 对同一会话多次调用停止, the Session Engine shall 表现为幂等:首次执行清理,后续调用安全无副作用且不报错。
5. When 会话的子进程退出或崩溃, the Session Engine shall 向订阅者广播错误/结束信号、清理挂起表与缓存,并将会话从注册表移除。
6. The Session Engine shall 在会话停止后拒绝其上的命令转发与订阅请求,避免对已关闭通道的操作。

### Requirement 8: 优雅停机

**Objective:** 作为运维方,我想在收到 `SIGTERM` 时让服务有序地停止所有会话,以便不留下僵尸子进程、且尽量通知到已连接的前端。

#### Acceptance Criteria

1. When 引擎收到优雅停机指令, the Session Engine shall 停止接受新会话的创建。
2. When 引擎进入优雅停机, the Session Engine shall 对注册表中的所有会话发出会话结束信号并逐一停止(关闭其通道)。
3. When 优雅停机完成, the Session Engine shall 使注册表为空且无残留挂起表项。
4. If 某个会话在停止过程中报错, then the Session Engine shall 隔离该错误并继续停止其余会话,不因单个失败而中止整体停机。

### Requirement 9: 会话注册与外置存储接口

**Objective:** 作为架构负责人,我想让会话注册经一个可替换的存储接口实现,以便未来从单机内存切换到 Redis/Durable Object 而不改动上层。

#### Acceptance Criteria

1. The Session Engine shall 定义一个会话存储接口,提供创建、按 `sessionId` 检索、删除与列出会话的能力。
2. The Session Engine shall 提供该接口的内存实现(以 `sessionId` 为键),作为单机默认存储。
3. When 上层经存储创建会话, the Session Engine shall 在存储中登记会话使其可被后续按 `sessionId` 检索。
4. When 会话被停止或回收, the Session Engine shall 从存储中移除其登记项。
5. If 按不存在的 `sessionId` 检索, then the Session Engine shall 返回明确的"未找到"结果而非抛出未定义错误。
6. The Session Engine shall 仅依赖该存储接口而非其具体实现,使内存实现可被替换为远程实现而不影响会话逻辑。

### Requirement 10: 可测试性(测试 + e2e 硬性)

**Objective:** 作为质量负责人,我想要单元、集成与端到端测试以新鲜运行证据证明会话引擎正确,以便在合并前确认行为符合契约。

#### Acceptance Criteria

1. The Session Engine shall 使事件→UIMessage 翻译层为纯函数,从而可用表驱动用例覆盖每一种 pi 事件到正确帧的映射,无需真实进程或网络。
2. The Session Engine shall 提供可对 `PiRpcChannel` 注入 mock/stub 的会话逻辑,使广播、命令转发、扩展 UI 往返、生命周期可在不 spawn 真实子进程的前提下测试。
3. Where 单元测试被包含, the Session Engine shall 验证翻译层逐事件正确性,以及生命周期的空闲回收、崩溃清理与停止幂等。
4. Where 集成测试被包含, the Session Engine shall 用真实通道对接 stub agent,验证多订阅者收到一致事件以及 extension UI 往返成功。
5. Where 端到端测试被包含, the Session Engine shall 验证 `create → prompt → 订阅者收到完整 UIMessage 流(start → text-delta… → finish)→ 可取得 stats` 的全链路。
6. The Session Engine shall 可由单一测试命令运行全部单元、集成与端到端测试并产出可验证结果。
